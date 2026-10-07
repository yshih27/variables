/**
 * test:gacha — the /gacha payload's rules (brief-backend-gacha-renaiss PR B):
 * the plausibility gate and the hero, CC's realized stats over listener
 * coverage, DYLI boxes and Renaiss machines as packs (null stated fields never
 * assumed), the Phygitals catalog from its feed, the hits fallback by heartbeat
 * age, the 7-day window and the venue list. Constructed rows only; no network,
 * no database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gatePack, isMixedPool, leadMedian, plausibilityGate, withMixedPool, MEDIAN_MAX_OVER_STATED_EV, THIN_N } from "./gachaPackView";
import { bestTypicalPack, chooseHits, hitsWithinDays, liveHeartbeatMs, LIVE_HEARTBEAT_MAX_MS } from "./fetchGacha";
import { gachaVenues } from "./gachaVenues";
import { coverageSegments, statsFromCoveredPulls, tierOfValue, COVERAGE_GAP_MS, MIN_SEGMENT_MS } from "./ccRealized";
import { dyliPacks, renaissPacks, RENAISS_VALUE_BASIS, DYLI_VALUE_BASIS, type DyliProductRow, type RenaissPackPull } from "./warmers/gachaPacksVenues";
import { slugOfProduct } from "./warmers/gachaPacks";
import { phygitalsCatalog, phygitalsCategoryOfSlug, type PhygitalsPackOdds } from "../phygitals/client";
import { chaseOf, mergeRecent } from "../dyli/boxPrizes";
import type { GachaPack } from "./gachaPacksCache";
import type { GachaBigHit } from "./gachaDuneCache";

const NOW = Date.parse("2026-10-07T04:00:00Z");
const H = 3_600_000;
const D = 24 * H;

function pack(o: Partial<GachaPack>): GachaPack {
  return {
    id: "x", platform: "collector-crypt", platformName: "CC", platformShort: "CC", chain: "Solana", category: null, categoryLabel: "Mixed", categoryDerived: false,
    name: "x", image: null, priceUsd: 50, currency: "USDC", packType: null, topHitsAvailable: [], topHitAvailableUsd: null, poolDepth: null,
    oddsStated: null, hitOddsStated: null, evStated: null, evStatedUsd: null, floorUsd: null, stockCount: null, buybackPct: 0.85, buybackBasis: "stated",
    topHitRealized: null, topHitRealizedUsd: null, oddsRealized: null, hitOddsRealized: null, valueBands: null, evRealized: null, medianReturn: null,
    realizedN: null, realizedWindow: null, pulls24h: null, evBasis: "realized", oddsBasis: "stated", notDirectlyComparable: false, asOf: "", sources: { advertised: null, realized: null },
    ...o,
  };
}

// ── The plausibility gate and the hero ──────────────────────────────────────

test("gate: a median above its own mean is withheld, with its reason", () => {
  // The Oct 7 headline's shape, made to fail: a median that a right-skewed payout cannot have.
  const p = pack({ medianReturn: 2.36, evRealized: 1.9, realizedN: 25 });
  const v = plausibilityGate(p);
  assert.equal(v.withheld, true);
  assert.match(v.reason!, /median 2.36× is more than 10% above its own mean 1.90× \(n=25\)/);
  assert.equal(leadMedian(p), null);
  const gated = gatePack(p);
  assert.equal(gated.medianReturn, null);
  assert.match(gated.medianWithheld!, /above its own mean/);
});

test("gate: a low-variance median a hair above its mean passes (within 10%)", () => {
  const p = pack({ id: "dyli:pack-ripper", platform: "dyli", medianReturn: 1.02, evRealized: 1.0, realizedN: 67 });
  assert.deepEqual(plausibilityGate(p), { withheld: false, reason: null });
  assert.equal(gatePack(p).medianWithheld, null);
});

test("gate: a median above 1.5 × the stated EV is withheld; one under it passes", () => {
  const over = pack({ medianReturn: 1.7, evRealized: 3, evStated: 1.05, realizedN: 400 });
  assert.equal(MEDIAN_MAX_OVER_STATED_EV, 1.5);
  assert.match(plausibilityGate(over).reason!, /above 1.5× the venue's stated EV 1.05×/);
  const ok = pack({ medianReturn: 0.8, evRealized: 1.13, evStated: 1.05, realizedN: 10_949 });
  assert.deepEqual(plausibilityGate(ok), { withheld: false, reason: null });
  assert.equal(gatePack(ok).medianWithheld, null);
  assert.deepEqual(leadMedian(ok), { value: 0.8, basis: "realized", n: 10_949 });
});

test("hero: never a gated median, a thin sample, or a pack with no buyback", () => {
  const gated = pack({ id: "gated", medianReturn: 2.36, evRealized: 1.9, realizedN: 25, buybackPct: 0.85 });
  const thin = pack({ id: "thin", medianReturn: 1.4, evRealized: 2, realizedN: THIN_N - 1, buybackPct: 0.9 });
  const noBuyback = pack({ id: "renaiss", medianReturn: 1.06, evRealized: 1.08, realizedN: 82_115, buybackPct: null });
  const real = pack({ id: "dyli", medianReturn: 1.03, evRealized: 1.1, realizedN: 77, buybackPct: 0.9 });
  const best = bestTypicalPack([gated, thin, noBuyback, real]);
  assert.equal(best?.pack.id, "dyli");
  assert.ok(Math.abs(best!.typicalNet - 0.927) < 1e-9);
  assert.equal(bestTypicalPack([gated, thin, noBuyback]), null, "nothing headline-worthy: no headline");
});

// ── CC realized over listener coverage ──────────────────────────────────────

test("coverage: gaps longer than the threshold split segments; short segments drop", () => {
  const t0 = NOW - 10 * H;
  const run = (from: number, to: number, step = 30_000) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
  const times = [...run(t0, t0 + 2 * H), ...run(t0 + 2 * H + COVERAGE_GAP_MS + 60_000, t0 + 2 * H + COVERAGE_GAP_MS + 60_000 + 20 * 60_000), ...run(t0 + 5 * H, t0 + 7 * H)];
  const segs = coverageSegments(times);
  assert.equal(segs.length, 2, "the 20-minute stretch is under MIN_SEGMENT_MS and drops");
  assert.ok(MIN_SEGMENT_MS > 20 * 60_000);
  assert.deepEqual(segs[0], [t0, t0 + 2 * H]);
  assert.deepEqual(segs[1], [t0 + 5 * H, t0 + 7 * H]);
  assert.deepEqual(coverageSegments([]), []);
});

test("CC stats: only covered pulls count; tiers from the stated ranges; 24h exact only when covered end to end", () => {
  const ranges = { common: { start: 30, end: 60 }, uncommon: { start: 60, end: 110 }, rare: { start: 110, end: 250 }, epic: { start: 250, end: 5001 } };
  assert.equal(tierOfValue(300, ranges), "epic");
  assert.equal(tierOfValue(45, ranges), "common");
  const seg: [number, number][] = [[NOW - 5 * H, NOW - 1 * H]];
  const pulls = [
    { t: NOW - 4 * H, valueUsd: 40 },
    { t: NOW - 3 * H, valueUsd: 40 },
    { t: NOW - 2 * H, valueUsd: 100 },
    { t: NOW - 2 * H, valueUsd: 500 },
    { t: NOW - 8 * H, valueUsd: 9_999 }, // outside coverage: not counted
  ];
  const s = statsFromCoveredPulls({ priceUsd: 50, tierRanges: ranges }, pulls, seg, NOW)!;
  assert.equal(s.n, 4);
  assert.equal(s.medianReturn, (0.8 + 2) / 2);
  assert.ok(Math.abs(s.evMultiple - (0.8 + 0.8 + 2 + 10) / 4) < 1e-9);
  assert.deepEqual(s.odds, [
    { tier: "epic", pct: 0.25 },
    { tier: "rare", pct: 0 },
    { tier: "uncommon", pct: 0.25 },
    { tier: "common", pct: 0.5 },
  ]);
  assert.equal(s.hitOdds, 0.5);
  assert.equal(s.pulls24hEstimated, true, "4 covered hours of the last 24: an estimate");
  assert.equal(s.pulls24h, Math.round((4 / (4 * H)) * D));
  assert.equal(statsFromCoveredPulls({ priceUsd: 50 }, pulls, [], NOW), null, "no coverage: withheld, not estimated");
});

// ── DYLI boxes and Renaiss machines as packs ────────────────────────────────

test("a DYLI box: declared fields stated, realized at DYLI's FMV mark, chase as the pool; nothing assumed", () => {
  const products: DyliProductRow[] = [
    { product_id: "dyli:2397", name: "Pack Ripper", price_usd: 15, active: true, odds_stated: { declared_expected_value_usd: 15.5, declared_buyback_rate: 0.9, inventory_count: 4567, odds_buckets: [{ min: 0, max: 12, percent: 31, tier: "Common" }, { min: 15.01, max: 18, percent: 44, tier: "Uncommon" }, { min: 375.01, max: 2500, percent: 0.01, tier: "Mythical" }] } },
    { product_id: "dyli:1", name: "Bare", price_usd: 10, active: true, odds_stated: null },
    { product_id: "dyli:2", name: "Off", price_usd: 10, active: false, odds_stated: null },
  ];
  const pulls = [
    { product_id: "dyli:2397", price_usd: 15, prize_value_usd: 59.36, prize_canonical_id: "dyli:collectible:4572", pulled_at: new Date(NOW - H).toISOString() },
    { product_id: "dyli:2397", price_usd: 15, prize_value_usd: 9, prize_canonical_id: "dyli:collectible:1", pulled_at: new Date(NOW - 3 * D).toISOString() },
  ];
  const prizes = { generatedAt: "", boxes: { "2397": { name: "Pack Ripper", image: "img", brand: "Pokemon", type: "Packs", chase: chaseOf([{ name: "Fossil Booster", fmv_usd: 672.19, product_id: 16103, image_url: "c" }]), recent: [{ pullId: 547709, collectibleId: 4572, title: "Lost Thunder Booster", image: "i", fmvUsd: 59.36, tier: "Rare", pulledAt: "2026-10-06T20:28:26Z" }] } } };
  const { packs, prizes: pool } = dyliPacks(products, pulls, prizes, NOW, "asof");
  assert.deepEqual(packs.map((p) => p.id), ["dyli:2397", "dyli:1"], "inactive boxes are not packs");
  const p = packs[0];
  assert.ok(Math.abs(p.evStated! - 15.5 / 15) < 1e-9);
  assert.equal(p.buybackPct, 0.9);
  assert.equal(p.category, "pokemon");
  assert.equal(p.oddsStated?.[0].label, "Mythical $375–2,500");
  assert.ok(Math.abs(p.hitOddsStated! - (0.44 + 0.0001)) < 1e-9, "a bucket counts as a hit when its floor is at or above the price");
  assert.equal(p.realizedValueBasis, DYLI_VALUE_BASIS);
  assert.equal(p.realizedN, 2);
  assert.equal(p.pulls24h, 1);
  assert.equal(p.pulls7d, 2);
  assert.equal(p.topHitRealized?.name, "Lost Thunder Booster", "named from the box-prizes snapshot");
  assert.equal(pool[0].name, "Fossil Booster");
  assert.equal(pool[0].pulled, undefined, "the chase list is the pool, not pulled prizes");
  const bare = packs[1];
  for (const k of ["evStated", "evStatedUsd", "oddsStated", "hitOddsStated", "buybackPct", "realizedN", "medianReturn"] as const) assert.equal(bare[k], null, k);
});

test("a Renaiss machine: no stated odds, EV or buyback; realized in Renaiss's stated value; unnamed pulls counted, not shown", () => {
  const pull = (o: Partial<RenaissPackPull> & { pulled_at: string }): RenaissPackPull => ({
    pull_id: Math.random().toString(36).slice(2), kind: "checkout", product_id: "m48", machine_name: "PANDORA 48", price_usd: 48,
    prize_instance_id: null, prize_canonical_id: null, prize_value_usd: null, prize_card_name: null, prize_grade_label: null, prize_image_url: null, ...o,
  });
  const rows = [
    pull({ pulled_at: new Date(NOW - H).toISOString(), prize_value_usd: 60, prize_card_name: "Slowking", prize_grade_label: "PSA 10", prize_image_url: "img", prize_instance_id: "rn-1", prize_canonical_id: "pokemon|x" }),
    pull({ pulled_at: new Date(NOW - 2 * D).toISOString(), prize_value_usd: 24, prize_card_name: "Larvitar", prize_canonical_id: "pokemon|y" }),
    pull({ pulled_at: new Date(NOW - 3 * D).toISOString() }), // unnamed: counted, not shown
    pull({ product_id: "old", pulled_at: new Date(NOW - 5 * D).toISOString(), prize_value_usd: 10 }), // no pull in 72h: not a live pack
  ];
  const { packs, prizes, unnamed } = renaissPacks(rows, NOW, "asof");
  assert.deepEqual(packs.map((p) => p.name), ["PANDORA 48"]);
  const p = packs[0];
  for (const k of ["oddsStated", "hitOddsStated", "evStated", "evStatedUsd", "buybackPct", "topHitAvailableUsd"] as const) assert.equal(p[k], null, k);
  assert.equal(p.realizedValueBasis, RENAISS_VALUE_BASIS);
  assert.equal(p.pulls7d, 3);
  assert.equal(p.pulls24h, 1);
  assert.equal(p.realizedN, 2);
  assert.equal(p.hitOddsRealized, 0.5, "60 ≥ 48, 24 < 48");
  assert.ok(Math.abs(p.evRealized! - 84 / 96) < 1e-9);
  assert.equal(p.category, "pokemon");
  assert.equal(p.topHitRealized?.name, "Slowking");
  assert.deepEqual(prizes.map((x) => [x.name, x.pulled, x.valueBasis]), [["Slowking", true, RENAISS_VALUE_BASIS], ["Larvitar", true, RENAISS_VALUE_BASIS]]);
  assert.equal(unnamed, 1, "the live pack's unnamed pull (a stale machine is not a pack, so not counted)");
});

// ── Phygitals catalog ───────────────────────────────────────────────────────

test("Phygitals: every live /vm/available pack, its game from its slug, pulls joined by slug", () => {
  const odds = (slug: string, o: Partial<PhygitalsPackOdds> = {}): [string, PhygitalsPackOdds] => [slug, { slug, name: "Elite Pack", priceUsd: 50, evUsd: 51, minEvUsd: null, maxEvUsd: null, buybackPct: 0.85, pulls7d: 10, enable: true, inStock: true, bands: [], ...o }];
  const cat = phygitalsCatalog(new Map([odds("elite-pack"), odds("elite-one-piece-pack"), odds("elite-pack-1", { inStock: false, pulls7d: 0 }), odds("legend-pack-1dpaec", { priceUsd: 250 }), odds("rookie-riftbound-pack", { priceUsd: 10 })]));
  assert.deepEqual(cat.map((c) => [c.slug, c.category, c.name]), [
    ["rookie-riftbound-pack", null, "Elite"],
    ["elite-one-piece-pack", "one_piece", "Elite"],
    ["elite-pack", "pokemon", "Elite"],
    ["legend-pack-1dpaec", null, "Elite"],
  ]);
  assert.equal(phygitalsCategoryOfSlug("legend-football"), "sports");
  assert.equal(slugOfProduct("phygitals:elite-one-piece-pack-9ovh6m", ["elite-pack", "elite-one-piece-pack"]), "elite-one-piece-pack");
  assert.equal(slugOfProduct("phygitals:13", ["elite-pack"]), null);
});

// ── Hits ────────────────────────────────────────────────────────────────────

const hit = (at: string, valueUsd: number, mint = at): GachaBigHit => ({ platform: "collector-crypt", mint, name: "card", tier: "", valueUsd, image: null, imageFallback: null, at });

test("hits: the live feed only while its heartbeat is under 15 minutes old; else the warmers, as of their time", () => {
  const live = { generatedAt: new Date(NOW - 2 * 60_000).toISOString(), hits: [hit(new Date(NOW - 60_000).toISOString(), 900, "live")], sources: { cc: new Date(NOW - 2 * 60_000).toISOString() } };
  const warmerHits = [hit(new Date(NOW - 3 * D).toISOString(), 5000, "w")];
  const fresh = chooseHits({ live, warmerHits, warmerAsOf: "2026-10-07T03:35:00.000Z", nowMs: NOW });
  assert.equal(fresh.hitsSource, "live");
  assert.equal(fresh.hitsAsOf, live.sources.cc);
  assert.deepEqual(fresh.hits.map((h) => h.mint), ["w", "live"]);
  const stale = chooseHits({ live, warmerHits, warmerAsOf: "2026-10-07T03:35:00.000Z", nowMs: NOW + LIVE_HEARTBEAT_MAX_MS + 60_000 });
  assert.equal(stale.hitsSource, "warmers");
  assert.equal(stale.hitsAsOf, "2026-10-07T03:35:00.000Z");
  assert.deepEqual(stale.hits.map((h) => h.mint), ["w"]);
  assert.equal(liveHeartbeatMs(null), null);
});

test("hits: the window is 7 days by each hit's own time", () => {
  const hits = [hit(new Date(NOW - 6 * D).toISOString(), 1), hit(new Date(NOW - 8 * D).toISOString(), 99_999), hit(new Date(NOW - 13 * D).toISOString(), 50_000)];
  assert.deepEqual(hitsWithinDays(hits, 7, NOW).map((h) => h.valueUsd), [1], "the two-week-old Dune hit no longer leads Biggest Hit 7d");
});

// ── Venues ──────────────────────────────────────────────────────────────────

test("venues: every gacha venue with its kind; Courtyard listed with its reason", () => {
  const v = gachaVenues([{ platform: "collector-crypt" }, { platform: "beezie" }, { platform: "renaiss" }]);
  const by = Object.fromEntries(v.map((x) => [x.key, x]));
  assert.equal(by.beezie.kind, "claw");
  assert.equal(by["collector-crypt"].kind, "machine");
  assert.equal(by.dyli.kind, "box");
  assert.equal(by.renaiss.kind, "pack");
  assert.equal(by.renaiss.covered, true);
  assert.equal(by.courtyard.covered, false);
  assert.match(by.courtyard.reason!, /publishes no pack catalog/);
  assert.equal(by.dyli.covered, false);
  assert.match(by.dyli.reason!, /no DYLI box is in this build's catalog/);
});

test("DYLI box prizes: chase cards deduped and ranked; recent pulls merged newest first, capped", () => {
  const c = chaseOf([{ name: "A", fmv_usd: 5, product_id: 1 }, { name: "B", fmv_usd: 50, product_id: 2 }, { name: "A again", fmv_usd: 6, product_id: 1 }, { name: "no value", fmv_usd: 0 }]);
  assert.deepEqual(c.map((x) => x.name), ["B", "A"]);
  const r = (id: number, at: string) => ({ pullId: id, collectibleId: null, title: `t${id}`, image: null, fmvUsd: 1, tier: null, pulledAt: at });
  assert.deepEqual(mergeRecent([r(1, "2026-10-01"), r(2, "2026-10-02")], [r(3, "2026-10-03"), r(2, "2026-10-02")], 2).map((x) => x.pullId), [3, 2]);
});

// ── Mixed pools ─────────────────────────────────────────────────────────────

test("mixedPool: true only when the pool spans more than one game, each with at least two prizes", () => {
  const pr = (packId: string, category: string | null, name: string | null = null) => ({ packId, category, name, traits: null });
  // CONSTRUCTED from the shapes on Oct 7: a Beezie claw tags each prize with its game.
  const claw = [pr("beezie:1", "pokemon"), pr("beezie:1", "pokemon"), pr("beezie:1", "one_piece"), pr("beezie:1", "one_piece")];
  assert.equal(isMixedPool(claw), true);
  // One game, no tab for it: not mixed.
  const watches = [pr("cc:watch", null, "Rolex Submariner"), pr("cc:watch", null, "Omega Speedmaster")];
  assert.equal(isMixedPool(watches), false, "prizes that name no game are not a second game");
  // A single stray prize of another game is not a mixed pool.
  assert.equal(isMixedPool([pr("x", "pokemon"), pr("x", "pokemon"), pr("x", "pokemon"), pr("x", "one_piece")]), false);
  assert.equal(isMixedPool([]), false);
  const packs = withMixedPool([pack({ id: "beezie:1" }), pack({ id: "cc:watch" }), pack({ id: "no-prizes" })], [...claw, ...watches]);
  assert.deepEqual(packs.map((p) => [p.id, p.mixedPool]), [["beezie:1", true], ["cc:watch", false], ["no-prizes", false]]);
});
