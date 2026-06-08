/**
 * Shared platform-buckets fetcher. Assembles 24h sales + stats for every
 * tracked platform, cached once per request (Server Components share a single
 * cache key). Used by fetchHomepage, fetchIP, and fetchPlatform.
 *
 * Read path (current state):
 *   • CC:        cache-only — reads the `cc-sales` Postgres snapshot. NO live
 *                Helius fallback; that fallback caused the 30–60s cold renders
 *                + 429s and was removed.
 *   • Beezie / Courtyard: still fetch 24h sales LIVE from Rarible per request.
 *                Being moved onto a Dune-backed `core-volume` snapshot so the
 *                render makes zero network calls — see plan Phase 2/3.
 *   • Primary revenue (Courtyard tokenization etc.): resolvePrimaryUsd reads
 *                Postgres snapshots (gacha-dune → primary-revenue → legacy).
 *
 * Per-source freshness is surfaced via the honest "as of" chips, not a fake
 * "Live" badge.
 */
import { unstable_cache } from "next/cache";
import {
  collectSales,
  computeStatsFromSales,
  type CollectionStats,
  type NormalizedSale,
} from "@/lib/rarible/queries";
import { PLATFORM_SOURCES, type PlatformSource } from "./sources";
import { readHistory, type HourBucket } from "./history";
import { readCCSales } from "./ccSalesCache";
import { readCourtyardPrimary } from "./courtyardPrimaryCache";
import { readPrimaryRevenue } from "./primaryRevenueCache";
import { readGachaDune } from "./gachaDuneCache";

const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

export type PlatformBucket = {
  source: PlatformSource;
  stats24h: CollectionStats;
  sales24h: NormalizedSale[];
  history: HourBucket[] | null;
  /** 24h primary-market USD volume (tokenization fees etc). Null if N/A. */
  primaryUsd: number | null;
};

function statsFromSales(collectionId: string, sales: NormalizedSale[]): CollectionStats {
  const volumeUsd = sales.reduce((s, x) => s + x.priceUsd, 0);
  return {
    collectionId,
    windowFrom: new Date(Date.now() - DAY).toISOString(),
    windowTo: new Date().toISOString(),
    salesCount: sales.length,
    volumeUsd,
    uniqueBuyers: new Set(sales.map((s) => s.buyer)).size,
    uniqueSellers: new Set(sales.map((s) => s.seller)).size,
    avgTradeUsd: sales.length ? volumeUsd / sales.length : 0,
  };
}

function emptyStats(collectionId: string): CollectionStats {
  return {
    collectionId,
    windowFrom: new Date(Date.now() - DAY).toISOString(),
    windowTo: new Date().toISOString(),
    salesCount: 0,
    volumeUsd: 0,
    uniqueBuyers: 0,
    uniqueSellers: 0,
    avgTradeUsd: 0,
  };
}

/**
 * CC sales: CACHE-ONLY. Reads the cc-sales snapshot written by the warmer and
 * never falls back to a live Helius fetch — that fallback was the source of the
 * 30–60s cold renders + 429s. Freshness is surfaced via the "as of" badge.
 */
async function getCCSales(): Promise<NormalizedSale[]> {
  const cached = await readCCSales();
  return cached?.sales ?? [];
}

/**
 * Resolve primary-market revenue (24h) for a platform. Source priority:
 *
 *   1. Dune gacha cache (warm-gacha-dune.ts) — complete chain scan, same
 *      number the /gacha page shows. Keeps the two pages consistent.
 *   2. RPC primary-revenue cache (warm-primary-revenue.ts) — fallback.
 *   3. Courtyard legacy estimate (MINTs × $2) — last resort.
 *   4. null — surfaces as "—" in the UI.
 */
async function resolvePrimaryUsd(platformKey: string): Promise<number | null> {
  const dune = await readGachaDune();
  const d = dune?.platforms?.[platformKey];
  if (d && Number.isFinite(d.vol24h)) return d.vol24h;

  const snap = await readPrimaryRevenue();
  const entry = snap?.platforms?.[platformKey];
  if (entry && Number.isFinite(entry.vol24hUsd)) return entry.vol24hUsd;

  if (platformKey === "courtyard") {
    const legacy = await readCourtyardPrimary();
    return legacy?.volume24hUsd ?? null;
  }
  return null;
}

async function fetchPlatformBucket(source: PlatformSource): Promise<PlatformBucket> {
  const history = await readHistory(source.key);
  const histBuckets = history?.buckets ?? null;
  const primaryUsd = await resolvePrimaryUsd(source.key);

  try {
    if (source.kind === "helius") {
      // Phygitals has no marketplace program wired yet — only primary
      // revenue is tracked. Return empty sales stats but keep primaryUsd.
      if (!source.marketplaceProgram || !source.collectionAddress) {
        return {
          source,
          stats24h: emptyStats(source.collectionAddress || source.key),
          sales24h: [],
          history: histBuckets,
          primaryUsd,
        };
      }
      const sales = await getCCSales();
      return {
        source,
        stats24h: statsFromSales(source.collectionAddress, sales),
        sales24h: sales,
        history: histBuckets,
        primaryUsd,
      };
    }
    if (source.key === "beezie") {
      const sales = await collectSales(source.collectionId, DAY);
      return {
        source,
        stats24h: statsFromSales(source.collectionId, sales),
        sales24h: sales,
        history: histBuckets,
        primaryUsd,
      };
    }
    // Courtyard: aggregate stats from Rarible + primary from the warmer.
    const stats = await computeStatsFromSales(source.collectionId, DAY);
    return {
      source,
      stats24h: stats,
      sales24h: [],
      history: histBuckets,
      primaryUsd,
    };
  } catch (err) {
    console.warn(
      `[buckets] ${source.key} 24h fetch failed, falling back to history-only:`,
      err instanceof Error ? err.message : err,
    );
    const collectionId =
      source.kind === "helius" ? source.collectionAddress : source.collectionId;
    return {
      source,
      stats24h: emptyStats(collectionId || source.key),
      sales24h: [],
      history: histBuckets,
      primaryUsd,
    };
  }
}

/**
 * Cached for 1h. Both homepage and IP detail share this fetch.
 */
export const getPlatformBuckets = unstable_cache(
  async (): Promise<PlatformBucket[]> =>
    Promise.all(PLATFORM_SOURCES.map(fetchPlatformBucket)),
  ["platform-buckets:v5"],
  { revalidate: 3600, tags: ["platform-buckets"] },
);
