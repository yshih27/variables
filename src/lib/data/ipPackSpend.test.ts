/**
 * Pack spend by IP: which machine sells which IP, Renaiss pulls by prize, and
 * the assembly.
 *
 *   npm run test:ip-pack-spend
 *
 * Machine keys and names marked `m` were read off Collector Crypt's machine
 * board on 2026-10-21; `c` are constructed to pin one rule.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIpPackSpend, ccMachineIp, packCoverageOf, packSpendWindow, renaissPullIps, type RenaissPackPull } from "./ipPackSpend";
import { sumWindowDays } from "./metricSnapshots";
import type { MachineBoard } from "./playerAnalytics";

const cc = (key: string, name?: string) => ccMachineIp(`collector-crypt:${key}`, name ?? `collector-crypt:${key}`);

test("m: single-IP Collector Crypt machines are credited by name or key", () => {
  assert.equal(cc("pokemon_5000", "Celestial Pokémon Gacha Pack"), "pokemon");
  assert.equal(cc("onepiece_250", "One Piece Crew Pack"), "one_piece");
  assert.equal(cc("dragonball_100", "Dragonball 100"), "dragon_ball");
  assert.equal(cc("riftbound_250", "Riftbound 250"), "riftbound");
  assert.equal(cc("soccer_100", "Soccer $100 Pack"), "soccer");
  assert.equal(cc("football_250", "Football 250 Pack"), "football");
  assert.equal(cc("basketball_100", "Basketball 100 Gacha Pack"), "basketball");
  assert.equal(cc("baseball_250", "Baseball 250 Gacha Pack"), "baseball");
  assert.equal(cc("pokemon_300"), "pokemon"); // name falls back to the key
});

test("m: event machines read their theme from the key", () => {
  assert.equal(cc("ejup_poke_100"), "pokemon");
  assert.equal(cc("esfpoke_3000"), "pokemon");
  assert.equal(cc("esnorlax_5000"), "pokemon");
  assert.equal(cc("bf_soccer25"), "soccer");
  assert.equal(cc("comic_250"), "comics");
});

test("m: mixed machines are not credited, watches before Pokémon", () => {
  assert.equal(cc("ewatch_500", "WATCH 500"), null);
  assert.equal(cc("ewatches_500"), null);
  assert.equal(cc("epokewatch_2000"), null); // pays out watches
  assert.equal(cc("pokewatch_50_jup1"), null);
  assert.equal(cc("sports_100", "Sports Gacha Pack"), null);
  assert.equal(cc("sports_500", "All-Star Sports Gacha Pack 500"), null);
  assert.equal(cc("e10_10", "PSA 10's ONLY 10/10 Day"), null);
  assert.equal(cc("anime_75", "Anime Pop Culture Gacha"), null);
  assert.equal(cc("degen_100"), null);
  assert.equal(cc("evintage_80"), null);
});

const pull = (machine: string, card: string | null, price = 50, at = "2026-10-15T12:00:00Z"): RenaissPackPull => ({ product_id: machine, price_usd: price, pulled_at: at, prize_card_name: card, prize_set_name: null });

test("c: a Renaiss trainer prize takes its machine's IP only when the machine is ≥95% one IP", () => {
  const pure = [...Array.from({ length: 19 }, () => pull("A", "Pikachu ex")), pull("A", "Lillie's Determination")];
  assert.deepEqual(renaissPullIps(pure).slice(-1), ["pokemon"]);
  const mixed = [...Array.from({ length: 6 }, () => pull("B", "Pikachu ex")), ...Array.from({ length: 4 }, () => pull("B", "Monkey D. Luffy")), pull("B", "Lillie's Determination")];
  assert.deepEqual(renaissPullIps(mixed).slice(-1), [null]);
});

test("c: assembly credits by venue, keeps the 7-day share, and reports coverage", () => {
  const board: MachineBoard = {
    windowDays: 30,
    asOf: "2026-10-20T00:00:00.000Z",
    rows: [
      { key: "collector-crypt:soccer_100", name: "Soccer $100 Pack", priceUsd: 100, pulls: 10, spendUsd: 1000, spend7dUsd: 300, pulls24h: 1 },
      { key: "collector-crypt:ewatch_500", name: "WATCH 500", priceUsd: 500, pulls: 2, spendUsd: 1000, spend7dUsd: 500, pulls24h: 0 },
    ],
  } as MachineBoard;
  const end = Date.parse("2026-10-21T00:00:00Z");
  const snap = buildIpPackSpend({
    ccBoard: board,
    renaissPulls: [pull("A", "Pikachu ex", 50, "2026-10-19T08:00:00Z"), pull("A", "Pikachu ex", 50, "2026-10-01T08:00:00Z"), pull("A", "Pikachu ex", 50, "2026-09-01T08:00:00Z")],
    windowEndMs: end,
    venueTotals: { "collector-crypt": 5000, renaiss: 200, courtyard: 9000 },
    generatedAt: "2026-10-21T01:00:00Z",
  });
  assert.deepEqual(snap.byIp.soccer, { usd30d: 1000, usd7d: 300, byVenue: { "collector-crypt": { usd30d: 1000, usd7d: 300 } } });
  assert.deepEqual(snap.byIp.pokemon, { usd30d: 100, usd7d: 50, byVenue: { renaiss: { usd30d: 100, usd7d: 50 } } }); // Sep 1 is outside 30 days
  assert.equal(snap.venues["collector-crypt"].creditedUsd30d, 1000); // the watch machine is not credited
  assert.equal(snap.venues["collector-crypt"].packSpend30dUsd, 5000);
  assert.equal(snap.venues.courtyard.creditedUsd30d, 0);
  assert.equal(snap.venues.courtyard.basis, "no pull feed");
});

// ── One window for every source (c) ─────────────────────────────────────────

test("c: the window ends on the board's last complete day, never past yesterday", () => {
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const now = Date.parse("2026-10-22T00:13:00Z"); // after UTC midnight, before the daily run
  const w = packSpendWindow("2026-10-20T00:00:00.000Z", now);
  assert.equal(iso(w.endMs - 86_400_000), "2026-10-20"); // Renaiss reads the board's days, not Oct 21
  assert.equal(iso(w.startMs), "2026-09-21");
  assert.equal((w.endMs - w.startMs) / 86_400_000, 30);
  // A board refreshed today: ends yesterday.
  assert.equal(iso(packSpendWindow("2026-10-21T00:00:00.000Z", now).endMs - 86_400_000), "2026-10-21");
  // No board: yesterday.
  assert.equal(iso(packSpendWindow(null, now).endMs - 86_400_000), "2026-10-21");
});

test("c: venue totals sum exactly the window, and a lagging series reads unknown", () => {
  const days = (from: number, n: number, v = 10) =>
    Array.from({ length: n }, (_, i) => ({ ts: new Date(Date.UTC(2026, 8, from + i)).toISOString(), value: v }));
  const start = Date.UTC(2026, 8, 21); // Sep 21
  const end = Date.UTC(2026, 9, 21); // Oct 21 (exclusive): 30 days
  assert.equal(sumWindowDays(days(15, 40), start, end), 300); // points outside the window ignored
  assert.ok(Number.isNaN(sumWindowDays(days(21, 29), start, end))); // spine one day short
});

test("c: a credited venue with no known total leaves the total out of the line", () => {
  const snap = buildIpPackSpend({
    ccBoard: null,
    renaissPulls: [{ product_id: "m1", price_usd: 50, pulled_at: "2026-10-20T10:00:00Z", prize_card_name: "Pikachu", prize_set_name: null }],
    windowEndMs: Date.UTC(2026, 9, 21),
    venueTotals: { renaiss: null, courtyard: 100 },
  });
  const cov = packCoverageOf(snap);
  assert.equal(cov.creditedUsd, 50);
  assert.ok(Number.isNaN(cov.totalUsd));
});

test("c: venues not split are listed in registry order, whatever order the snapshot's keys come back in", () => {
  const snap = buildIpPackSpend({
    ccBoard: null,
    renaissPulls: [],
    windowEndMs: Date.UTC(2026, 9, 21),
    venueTotals: { "collector-crypt": 100, courtyard: 50, phygitals: 20, renaiss: 10, beezie: 5, dyli: 1 },
  });
  // jsonb hands keys back shortest-first: dyli, beezie, renaiss, courtyard, phygitals, collector-crypt.
  const order = ["dyli", "beezie", "renaiss", "courtyard", "phygitals", "collector-crypt"];
  const shuffled = { ...snap, venues: Object.fromEntries(order.map((k) => [k, snap.venues[k]])) };
  assert.deepEqual(packCoverageOf(shuffled).notSplit, ["Courtyard", "Beezie", "Collector Crypt", "Phygitals", "DYLI", "Renaiss"]);
});
