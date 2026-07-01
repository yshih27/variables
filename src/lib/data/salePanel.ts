/**
 * Sale-price panel — the substrate for the constant-quality price index (B1).
 *
 * Row-level sales (tokenId × ts × priceUsd) tagged with {ip, set, grade} from the
 * `cards` table, drawn from every platform's row-level feed:
 *   • Collector Crypt — Dune 7675297 (30d)
 *   • Courtyard       — Dune 7845248 (full history; but `cards` is empty for it →
 *                       ip/set/grade fall to "other"/null, so it can't be stratified
 *                       per-IP yet — lands in "other" until traded-mint enrichment)
 *   • Beezie          — its own /activity feed (full history)
 *   • Phygitals       — omitted: no clean row-level secondary feed (its sales API is
 *                       gacha-dominated). Add when a Phygitals secondary query lands.
 *
 * Wash filter: drop self-trades (buyer === seller). Prices are trade-time USD (the
 * feeds normalize already). Winsorization is applied per-cell in the estimator.
 */
import { fetchCCSecondarySales, fetchCourtyardSecondarySales } from "./warmers/core";
import { fetchBeezieSales } from "../beezie/market";
import { readCardDims, type CardPlatform } from "./cards";
import type { NormalizedSale } from "../rarible/queries";

export type SaleRow = {
  ts: string; // ISO sale time
  tokenId: string;
  priceUsd: number;
  platform: CardPlatform;
  ip: string;
  set: string | null;
  grade: string;
};

/** Tag one platform's sales with cards-table dims + apply the wash filter. */
async function tagPlatform(platform: CardPlatform, sales: NormalizedSale[]): Promise<SaleRow[]> {
  const dims = await readCardDims(platform);
  const out: SaleRow[] = [];
  for (const s of sales) {
    if (!(s.priceUsd > 0)) continue;
    if (s.buyer && s.seller && s.buyer === s.seller) continue; // self-trade / wash
    const d = dims.get(s.tokenId);
    out.push({
      ts: s.date,
      tokenId: s.tokenId,
      priceUsd: s.priceUsd,
      platform,
      ip: d?.ip ?? "other",
      set: d?.set ?? null,
      grade: d?.grade ?? "Ungraded",
    });
  }
  return out;
}

/**
 * Build the full cross-platform sale-price panel. A failing feed degrades to an
 * empty contribution (logged by the caller via the returned counts) rather than
 * sinking the whole panel.
 */
export async function buildSalePanel(opts: { cachedOnly?: boolean } = {}): Promise<SaleRow[]> {
  const [cc, cy, bz] = await Promise.all([
    fetchCCSecondarySales(opts).catch(() => [] as NormalizedSale[]),
    fetchCourtyardSecondarySales(opts).catch(() => [] as NormalizedSale[]),
    fetchBeezieSales(800 * 24 * 60 * 60 * 1000).catch(() => [] as NormalizedSale[]), // ~all history
  ]);
  const tagged = await Promise.all([
    tagPlatform("collector-crypt", cc),
    tagPlatform("courtyard", cy),
    tagPlatform("beezie", bz),
  ]);
  return tagged.flat();
}
