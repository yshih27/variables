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
  /**
   * False when this platform has NO secondary-sales source at all — `core-volume`
   * carries no entry for it (Phygitals: its listings aggregate Tensor + Magic
   * Eden + native, which needs a Dune query that doesn't exist yet).
   *
   * ⚠️ This flag is load-bearing and can't be inferred from `sales24h.length`:
   * an empty array means "we measured and there were no sales" for a tracked
   * platform (a legitimately quiet 24h → a real 0) and "we never measured" for
   * an untracked one (→ unknown). Readers that derive their own figures from
   * `sales24h` MUST branch on this, or they re-fabricate the zero that
   * `unknownStats` exists to prevent.
   */
  hasSecondarySource: boolean;
  history: HourBucket[] | null;
  /** 24h primary-market USD volume (tokenization fees etc). Null if N/A. */
  primaryUsd: number | null;
};

/**
 * Stats for a platform we have NO secondary-sales source for. Every figure is
 * NaN — UNKNOWN, not zero. Previously these were literal 0s, which every
 * `Number.isFinite` guard in the codebase waved through as a confident "$0 /
 * 0 trades" for a platform we have simply never measured (sources.ts:247 states
 * the intent: "honestly absent — not a fabricated $0"). NaN is the codebase's
 * established not-tracked sentinel (X5) and renders "—" through formatCompactUsd
 * / formatInt.
 */
function unknownStats(collectionId: string): CollectionStats {
  return {
    collectionId,
    windowFrom: new Date(Date.now() - DAY).toISOString(),
    windowTo: new Date().toISOString(),
    salesCount: NaN,
    volumeUsd: NaN,
    uniqueBuyers: NaN,
    uniqueSellers: NaN,
    avgTradeUsd: NaN,
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
 * Beezie, and Courtyard come from `core-volume`; Phygitals has no secondary
 * Dune query yet, so it has no `core-volume` entry and renders empty secondary
 * stats + its primaryUsd (holders ARE tracked — see warm-holders).
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
    stats24h: cv?.stats24h ?? unknownStats(collectionId || source.key),
    sales24h: cv?.sales24h ?? [],
    hasSecondarySource: !!cv,
    history,
    primaryUsd,
  };
}

/**
 * Uncached builder — for warmers running OUTSIDE the Next server (unstable_cache
 * throws "Invariant: incrementalCache missing" there, e.g. under `npx tsx`).
 * In-app callers use getPlatformBuckets below.
 */
export async function buildPlatformBuckets(): Promise<PlatformBucket[]> {
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
}

/**
 * Cached for 1h. Homepage, IP, and platform pages share this fetch. Pure
 * snapshot reads — zero request-time network calls.
 */
export const getPlatformBuckets = unstable_cache(
  buildPlatformBuckets,
  ["platform-buckets:v6"],
  { revalidate: 3600, tags: ["platform-buckets"] },
);
