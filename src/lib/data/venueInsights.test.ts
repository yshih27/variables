import { test } from "node:test";
import assert from "node:assert/strict";
import {
  completeMonths,
  identityLanguage,
  marketPosition,
  sameCardGaps,
  SAME_CARD_MIN_N,
  type ComparableSale,
} from "./venueInsights";
import type { SeriesPoint } from "./metricSnapshots";

const NOW = Date.parse("2026-10-14T03:00:00Z");
const day = (iso: string, value: number): SeriesPoint => ({ ts: `${iso}T00:00:00.000Z`, value });

test("complete months stop before the running one", () => {
  assert.deepEqual(completeMonths(NOW, 3), ["2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(completeMonths(Date.parse("2026-01-02T00:00:00Z"), 2), ["2025-11", "2025-12"]);
});

test("market position: share and rank per complete month, the running month left out", () => {
  const series = new Map<string, SeriesPoint[]>([
    ["collector-crypt", [day("2026-09-01", 600), day("2026-09-15", 300), day("2026-08-10", 500), day("2026-10-01", 9999)]],
    ["renaiss", [day("2026-09-02", 100), day("2026-08-11", 50)]],
    ["beezie", [day("2026-09-03", 0), day("2026-08-12", 80)]],
  ]);
  const m = marketPosition(series, NOW, 2);
  assert.deepEqual(m.months, ["2026-08", "2026-09"]);
  assert.deepEqual(m.totalsUsd, [630, 1000], "October's running month is not counted");
  assert.deepEqual(m.venueCounts, [3, 2], "a venue with no spend that month is not a venue that month");
  assert.deepEqual(m.venues.renaiss.rank, [3, 2]);
  assert.ok(Math.abs(m.venues.renaiss.sharePct[1]! - 10) < 1e-9);
  assert.deepEqual(m.venues.beezie.rank, [2, null], "no spend: no rank and no share, never zero");
  assert.equal(m.venues.beezie.sharePct[1], null);
});

const sale = (identity: string, platform: string, month: string, priceUsd: number): ComparableSale => ({
  identity,
  platform,
  ts: `${month}-15T12:00:00.000Z`,
  priceUsd,
});

test("same card: this venue's median against the other venues' median, per identity-month", () => {
  const sales: ComparableSale[] = [];
  // SAME_CARD_MIN_N Japanese identities where Renaiss sells 20% above, each in one month.
  for (let i = 0; i < SAME_CARD_MIN_N; i++) {
    const id = `pokemon|set|${i}|CARD ${i}|PSA 10||Japanese`;
    sales.push(sale(id, "renaiss", "2026-09", 120), sale(id, "renaiss", "2026-09", 120), sale(id, "beezie", "2026-09", 100));
  }
  // A shared English identity: one comparison, under the floor on its own.
  sales.push(sale("pokemon|set|x|ENGLISH|PSA 9||", "renaiss", "2026-08", 80), sale("pokemon|set|x|ENGLISH|PSA 9||", "collector-crypt", "2026-08", 100));
  // Different months never compare; a sale outside the window never counts.
  sales.push(sale("pokemon|set|y|Y|PSA 10||", "renaiss", "2026-07", 50), sale("pokemon|set|y|Y|PSA 10||", "beezie", "2026-08", 10));
  sales.push(sale("pokemon|set|z|Z|PSA 10||", "renaiss", "2025-01", 50), sale("pokemon|set|z|Z|PSA 10||", "beezie", "2025-01", 10));
  const g = sameCardGaps(sales, "renaiss", ["2026-07", "2026-08", "2026-09"])!;
  assert.equal(g.identities, SAME_CARD_MIN_N + 2, "the out-of-window identity is not counted");
  assert.equal(g.sharedIdentities, SAME_CARD_MIN_N + 2, "y sold on two venues in the window, in different months");
  assert.equal(g.all!.n, SAME_CARD_MIN_N + 1, "y's two months never pair");
  assert.ok(Math.abs(g.all!.medianRatio - 1.2) < 1e-9);
  assert.deepEqual(g.byLanguage.map((l) => l.language), ["Japanese"], "English has one comparison: under the floor, left out");
  assert.ok(Math.abs(g.byLanguage[0].higherPct - 100) < 1e-9);
  assert.deepEqual(g.byVenue.map((v) => v.venue), ["beezie"]);
});

test("same card: no identity of the venue in the window is no comparison at all", () => {
  assert.equal(sameCardGaps([sale("a|b|1|C|PSA 10||", "beezie", "2026-09", 10)], "renaiss", ["2026-09"]), null);
});

test("an identity's language is its key's last field, English when empty", () => {
  assert.equal(identityLanguage("pokemon|151|173|PIKACHU|PSA 10||Japanese"), "Japanese");
  assert.equal(identityLanguage("pokemon|crown-zenith|160|PIKACHU|PSA 10||"), "English");
});
