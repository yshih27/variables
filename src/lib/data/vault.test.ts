import { test } from "node:test";
import assert from "node:assert/strict";
import { valueIdentityGroups, type ListingIndex } from "./identityDetail";
import { resolveHolding, priceHoldings, summarize, type ResolvedHolding } from "./vault";
import { identityKey, extractCardIdentity, type CardIdentityParts } from "./traits";
import { identitySlug } from "@/lib/card/identity";
import type { SaleRow } from "./salePanel";
import type { CardIdentityRow } from "./cards";
import type { CardPlatform } from "@/lib/card/ids";
import { enumerateHoldings } from "@/lib/vault/holdings";
import type { DasAsset } from "@/lib/helius/client";

// ── fixture ──────────────────────────────────────────────────────────────────

const NOW = Date.parse("2026-09-15T12:00:00Z"); // September is the running month
const parts = (cardName: string, number: string, grade: string): CardIdentityParts => ({
  year: null, set: "Base Set", number, cardName, grade, edition: null, language: null,
});
const P = {
  charizard: parts("Charizard", "4", "PSA 10"),
  pikachu: parts("Pikachu", "58", "PSA 9"),
  mew: parts("Mew", "151", "PSA 8"),
  blastoise: parts("Blastoise", "2", "PSA 10"),
};
const K = Object.fromEntries(Object.entries(P).map(([n, p]) => [n, identityKey("pokemon", p)!])) as Record<keyof typeof P, string>;
const S = Object.fromEntries(Object.entries(P).map(([n, p]) => [n, identitySlug("pokemon", p)!])) as Record<keyof typeof P, string>;

const sale = (identity: string, ts: string, priceUsd: number, platform: CardPlatform, tokenId: string): SaleRow => ({
  ts, tokenId, priceUsd, platform, ip: "pokemon", set: "Base Set", setKey: null, grade: "PSA 10", identity,
});
const panel: SaleRow[] = [
  // Charizard: two August sales → an August reference of 110; a September
  // sale at 150 is the LAST sale but the running month is never the price.
  sale(K.charizard, "2026-08-03T00:00:00Z", 100, "collector-crypt", "czA"),
  sale(K.charizard, "2026-08-20T00:00:00Z", 120, "collector-crypt", "czB"),
  sale(K.charizard, "2026-09-05T00:00:00Z", 150, "collector-crypt", "czB"),
  // Pikachu: one sale — no month clears n ≥ 2, so no reference.
  sale(K.pikachu, "2026-08-10T00:00:00Z", 40, "beezie", "pk1"),
  // Blastoise: an August reference of 60.
  sale(K.blastoise, "2026-08-01T00:00:00Z", 50, "collector-crypt", "blA"),
  sale(K.blastoise, "2026-08-02T00:00:00Z", 70, "collector-crypt", "blA"),
];
const slabsByKey = new Map<string, { platform: CardPlatform; tokenId: string }[]>([
  [K.charizard, [{ platform: "collector-crypt", tokenId: "czA" }, { platform: "collector-crypt", tokenId: "czB" }]],
  [K.pikachu, [{ platform: "beezie", tokenId: "pk1" }, { platform: "beezie", tokenId: "pk2" }]],
  [K.mew, [{ platform: "phygitals", tokenId: "mw1" }]],
  [K.blastoise, [{ platform: "collector-crypt", tokenId: "blA" }, { platform: "collector-crypt", tokenId: "blB" }]],
]);
const listing = (platform: string, tokenId: string, priceUsd: number, source = "NATIVE") => [`${platform}:${tokenId}`, { itemId: tokenId, priceUsd, platform, source }] as const;
const listings: ListingIndex = new Map([
  listing("collector-crypt", "czB", 130), // Charizard floor 130 vs 110 → plausible
  listing("beezie", "pk2", 1.84, "OPEN_SEA"), // Pikachu: a placeholder ask vs a $40 last sale
  listing("phygitals", "mw1", 5), // Mew: an ask with nothing to judge it against
  listing("collector-crypt", "blB", 200), // Blastoise: 200 vs 60 = 3.3× → implausible
  listing("collector-crypt", "czA", 999), // the holder's own ask on czA
]);

const row = (tokenId: string, key: string, slug: string, ip = "pokemon"): CardIdentityRow => ({
  tokenId, name: null, cardName: null, ip, set: "Base Set", gradeLabel: null, year: null, cardNumber: null, image: null, identityKey: key, identitySlug: slug,
});
const held = (platform: CardPlatform, tokenId: string, key: string, slug: string) =>
  resolveHolding({ platform, tokenId }, { row: row(tokenId, key, slug), meta: null, columnKnown: true });

