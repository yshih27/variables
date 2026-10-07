/**
 * test:renaiss (platform) — the Renaiss platform page's backend (brief PR A):
 * the enrich branch's IP rule, the 7-day table window, the pull mapper's two
 * new columns, the columns refill's resume rule, the machine board, the
 * players' tiers, and the holders summary (exclusions, burns, the stated
 * market cap's coverage gate). No network, no database: fixtures and
 * constructed rows only, each labelled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renaissCardRow } from "./cards";
import { toPullRow, isMissingNewColumn, type RenaissPullRow } from "./pulls";
import { refillStart, type RefillState } from "./warm";
import { buildRenaissMachineBoard, RENAISS_VALUE_BASIS, type BoardPull } from "./machines";
import { buildRenaissPlayers, isMissingFunction } from "./players";
import { summarizeHoldings, STATED_MCAP_MIN_COVERAGE } from "./holders";
import { chooseSalesWindow, holdersReasonFor, ipOfSale } from "../data/platformTables";
import { classifyIP } from "../data/ipCatalog";
import { extractCategoryHints } from "../data/beezieTraits";
import { SALES_TABLE_MIN } from "../data/coreVolumeCache";
import type { TokenMetadata } from "../onchain/tokenUri";

const FIX = join(__dirname, "fixtures");
const week = JSON.parse(readFileSync(join(FIX, "pulls-week.json"), "utf8")).pulls as RenaissPullRow[];

// ── The enrich branch: the stored ip_key, not keywords ──────────────────────

test("a Renaiss sale's IP comes from its stored ip_key; keywords would misread the card", () => {
  // CONSTRUCTED from the Sep 23 sample's shape: Sunflora (Mask of Change, SV6), whose
  // catalog image names its game. Keyword matching reads its name as football ("nfl").
  const row = renaissCardRow(
    "1",
    { cert: "PSA1", company: "PSA", grade: "10 Gem Mint" },
    { id: "c", renaissItemId: null, name: "Sunflora", setName: "Mask of Change", setCode: "SV6", cardNumber: "7", year: 2024, language: "Japanese", imageUrl: "https://x.test/cards/pokemon_sv6_007_ja_abc_lg.png" },
  );
  const meta: TokenMetadata = { name: row.name ?? undefined, attributes: row.attributes ?? undefined };
  assert.equal(row.ip_key, "pokemon");
  assert.equal(ipOfSale({ meta, ipKey: row.ip_key }).key, "pokemon");
  assert.notEqual(classifyIP(extractCategoryHints(meta)).key, "pokemon", "the keyword path is the one that gets it wrong");
  // A venue without a stored key keeps the keyword path, unchanged.
  assert.equal(ipOfSale({ meta }).key, classifyIP(extractCategoryHints(meta)).key);
});

test("the tables read the trailing 7 days when the 24h holds fewer than the minimum, never an empty table", () => {
  const sale = (i: number) => ({ id: i });
  const thin = Array.from({ length: SALES_TABLE_MIN - 1 }, (_, i) => sale(i));
  const busy = Array.from({ length: SALES_TABLE_MIN }, (_, i) => sale(i));
  const weekRows = Array.from({ length: 40 }, (_, i) => sale(i));
  assert.deepEqual(chooseSalesWindow(thin, weekRows), { window: "7d", sales: weekRows });
  assert.deepEqual(chooseSalesWindow(busy, weekRows), { window: "24h", sales: busy });
  assert.deepEqual(chooseSalesWindow([], weekRows).window, "7d");
  assert.deepEqual(chooseSalesWindow(thin, undefined), { window: "24h", sales: thin }, "no week carried: the 24h, as before");
  assert.deepEqual(chooseSalesWindow([], []), { window: "24h", sales: [] });
});

test("holders: the reason comes from what the snapshot holds", () => {
  assert.equal(holdersReasonFor("renaiss", { renaiss: 412 }), null);
  assert.equal(holdersReasonFor("renaiss", { renaiss: 0 }), null, "a counted zero is a count");
  assert.match(holdersReasonFor("renaiss", { beezie: 1 })!, /no holders run has counted Renaiss yet/);
  assert.match(holdersReasonFor("courtyard", null)!, /no holder scan/);
});

// ── The pull mapper's two new columns, and the refill ────────────────────────

test("toPullRow keeps the machine's name and the prize's image (pulls-week.json, Sep 23)", () => {
  const p = week[0];
  const row = toPullRow(p, null);
  assert.equal(row.machine_name, "PANDORA 28");
  assert.equal(row.prize_image_url, p.imageUrl);
  // No top-level image: the catalog card's; neither: null. An empty name is null.
  assert.equal(toPullRow({ ...p, imageUrl: null }, null).prize_image_url, p.catalogCard?.imageUrl);
  assert.equal(toPullRow({ ...p, imageUrl: null, catalogCard: null, machineName: "  " }, null).prize_image_url, null);
  assert.equal(toPullRow({ ...p, machineName: "  " }, null).machine_name, null);
  assert.ok(isMissingNewColumn("Could not find the 'machine_name' column of 'renaiss_pulls' in the schema cache"));
  assert.ok(!isMissingNewColumn("duplicate key value violates unique constraint"));
});

test("the refill resumes from its recorded cursor, and starts over when done or told to", () => {
  const s: RefillState = { startedAt: "a", updatedAt: "b", cursor: "c-120", pages: 120, rows: 60000, doneAt: null };
  assert.deepEqual(refillStart(s, false), { after: "c-120", resumed: true });
  assert.deepEqual(refillStart(s, true), { after: null, resumed: false });
  assert.deepEqual(refillStart({ ...s, doneAt: "d" }, false), { after: null, resumed: false });
  assert.deepEqual(refillStart(null, false), { after: null, resumed: false });
  assert.deepEqual(refillStart({ ...s, cursor: null }, false), { after: null, resumed: false });
});

// ── The machine board ───────────────────────────────────────────────────────

const NOW = Date.parse("2026-10-07T03:00:00Z");
const bp = (o: Partial<BoardPull> & { pulled_at: string }): BoardPull => ({
  kind: "checkout",
  product_id: "m1",
  machine_name: null,
  price_usd: 28,
  prize_value_usd: null,
  prize_card_name: null,
  prize_grade_label: null,
  prize_image_url: null,
  ...o,
});

test("machine board: spend, value back and hit share in the stated value, the top prize, 30 complete days", () => {
  // CONSTRUCTED: machine m1 at $28, four checkouts in the window and one outside each edge.
  const pulls: BoardPull[] = [
    bp({ pulled_at: "2026-10-06T12:00:00Z", machine_name: "PANDORA 28", prize_value_usd: 40, prize_card_name: "Gengar", prize_grade_label: "PSA 10", prize_image_url: "img-g" }),
    bp({ pulled_at: "2026-10-03T12:00:00Z", prize_value_usd: 10 }),
    bp({ pulled_at: "2026-09-20T12:00:00Z", prize_value_usd: "28" }),
    bp({ pulled_at: "2026-09-08T00:00:00Z" }), // no stated value: spend, not in value back
    bp({ pulled_at: "2026-10-07T01:00:00Z", prize_value_usd: 999 }), // today: still filling, excluded
    bp({ pulled_at: "2026-09-06T23:59:59Z", prize_value_usd: 999 }), // before the window
    bp({ kind: "observed", price_usd: null, pulled_at: "2026-10-05T00:00:00Z", prize_value_usd: 60, prize_card_name: "Mew", prize_grade_label: "PSA 9" }), // a prize, never spend
    bp({ product_id: "m2", price_usd: 48, pulled_at: "2026-10-01T00:00:00Z" }),
  ];
  const board = buildRenaissMachineBoard(pulls, NOW)!;
  assert.equal(board.windowDays, 30);
  assert.equal(board.asOf, "2026-10-06T00:00:00.000Z");
  assert.equal(board.valueBasis, RENAISS_VALUE_BASIS);
  const m1 = board.rows.find((r) => r.key === "m1")!;
  assert.equal(m1.name, "PANDORA 28");
  assert.equal(m1.priceUsd, 28);
  assert.equal(m1.pulls, 4);
  assert.equal(m1.spendUsd, 112);
  assert.equal(m1.spend7dUsd, 56, "Oct 6 and Oct 3 are inside the 7 complete days to Oct 6");
  assert.equal(m1.pulls24h, 1);
  assert.equal(m1.hitN, 3);
  assert.equal(m1.statedValueUsd, 78);
  assert.ok(Math.abs(m1.valueBackPct! - (78 / 84) * 100) < 1e-9, "Σ stated ÷ Σ paid over the pulls carrying both");
  assert.ok(Math.abs(m1.hitSharePct! - (2 / 3) * 100) < 1e-9, "stated ≥ price on 2 of 3 (40 and 28)");
  assert.deepEqual(m1.topPrize, { cardName: "Mew", grade: "PSA 9", valueUsd: 60, image: null, pulledAt: "2026-10-05T00:00:00.000Z" });
  const m2 = board.rows.find((r) => r.key === "m2")!;
  assert.equal(m2.name, "m2", "no name in the feed: the machine id");
  assert.equal(m2.valueBackPct, null);
  assert.equal(m2.hitSharePct, null);
  assert.equal(m2.attributedUsd, undefined, "no partner fields on a venue whose pulls name no partner");
  assert.deepEqual(board.rows.map((r) => r.key), ["m1", "m2"], "desc by spend");
  assert.equal(buildRenaissMachineBoard([bp({ pulled_at: "2026-10-07T01:00:00Z" })], NOW), null, "nothing complete: no board");
});

// ── Players ─────────────────────────────────────────────────────────────────

test("players: tiers and concentration from the database's per-wallet rows, no monthly mix claimed", () => {
  const rows = [
    { buyer: "a", spend: "40", pulls: 2, first_pull: "2026-01-01T00:00:00Z", last_pull: "2026-10-01T00:00:00Z" },
    { buyer: "b", spend: 2000, pulls: "50", first_pull: "2025-11-06T00:00:00Z", last_pull: "2026-05-01T00:00:00Z" },
    { buyer: "c", spend: 0, pulls: 1, first_pull: "2026-02-01T00:00:00Z", last_pull: "2026-02-01T00:00:00Z" },
  ];
  const p = buildRenaissPlayers(rows, { rows: 10, walletAttributedRows: 9, pricedRows: 8 }, NOW);
  assert.equal(p.platform, "renaiss");
  assert.equal(p.concentration.totalWallets, 2, "a zero-spend wallet is not a spender");
  assert.equal(p.concentration.totalSpendUsd, 2040);
  assert.equal(p.concentration.activeWallets30d, 1);
  assert.equal(p.tiers.find((t) => t.label === "≤$50")!.users, 1);
  assert.equal(p.tiers.find((t) => t.label === "$1k–10k")!.users, 1);
  assert.equal(p.coverage.firstPullAt, "2025-11-06T00:00:00.000Z");
  assert.equal(p.coverage.rows, 10);
  assert.deepEqual(p.monthly, []);
  assert.match(p.monthlyReason!, /per wallet/);
  assert.ok(isMissingFunction("Could not find the function public.renaiss_wallet_spend without parameters in the schema cache"));
});

// ── Holders and the stated market cap ───────────────────────────────────────

const ADMIN = "0xadmin";
const TREASURY = "0xtreasury";
const ZERO = "0x0000000000000000000000000000000000000000";

function holdings(owners: [string, string][], pulled: [string, number | null, string][], sold: string[], complete = true) {
  return summarizeHoldings({
    live: { totalSupply: owners.length, owners: new Map(owners), unanswered: 0 },
    complete,
    operated: new Map([
      [ADMIN, ["owner", "DEFAULT_ADMIN_ROLE"]],
      [TREASURY, ["treasury"]],
    ]),
    pulled: new Map(pulled.map(([t, v, ip]) => [t, { valueUsd: v, ip }])),
    sold: new Set(sold),
  }).summary;
}

test("holders: Renaiss's wallets, zero and burn excluded; reverted tokens counted as burned", () => {
  // CONSTRUCTED: five live tokens (one reverted), two pulled tokens no longer live, one live token no pull or sale names.
  const s = holdings(
    [
      ["1", "0xalice"],
      ["2", "0xalice"],
      ["3", "0xbob"],
      ["4", TREASURY],
      ["5", ZERO],
      ["6", "none"],
      ["7", "0xcarol"],
    ],
    [
      ["1", 100, "pokemon"],
      ["2", 50, "pokemon"],
      ["3", 20, "one_piece"],
      ["4", 10, "pokemon"],
      ["8", 5, "pokemon"],
      ["9", 5, "pokemon"],
    ],
    ["3", "6"],
  );
  assert.equal(s.holders, 3, "alice, bob, carol");
  assert.equal(s.tokensHeld, 4);
  assert.equal(s.liveTokens, 6, "a reverted ownerOf is not live");
  assert.deepEqual(
    s.excluded.map((e) => [e.address, e.tokens]),
    [
      [TREASURY, 1],
      [ADMIN, 0],
    ],
  );
  assert.equal(s.universe, 7, "tokens 1-4, 8, 9 pulled; 3 and 6 sold");
  assert.equal(s.burnedLikelyRedeemed, 3, "6 reverted, 8 and 9 no longer enumerated");
  assert.equal(s.liveOutsideUniverse, 2, "tokens 5 and 7: no pull or sale names them");
  assert.deepEqual(s.byIp.pokemon, { holders: 1, tokens: 2, mcapUsd: 150, valued: 2 });
  assert.equal(s.topOwners[0].address, "0xalice");
  assert.ok(s.topOwners.find((o) => o.address === TREASURY)!.operated);
  // A capped probe never counts burns it cannot prove.
  assert.ok(Number.isNaN(holdings([["1", "0xalice"]], [["9", 5, "pokemon"]], [], false).burnedLikelyRedeemed));
});

test("stated market cap: the held tokens' stated values, published only at the coverage floor", () => {
  assert.equal(STATED_MCAP_MIN_COVERAGE, 0.8);
  const owners: [string, string][] = Array.from({ length: 10 }, (_, i) => [String(i), `0xh${i}`]);
  const valued = (n: number): [string, number | null, string][] => Array.from({ length: 10 }, (_, i) => [String(i), i < n ? 10 : null, "pokemon"]);
  const below = holdings(owners, valued(7), []).stated;
  assert.deepEqual(below, { mcapUsd: 70, valued: 7, held: 10, coveragePct: 70, publishable: false });
  const at = holdings(owners, valued(8), []).stated;
  assert.deepEqual(at, { mcapUsd: 80, valued: 8, held: 10, coveragePct: 80, publishable: true });
  // A token held but never pulled is a gap in coverage, never a zero in the sum.
  const gap = holdings([...owners, ["99", "0xnew"]], valued(10), []).stated;
  assert.equal(gap.held, 11);
  assert.equal(gap.valued, 10);
  assert.equal(gap.mcapUsd, 100);
});
