/**
 * PRICE-INDEX HOLD — the one switch that keeps a known-bad number off the site.
 *
 * ⚠️ WHY THIS EXISTS (Sep 7, 2026). The stratified-median price index buckets sales
 * into set|grade cells and measures each cell against whatever sold in its first
 * week. Thin cells (1–2 trades) carry relatives of 30–114× and supply most of the
 * printed level; the week-over-week series is independent noise (lag-1
 * autocorrelation −0.32, 11 sign flips in 21 weeks) while repeat sales of the same
 * card move +0.6% to +2.6% a week with no sign flips. The week ending Sep 6 printed
 * +40.5%. Until the index is rebuilt on repeat sales
 * (docs/roadmap/brief-backend-price-index-repeat-sales.md), every price-index
 * surface is HELD at the last close published before the finding, and no weekly
 * change is shown anywhere. `readIndexSeries` applies the truncation, so the
 * studio, the seed, the API, the report and the OG images all agree by construction.
 *
 * ✅ LIFTED — the rebuilt repeat-sales index shipped in the PR that flipped this
 * flag (src/lib/data/repeatSalesIndex.ts). Measured on the backfilled history,
 * V-MKT week-over-week changes now have lag-1 autocorrelation +0.56 with ZERO sign
 * flips in 31 steps (was -0.32 with 16), and INV-11 keeps a thin-week step off the
 * blob. The file and `applyPriceIndexHold` stay in place, inert, so the same switch
 * is one line away if a future method question ever needs it again.
 *
 * Do not set `active: true` without a finding of the same weight as the one above.
 */
export const PRICE_INDEX_HOLD = {
  active: false,
  /** Last week-end close that stays visible (inclusive). */
  since: "2026-08-30",
  /** Short caption for headline surfaces. */
  label: "held at Aug 30 close · method under review",
  /** Tooltip / long form. */
  title:
    "Price index held at its Aug 30 close while the method is rebuilt on repeat sales — no weekly change is published until then",
} as const;

const HOLD_CUTOFF_MS = Date.parse(`${PRICE_INDEX_HOLD.since}T23:59:59.999Z`);

/** Truncate a price-index series to the held close. Identity when the hold is off. */
export function applyPriceIndexHold<T extends { ts: string }>(points: T[]): T[] {
  if (!PRICE_INDEX_HOLD.active) return points;
  return points.filter((p) => {
    const t = Date.parse(p.ts);
    return Number.isFinite(t) && t <= HOLD_CUTOFF_MS;
  });
}
