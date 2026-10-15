import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVenueStrips, medianPackPrice } from "./venueStrips";
import type { VenueMix } from "./venueMix";
import type { VenuePriceRow } from "./venuePrices";
import type { VenueSpendRow } from "./venueSpend";
import type { VenuePlayersRow } from "./venuePlayers";

const point = (priceUsd: number, spendSharePct: number | null) => ({ priceUsd, names: [], pulls: null, spendSharePct });

test("median pack price: the first price whose running share of spend reaches half", () => {
  assert.equal(medianPackPrice({ points: [point(28, 30), point(48, 67), point(88, 3)] }), 48);
  assert.equal(medianPackPrice({ points: [point(5, 50), point(5000, 50)] }), 5);
  // Unsorted input, and weights that do not sum to 100.
  assert.equal(medianPackPrice({ points: [point(100, 1), point(10, 1), point(50, 2)] }), 50);
  // No weights: prices only, no median.
  assert.equal(medianPackPrice({ points: [point(10, null), point(20, null)] }), null);
});

test("each strip takes one figure per venue from the full chart's rows; unmeasured venues are named, not placed", () => {
  const mix: VenueMix = {
    from: "2026-09-14",
    to: "2026-10-13",
    days: 30,
    rows: [
      { venue: "beezie", marketUsd: 1, packsUsd: 3, marketPct: 24.4, typicalPct: 2.8, daily: [] },
      { venue: "renaiss", marketUsd: 1, packsUsd: 99, marketPct: 0.7, typicalPct: 0.5, daily: [] },
      { venue: "phygitals", marketUsd: null, packsUsd: 9, marketPct: null, typicalPct: null, daily: [] },
    ],
  };
  const prices: VenuePriceRow[] = [
    { venue: "renaiss", window: "7d", estimated: false, points: [point(28, 30), point(48, 67), point(88, 3)] },
    { venue: "collector-crypt", window: "24h", estimated: true, points: [point(50, 60), point(5000, 40)] },
    { venue: "beezie", window: null, estimated: false, points: [point(25, null)] },
  ];
  const spend: VenueSpendRow[] = [
    { venue: "collector-crypt", measured: true, wallets: 9, top1Pct: 71, top10Pct: 96, medianUsd: 250, since: "2026-01-05", coveragePct: 45 },
    { venue: "renaiss", measured: true, wallets: 9, top1Pct: 13.6, top10Pct: 57, medianUsd: 1500, since: "2025-11-06", coveragePct: 100 },
    { venue: "dyli", measured: false, wallets: null, top1Pct: null, top10Pct: null, medianUsd: null, since: null, coveragePct: null },
  ];
  const players: VenuePlayersRow[] = [
    { venue: "renaiss", measured: true, reason: null, since: "2025-11", months: [{ month: "2026-09", players: 936, firstTime: 231, returning: 705, coveragePct: 100 }], coverage: { min: 100, max: 100 } },
    { venue: "phygitals", measured: false, reason: "our records cover under half its pack spend", since: null, months: [], coverage: null },
  ];
  const venues = ["collector-crypt", "renaiss", "phygitals", "beezie", "dyli"];
  const [m, p, t, r] = buildVenueStrips({ mix, prices, spend, players, venues });

  assert.deepEqual(m.points.map((x) => [x.venue, x.text]), [["beezie", "24.4%"], ["renaiss", "0.7%"]]);
  assert.deepEqual(m.unmeasured, ["collector-crypt", "phygitals", "dyli"]);
  assert.equal(m.points[0].window, "30 days to Oct 13");

  assert.deepEqual(p.points.map((x) => [x.venue, x.text, x.window]), [["collector-crypt", "$50", "24 hours, estimated"], ["renaiss", "$48", "7 days"]]);
  assert.ok(p.unmeasured.includes("beezie"), "prices without pull counts have no median");

  assert.deepEqual(t.points.map((x) => [x.venue, x.text]), [["collector-crypt", "71.0%"], ["renaiss", "13.6%"]]);
  assert.ok(t.unmeasured.includes("dyli"));

  assert.deepEqual(r.points.map((x) => [x.venue, x.text, x.window]), [["renaiss", "75%", "Sep 2026"]]);
  assert.ok(r.unmeasured.includes("phygitals"));
  assert.equal(r.href, "/platforms#players-venues");
});
