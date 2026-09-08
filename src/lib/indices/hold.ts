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
 * ⚠️ RE-HELD (Sep 8, 2026), THIS TIME THE WHOLE SERIES. The repeat-sales rebuild passed a
 * test that rewarded smoothness: it rose in 31 of 31 weeks (+83% since Feb) while market
 * cap sat flat. Diagnosis on the pairs: resales close above the prior sale ~2:1 at every
 * holding period and the per-week return FALLS with holding period (1-week flips +5.4%/wk,
 * 6-month holds +1.2%/wk) — selection of what gets resold, compounded by an estimator
 * that smears a positive drift across each pair's span. See
 * docs/roadmap/brief-backend-price-index-v3.md. `since: null` withholds every point.
 *
 * v3 ATTEMPTED AND NOT SHIPPED (Sep 8). Identity-level comparables were built
 * (src/lib/data/identityIndex.ts) to remove v2's resale selection. The panel is too
 * thin to carry them: only 13.3% of sales land in an identity with n>=2 in their
 * week, and the overlap of such identities between ADJACENT weeks is median 2,
 * max 10 — so 0 of 22 steps clear the market floor of 20 and v3 publishes no series
 * at all. The bias tests also still fail on the identity sample (per-week rate
 * 1w +4.58% vs 5-12w +2.38% for Pokemon, spread 2.20pp against a 1pp tolerance),
 * and not one of the ten most-traded PSA 10 identities traded in both Feb and Sep,
 * so the level anchor cannot be computed either. Per the brief's gate, the hold
 * therefore STAYS and v3 is not wired into the warmer. See
 * docs/roadmap/brief-backend-price-index-v3.md and the PR that added
 * src/lib/data/biasTests.ts.
 *
 * (Earlier note kept for the record.) The rebuilt repeat-sales index shipped in the PR that flipped this
 * flag (src/lib/data/repeatSalesIndex.ts). Measured on the backfilled history,
 * V-MKT week-over-week changes now have lag-1 autocorrelation +0.56 with ZERO sign
 * flips in 31 steps (was -0.32 with 16), and INV-11 keeps a thin-week step off the
 * blob. The file and `applyPriceIndexHold` stay in place, inert, so the same switch
 * is one line away if a future method question ever needs it again.
 *
 * Do not set `active: true` without a finding of the same weight as the one above.
 */
export const PRICE_INDEX_HOLD = {
  active: true,
  /** Last week-end close that stays visible (inclusive). */
  /** Last close that stays visible (inclusive); NULL withholds the whole series. */
  since: null as string | null,
  /** Short caption for headline surfaces. */
  label: "index withheld · method under review",
  /** Tooltip / long form. */
  title:
    "Price index withheld while the method is rebuilt — the repeat-sales series rose every week on a resale-selection bias and could not print a down week; nothing is published until a method passes a bias test",
} as const;

const HOLD_CUTOFF_MS = PRICE_INDEX_HOLD.since ? Date.parse(`${PRICE_INDEX_HOLD.since}T23:59:59.999Z`) : null;

/** Truncate a price-index series to the held close. Identity when the hold is off. */
export function applyPriceIndexHold<T extends { ts: string }>(points: T[]): T[] {
  if (!PRICE_INDEX_HOLD.active) return points;
  if (HOLD_CUTOFF_MS == null) return []; // whole series withheld
  return points.filter((p) => {
    const t = Date.parse(p.ts);
    return Number.isFinite(t) && t <= HOLD_CUTOFF_MS;
  });
}