function value(resolved: ResolvedHolding[]) {
  const keys = [...new Set(resolved.flatMap((r) => (r.identity ? [r.identity.key] : [])))];
  const vals = valueIdentityGroups(keys.map((k) => [k]), { panel, slabsByKey, listings, now: NOW });
  const byKey = new Map(keys.map((k, i) => [k, vals[i]]));
  return priceHoldings(resolved, byKey, listings);
}

const vault = value([
  held("collector-crypt", "czA", K.charizard, S.charizard),
  held("beezie", "pk1", K.pikachu, S.pikachu),
  held("phygitals", "mw1", K.mew, S.mew),
  held("collector-crypt", "blA", K.blastoise, S.blastoise),
  resolveHolding({ platform: "courtyard", tokenId: "123" }, { row: null, meta: null, columnKnown: false }),
]);
const get = (tokenId: string) => vault.find((h) => h.tokenId === tokenId)!;

// ── the rule ─────────────────────────────────────────────────────────────────

test("reference beats last sale: the latest COMPLETE month's median, not the running month's sale", () => {
  const cz = get("czA");
  assert.deepEqual(cz.reference, { month: "2026-08", priceUsd: 110, n: 2, thin: true });
  assert.equal(cz.lastSale?.priceUsd, 150);
  assert.deepEqual(cz.value, { usd: 110, basis: "reference" });
});

test("last sale is the value only without a reference", () => {
  const pk = get("pk1");
  assert.equal(pk.reference, null);
  assert.deepEqual(pk.value, { usd: 40, basis: "last-sale" });
  assert.equal(get("czA").value?.basis, "reference");
});

test("an unplausible floor is never a value and never in atFloor", () => {
  const pk = get("pk1");
  assert.deepEqual(pk.floor, { priceUsd: 1.84, venue: "beezie", plausible: false });
  const bl = get("blA");
  assert.deepEqual(bl.floor, { priceUsd: 200, venue: "collector-crypt", plausible: false });
  assert.deepEqual(bl.value, { usd: 60, basis: "reference" });
  // With neither reference nor last sale there is nothing to judge an ask by.
  const mw = get("mw1");
  assert.deepEqual(mw.floor, { priceUsd: 5, venue: "phygitals", plausible: false });
  assert.equal(mw.value, null);
  assert.equal(mw.unvalued, "no-sale");
  const { totals } = summarize(vault);
  assert.deepEqual(totals.atFloor, { usd: 130, n: 1 }); // Charizard's plausible 130 only
  for (const h of vault) if (h.value) assert.notEqual(h.value.usd, h.floor?.priceUsd);
});

test("spread counts only holdings with BOTH a reference and a plausible floor", () => {
  const { totals } = summarize(vault);
  // Blastoise has a reference but an implausible floor; Pikachu a floor but no
  // reference; Mew neither. Only Charizard has both.
  assert.deepEqual(totals.spread, { usd: 20, pct: (20 / 110) * 100, n: 1 });
  assert.deepEqual(totals.atReference, { usd: 170, n: 2 });
  assert.deepEqual(totals.atValue, { usd: 210, n: 3 });
});

test("yourAsk is THIS token's listing; nothing is dropped; the unkeyed say why", () => {
  assert.deepEqual(get("czA").yourAsk, { priceUsd: 999, source: "NATIVE" });
  assert.equal(get("blA").yourAsk, null);
  const cy = get("123");
  assert.equal(cy.identity, null);
  assert.equal(cy.unkeyed, "courtyard-no-card-row");
  assert.equal(cy.unvalued, "no-identity");
  const { totals } = summarize(vault);
  assert.equal(totals.holdings, 5);
  assert.equal(totals.keyed, 4);
  assert.equal(totals.valued, 3);
  assert.deepEqual(totals.unvalued, { n: 2, reasons: { "no-sale": 1, "no-identity": 1 }, unkeyed: { "courtyard-no-card-row": 1 } });
});

test("byIp, byVenue and byGrade each sum to atValue", () => {
  const s = summarize(vault);
  for (const groups of [s.byIp, s.byVenue, s.byGrade]) {
    assert.equal(groups.reduce((a, g) => a + g.usd, 0), s.totals.atValue.usd);
    assert.equal(groups.reduce((a, g) => a + g.holdings, 0), s.totals.holdings);
    assert.equal(groups.reduce((a, g) => a + g.valued, 0), s.totals.valued);
  }
  assert.deepEqual(s.byIp.map((g) => g.key), ["pokemon", "unclassified"]);
  assert.deepEqual(s.byVenue[0], { key: "collector-crypt", label: "Collector Crypt", holdings: 2, valued: 2, usd: 170 });
});

