/**
 * The short-feed check the price-index warmer runs before it writes anything.
 *
 * A venue leg that fails or comes back empty already throws (`buildSalePanel`
 * with `strict`). A leg that comes back SHORT does not: on Oct 7 Beezie's
 * /activity began returning one page of 40 events, and a core run built the
 * panel from 17 Beezie sales and published a 3-series index (from 9) with every
 * index gate green. The panel's sales per venue only grow between runs, bar the
 * rolling windows some legs read, so a venue at less than half its last
 * published count is a short feed, not a market.
 */

/** A venue below this many sales in the last published panel is not checked. */
export const PANEL_SHRINK_MIN_SALES = 200;

export type ShortVenue = { venue: string; before: number; after: number };

/** Sales per venue. */
export function salesByVenue(rows: readonly { platform: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.platform, (m.get(r.platform) ?? 0) + 1);
  return m;
}

/** Every venue that carried at least `minSales` before and fewer than half of them now. */
export function shortVenues(
  before: readonly { platform: string }[],
  after: readonly { platform: string }[],
  minSales = PANEL_SHRINK_MIN_SALES,
): ShortVenue[] {
  const now = salesByVenue(after);
  return [...salesByVenue(before)]
    .filter(([venue, n]) => n >= minSales && (now.get(venue) ?? 0) < n / 2)
    .map(([venue, n]) => ({ venue, before: n, after: now.get(venue) ?? 0 }));
}
