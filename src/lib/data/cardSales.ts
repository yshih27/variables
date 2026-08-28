/**
 * getCardSales (B9-4) — per-token sale history for the card page's "Price
 * history" slot (F9-3), read from feeds that are ALREADY cached. Zero new
 * crawling:
 *   • collector-crypt / beezie / courtyard — the platform-keyed secondary-sales
 *     snapshot (Postgres), written by runCoreWarm + warm-secondary-sales. The
 *     app NEVER reads Dune (see buildCardSales) — the old direct cache reads
 *     billed a Dune export per cold token.
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
  // ⚠️ NO DUNE FROM THE APP. All three feeds come from the secondary-sales
  // store the warmers write; the old direct reads (fetchCCSecondarySales et al)
  // were a Dune EXPORT per cold token — ~5.6 cr per card-page render at
  // Analyst's 10 cr/MB, and a deploy made every token cold at once.
  const snap = await readSnapshot<SecondarySalesSnapshot>("secondary-sales");
  if (platform === "collector-crypt") {
    const feed = snap?.platforms?.["collector-crypt"] ?? [];
    return {
      sales: filterToken(feed, tokenId),
      windowDays: 30,
      asOf: snap?.generatedAt ?? newestTs(feed),
      source: "Collector Crypt secondary sales (Dune, 30d)",
    };
  }
  if (platform === "beezie") {
    const feed = snap?.platforms?.beezie ?? [];
    return {
      sales: filterToken(feed, tokenId),
      windowDays: snap?.windowDays ?? 30,
      asOf: snap?.generatedAt ?? newestTs(feed),
      source: "Beezie activity feed",
    };
  }
  if (platform === "courtyard") {
    const feed = snap?.platforms?.["courtyard"] ?? [];
    return {
      sales: filterToken(feed, tokenId),
      windowDays: 30, // the feed has been 30d-windowed since PR #65
      asOf: snap?.generatedAt ?? newestTs(feed),
      source: "Courtyard secondary sales (Dune, 30d)",
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
    ["card-sales:v2", platform, tokenId],
    { revalidate: 1800, tags: ["platform-buckets", "card-sales"] },
  )();
}
