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
 * Lifting the hold = set `active: false` (or delete this file) in the PR that ships
 * the rebuilt index. Do not lift it for any other reason.
 */
export const PRICE_INDEX_HOLD = {
  active: true,
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
