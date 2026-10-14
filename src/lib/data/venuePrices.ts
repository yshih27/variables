/**
 * Packs on sale, venue by venue, by price: every pack, box, machine and claw a
 * venue sells, from the /gacha catalog (getGachaData, the payload /gacha draws),
 * grouped by price, each price weighted by its share of the venue's recent pack
 * spend (its pulls × its price). A reader sees each venue's price range and
 * where its money goes inside it.
 *
 * ⚠️ EACH VENUE'S WEIGHTS ARE ITS OWN, AND EACH ROW SAYS OVER WHAT. Venues report
 * pulls over different windows (DYLI and Renaiss: 7 days; Collector Crypt and
 * Phygitals: 24 hours, estimated from the hours read when the day is not
 * complete), so a share is only ever of the venue's own spend, never across
 * venues. A venue whose catalog carries no pull counts (Beezie) shows its prices
 * unweighted, and a venue not in the catalog (Courtyard) is absent, not zero.
 */
import type { GachaPack } from "./gachaPacksCache";

export type PricePoint = {
  priceUsd: number;
  /** Names of the packs at this price, busiest first. */
  names: string[];
  pulls: number | null;
  /** Share of the venue's pack spend in the window, 0-100; null when unweighted. */
  spendSharePct: number | null;
};

export type VenuePriceRow = {
  venue: string;
  /** "7d" | "24h" | null (no pull counts). */
  window: "7d" | "24h" | null;
  /** True when the 24h counts are rates from a partial day. */
  estimated: boolean;
  points: PricePoint[];
};

/** Each venue's prices, cheapest first; venues in `venues` order. Pure. */
export function buildVenuePrices(packs: GachaPack[], venues: string[]): VenuePriceRow[] {
  const out: VenuePriceRow[] = [];
  for (const venue of venues) {
    const mine = packs.filter((p) => p.platform === venue && p.priceUsd > 0);
    if (!mine.length) continue;
    const window: VenuePriceRow["window"] = mine.some((p) => p.pulls7d != null) ? "7d" : mine.some((p) => p.pulls24h != null) ? "24h" : null;
    const pullsOf = (p: GachaPack): number | null => (window === "7d" ? p.pulls7d ?? null : window === "24h" ? p.pulls24h ?? null : null);
    const estimated = window === "24h" && mine.some((p) => p.pulls24hEstimated);
    const byPrice = new Map<number, GachaPack[]>();
    for (const p of mine) byPrice.set(p.priceUsd, [...(byPrice.get(p.priceUsd) ?? []), p]);
    const spendAt = (ps: GachaPack[]) => ps.reduce((s, p) => s + (pullsOf(p) ?? 0) * p.priceUsd, 0);
    const total = [...byPrice.values()].reduce((s, ps) => s + spendAt(ps), 0);
    const points: PricePoint[] = [...byPrice.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([priceUsd, ps]) => {
        const pulls = window ? ps.reduce((s, p) => s + (pullsOf(p) ?? 0), 0) : null;
        return {
          priceUsd,
          // Busiest first, each name once: a venue can sell one name at one price in several games.
          names: [...new Set([...ps].sort((a, b) => (pullsOf(b) ?? 0) - (pullsOf(a) ?? 0)).map((p) => p.name))],
          pulls,
          spendSharePct: window && total > 0 ? (100 * spendAt(ps)) / total : null,
        };
      });
    out.push({ venue, window: total > 0 ? window : null, estimated: total > 0 && estimated, points: total > 0 ? points : points.map((p) => ({ ...p, pulls: null, spendSharePct: null })) });
  }
  return out;
}