test("the column's key yields to the derivation when the index does not know it", () => {
  const titled: CardIdentityRow = {
    ...row("t1", "pokemon|stale|4|CHARIZARD|PSA 10||", "pokemon/stale/4/charizard/psa-10"),
    name: "1999 Pokemon Base Set #4 Charizard PSA 10",
    gradeLabel: "PSA 10",
  };
  const expected = identityKey("pokemon", extractCardIdentity({ name: titled.name, cardName: null, set: titled.set, grade: "PSA 10", year: null, cardNumber: null }));
  assert.ok(expected);
  const stale = resolveHolding({ platform: "collector-crypt", tokenId: "t1" }, { row: titled, meta: null, columnKnown: false });
  assert.equal(stale.identity?.key, expected);
  const current = resolveHolding({ platform: "collector-crypt", tokenId: "t1" }, { row: titled, meta: null, columnKnown: true });
  assert.equal(current.identity?.key, titled.identityKey);
});

// ── the partial path ─────────────────────────────────────────────────────────

const dasAsset = (i: number, owner: string): DasAsset => ({
  id: `mint${i}`,
  interface: "V1_NFT",
  ownership: { owner },
  content: { metadata: { name: `2023 Pokemon Base Set #4 Charizard PSA 10`, attributes: [{ trait_type: "Grade", value: "PSA 10" }] } },
});
const OWNER = "CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf";

test("a DAS budget stop is a partial with its reason, and the partial result still prices", async () => {
  let calls = 0;
  const r = await enumerateHoldings(
    { chain: "solana", address: OWNER },
    {
      dasPages: 2,
      pageSize: 3,
      deps: {
        das: async () => ({ total: 3, limit: 3, page: ++calls, items: [0, 1, 2].map((i) => dasAsset(calls * 10 + i, OWNER)) }),
        credits: () => calls,
      },
    },
  );
  assert.equal(r.reads.dasPages, 2);
  assert.deepEqual(r.partial, { reason: "helius-budget", after: 6 });
  assert.ok(r.reads.legs.every((l) => !l.complete && l.stop === "helius-budget"));
  // Priced from the DAS metadata in hand (no card row): still resolves, still priced.
  const resolved = r.holdings.map((h) => resolveHolding(h, { row: null, meta: h.meta, columnKnown: false }));
  assert.equal(resolved.length, 6);
  assert.ok(resolved.every((h) => h.identity || h.unkeyed));
  const priced = priceHoldings(resolved, new Map(), listings);
  assert.equal(priced.length, 6);
});

test("the meter throwing is a helius-budget partial, not an error", async () => {
  const r = await enumerateHoldings(
    { chain: "solana", address: OWNER },
    { deps: { das: async () => { throw new Error("Helius credit budget exceeded this run: ~11 > 10 credits."); } } },
  );
  assert.equal(r.partial?.reason, "helius-budget");
  assert.equal(r.holdings.length, 0);
});

test("the wall clock stops the read as a timeout partial", async () => {
  let t = 0;
  const r = await enumerateHoldings(
    { chain: "solana", address: OWNER },
    {
      wallMs: 50,
      deps: {
        now: () => t,
        das: () => new Promise(() => { t = 100; }), // never answers; the clock passes the deadline
      },
    },
  );
  assert.equal(r.partial?.reason, "timeout");
});

const EVM = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed";
const BZ = "0xbb5ec6fd4b61723bd45c399840f1d868840ca16f";
const bsItem = (id: string, contract = BZ, name?: string) => ({ id, token: { address_hash: contract }, metadata: name ? { name, attributes: [] } : null });

test("EVM: the index finds candidates, the chain decides; burned and moved tokens are dropped and counted", async () => {
  const r = await enumerateHoldings(
    { chain: "evm", address: EVM },
    {
      deps: {
        raribleSearch: async () => ({ items: [] }),
        // What Blockscout claims (measured shape: burned and moved tokens still
        // listed), on a page that also carries another collection's NFT.
        blockscout: async () => ({ items: [bsItem("8306"), bsItem("17685"), bsItem("17686"), bsItem("20", BZ, "2023 Black Star Promo Snorlax #51 PSA 9"), bsItem("99", "0x02408abc8b18ef5475205ab70e5b6a6d227b94f8")], next_page_params: null }),
        // What the chain says: 8306 sold, 17685/17686 burned on redemption, 20 still here.
        owners: async () => new Map([["8306", "0x48c27ef6218bc4f0714dd00df6941868b1afa54a"], ["17685", "none"], ["17686", "none"], ["20", EVM]]),
      },
    },
  );
  assert.deepEqual(r.holdings.map((h) => [h.platform, h.tokenId, h.ownerVerified, h.meta?.name]), [["beezie", "20", true, "2023 Black Star Promo Snorlax #51 PSA 9"]]);
  const bz = r.reads.legs.find((l) => l.platform === "beezie")!;
  assert.deepEqual(bz.dropped, { burned: 2, moved: 1 });
  assert.equal(r.partial, null);
});

