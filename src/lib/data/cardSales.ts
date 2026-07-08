/**
 * getCardSales (B9-4) — per-token sale history for the card page's "Price
 * history" slot (F9-3), read from feeds that are ALREADY cached. Zero new
 * crawling:
 *   • collector-crypt — the 30d Dune secondary cache (fetchCCSecondarySales
 *     cachedOnly — self-heals with a fresh run only if the cache is stale).
 *   • beezie          — the warm-secondary-sales /activity snapshot (~30d).
 *   • courtyard       — the full-history Dune nft.trades cache.
 *   • phygitals       — none: its /sales feed is 100% gacha (no P2P secondary);
 *     returns an empty history with source:null so the UI can say "no feed".
 *
 * The per-token result is unstable_cache'd (30m): on a miss we read the whole
 * platform feed once and filter — the same access pattern trending/spine use —
 * so a card-page render never re-pulls the feed per request. Sparse results are
 * EXPECTED (1-of-1 slabs trade rarely): the UI should render dots + a step
 * line and an honest "N sales over the covered window" label, not interpolate.
 */
import { unstable_cache } from "next/cache";
import { fetchCCSecondarySales, fetchCourtyardSecondarySales } from "./warmers/core";
import { readSnapshot } from "../db/snapshots";
import type { SecondarySalesSnapshot } from "./secondarySalesCache";
import type { NormalizedSale } from "../rarible/queries";
import type { CardPlatform } from "../card/ids";

export type CardSalePoint = {
  ts: string; // ISO sale time
  priceUsd: number;
};

export type CardSalesHistory = {
  /** This token's sales, oldest → newest. Wash-filtered (buyer === seller dropped). */
  sales: CardSalePoint[];
  /** How far back the feed reaches; null = full history (Courtyard). */
  windowDays: number | null;
  /** Freshness of the feed the history came from (newest sale seen, or the
   *  snapshot's generatedAt) — the UI's honest "as of". */
  asOf: string | null;
  /** Human label for the feed, or null when the platform has no secondary feed. */
  source: string | null;
};

const EMPTY: CardSalesHistory = { sales: [], windowDays: null, asOf: null, source: null };

function newestTs(sales: NormalizedSale[]): string | null {
  let max = -Infinity;
  for (const s of sales) {
    const t = Date.parse(s.date);
    if (Number.isFinite(t) && t > max) max = t;
  }
  return Number.isFinite(max) ? new Date(max).toISOString() : null;
}

function filterToken(sales: NormalizedSale[], tokenId: string): CardSalePoint[] {
  return sales
    .filter(
      (s) =>
        s.tokenId === tokenId &&
        s.priceUsd > 0 &&
        !(s.buyer && s.seller && s.buyer === s.seller), // self-trade / wash
    )
    .map((s) => ({ ts: s.date, priceUsd: s.priceUsd }))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

/** Uncached builder — for scripts/tests outside the Next server (unstable_cache
 *  throws there). In-app callers use getCardSales below. */
export async function buildCardSales(platform: CardPlatform, tokenId: string): Promise<CardSalesHistory> {
  if (platform === "collector-crypt") {
    const feed = await fetchCCSecondarySales({ cachedOnly: true }).catch(() => [] as NormalizedSale[]);
    return {
      sales: filterToken(feed, tokenId),
      windowDays: 30,
      asOf: newestTs(feed),
      source: "Collector Crypt secondary sales (Dune, 30d)",
    };
  }
  if (platform === "beezie") {
    const snap = await readSnapshot<SecondarySalesSnapshot>("secondary-sales");
    const feed = snap?.platforms?.beezie ?? [];
    return {
      sales: filterToken(feed, tokenId),
      windowDays: snap?.windowDays ?? 30,
      asOf: snap?.generatedAt ?? newestTs(feed),
      source: "Beezie activity feed",
    };
  }
  if (platform === "courtyard") {
    const feed = await fetchCourtyardSecondarySales({ cachedOnly: true }).catch(() => [] as NormalizedSale[]);
    return {
      sales: filterToken(feed, tokenId),
      windowDays: null, // full history
      asOf: newestTs(feed),
      source: "Courtyard secondary sales (Dune, full history)",
    };
  }
  // phygitals — no clean row-level secondary feed (see secondarySalesCache.ts).
  return EMPTY;
}

/**
 * Per-token sale history, cached 30m. Tagged "platform-buckets" alongside the
 * other sale-derived caches so a manual revalidate sweeps it too.
 */
export function getCardSales(platform: CardPlatform, tokenId: string): Promise<CardSalesHistory> {
  return unstable_cache(
    () => buildCardSales(platform, tokenId),
    ["card-sales:v1", platform, tokenId],
    { revalidate: 1800, tags: ["platform-buckets", "card-sales"] },
  )();
}
