/**
 * Shared platform-buckets fetcher. Assembles 24h sales + stats for every tracked
 * platform, cached once per request (Server Components share a single cache key).
 * Used by fetchHomepage, fetchIP, and fetchPlatform.
 *
 * CACHE-ONLY: reads the `core-volume` Postgres snapshot (written by the core
 * warmer — CC via Dune, Beezie/Courtyard via Rarible) plus the per-platform
 * history and primary-revenue snapshots. Makes ZERO request-time network calls,
 * so renders are sub-second and never go stale mid-render. Per-source freshness
 * is surfaced via the honest "as of" chips, not a fake "Live" badge.
 */
import { unstable_cache } from "next/cache";
import type { CollectionStats, NormalizedSale } from "@/lib/rarible/queries";
import { PLATFORM_SOURCES, type PlatformSource } from "./sources";
import { readHistory, type HourBucket } from "./history";
import { readCourtyardPrimary } from "./courtyardPrimaryCache";
import { readPrimaryRevenue } from "./primaryRevenueCache";
import { readGachaDune } from "./gachaDuneCache";
import { readCoreVolume, type CoreVolumeSnapshot } from "./coreVolumeCache";

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

/**
 * Assemble one platform's bucket from the snapshots — pure, no network. CC,
 * Beezie, and Courtyard come from `core-volume`; Phygitals (no marketplace
 * program wired) has no entry and renders empty stats + its primaryUsd.
 */
function buildBucket(
  source: PlatformSource,
  core: CoreVolumeSnapshot | null,
  history: HourBucket[] | null,
  primaryUsd: number | null,
): PlatformBucket {
  const cv = core?.platforms?.[source.key];
  const collectionId =
    source.kind === "helius" ? source.collectionAddress : source.collectionId;
  return {
    source,
    stats24h: cv?.stats24h ?? emptyStats(collectionId || source.key),
    sales24h: cv?.sales24h ?? [],
    history,
    primaryUsd,
  };
}

/**
 * Cached for 1h. Homepage, IP, and platform pages share this fetch. Pure
 * snapshot reads — zero request-time network calls.
 */
export const getPlatformBuckets = unstable_cache(
  async (): Promise<PlatformBucket[]> => {
    const core = await readCoreVolume();
    return Promise.all(
      PLATFORM_SOURCES.map(async (source) => {
        const [history, primaryUsd] = await Promise.all([
          readHistory(source.key).then((h) => h?.buckets ?? null),
          resolvePrimaryUsd(source.key),
        ]);
        return buildBucket(source, core, history, primaryUsd);
      }),
    );
  },
  ["platform-buckets:v6"],
  { revalidate: 3600, tags: ["platform-buckets"] },
);