test("EVM: when no RPC answers, candidates are kept unverified and the result is partial", async () => {
  const r = await enumerateHoldings(
    { chain: "evm", address: EVM },
    {
      deps: {
        raribleSearch: async (body) => {
          const c = (body as { filter: { collections: string[] } }).filter.collections[0];
          return { items: [{ id: `${c}:7`, collection: c, tokenId: "7", supply: "1" }] };
        },
        blockscout: async () => ({ items: [bsItem("7")], next_page_params: null }),
        owners: async () => new Map(),
      },
    },
  );
  assert.equal(r.holdings.length, 2);
  assert.ok(r.holdings.every((h) => !h.ownerVerified));
  assert.deepEqual(r.partial, { reason: "owner-unverified", after: 2 });
  const priced = priceHoldings(r.holdings.map((h) => resolveHolding(h, { row: null, meta: null, columnKnown: false })), new Map(), listings);
  assert.ok(priced.every((h) => h.ownerVerified === false));
});

test("EVM: index pages are budgeted; the index's own burned and foreign-owned rows are skipped", async () => {
  let bsCalls = 0;
  const r = await enumerateHoldings(
    { chain: "evm", address: EVM },
    {
      rariblePagesPerChain: 1,
      blockscoutPages: 2,
      pageSize: 3,
      deps: {
        raribleSearch: async (body) => {
          const c = (body as { filter: { collections: string[] } }).filter.collections[0];
          return {
            continuation: "next",
            items: [
              { id: `${c}:1`, collection: c, tokenId: "1", supply: "1", ownerIfSingle: `ETHEREUM:${EVM}` },
              { id: `${c}:2`, collection: c, tokenId: "2", supply: "0", deleted: true },
              { id: `${c}:3`, collection: c, tokenId: "3", supply: "1", ownerIfSingle: "ETHEREUM:0x0000000000000000000000000000000000000001" },
            ],
          };
        },
        blockscout: async () => ({ items: [bsItem(String(++bsCalls))], next_page_params: { token_id: bsCalls } }),
        owners: async (_c, _k, ids) => new Map(ids.map((id) => [id, EVM])),
      },
    },
  );
  assert.deepEqual(r.holdings.map((h) => `${h.platform}:${h.tokenId}`).sort(), ["beezie:1", "beezie:2", "courtyard:1"]);
  assert.equal(r.partial?.reason, "rarible-budget");
  assert.equal(r.reads.rariblePages, 1);
  assert.equal(r.reads.blockscoutPages, 2);
  assert.equal(r.reads.legs.find((l) => l.platform === "beezie")?.stop, "blockscout-budget");
});

test("the holding cap is a partial with reason cap", async () => {
  const r = await enumerateHoldings(
    { chain: "solana", address: OWNER },
    { maxHoldings: 4, pageSize: 3, deps: { das: async ({ page }) => ({ total: 3, limit: 3, page: page as number, items: [0, 1, 2].map((i) => dasAsset((page as number) * 10 + i, OWNER)) }) } },
  );
  assert.deepEqual(r.partial, { reason: "cap", after: 4 });
});

test("an unkeyed holding names the index rule that refused it", async () => {
  const { identityKeyRefusal } = await import("./traits");
  const cases: [CardIdentityParts, string | null][] = [
    [P.charizard, null],
    [{ ...P.charizard, cardName: null }, "no-name"],
    [{ ...P.charizard, cardName: "PSA 10 POKEMO" }, "grade-as-name"],
    [{ ...P.charizard, set: null, number: null }, "no-set-or-number"],
  ];
  for (const [p, want] of cases) {
    assert.equal(identityKeyRefusal(p), want);
    assert.equal(identityKey("pokemon", p) === null, want !== null); // the two cannot drift
  }
  // Sneakers and sealed product are tokenized collectibles the index does not
  // pool:
  // listed, never dropped, with the rule that kept them out of the index.
  const sneaker = resolveHolding(
    { platform: "beezie", tokenId: "17685" },
    { row: null, meta: { name: "Rayssa Leal x Dunk Low", attributes: [{ trait_type: "Brand", value: "Nike" }, { trait_type: "Category", value: "Sneakers" }] }, columnKnown: false },
  );
  assert.equal(sneaker.identity, null);
  // The extractor reads no keyable name from a sneaker's title: the first rule.
  assert.equal(sneaker.unkeyed, "no-name");
  assert.equal(sneaker.name, "Rayssa Leal x Dunk Low");
});
