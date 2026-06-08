/**
 * Core secondary-volume snapshot — backed by Postgres (`snapshots`, key
 * 'core-volume'). One source of truth per platform for 24h marketplace volume +
 * the recent sale list the homepage/IP/platform pages read.
 *
 * Routing (DATA_MODEL.md §5):
 *   • collector-crypt → Dune (CC_SECONDARY_QUERY_ID) — full chain scan, no Helius 429s
 *   • beezie / courtyard → Rarible (aggregates OpenSea; ~2% is native)
 *
 * Written by runCoreWarm() (scripts/warm-core-dune.ts), read by buckets.ts.
 * Replaces the live request-time Rarible/Helius fetches that buckets used to do.
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";
import type { CollectionStats, NormalizedSale } from "../rarible/queries";

export type CorePlatformVolume = {
  /** Where this platform's volume came from, for provenance. */
  source: "dune" | "rarible";
  /** 24h aggregate stats (volume, count, unique buyers/sellers, avg). */
  stats24h: CollectionStats;
  /** 24h sale-level rows (powers Top Sales + per-IP aggregation). */
  sales24h: NormalizedSale[];
  /** 7d / 30d volume — present where the source covers it (CC via Dune); null otherwise. */
  vol7dUsd: number | null;
  vol30dUsd: number | null;
  sales7dCount: number | null;
  sales30dCount: number | null;
};

export type CoreVolumeSnapshot = {
  generatedAt: string;
  /** Keyed by platform key (collector-crypt | beezie | courtyard). */
  platforms: Record<string, CorePlatformVolume>;
};

export function readCoreVolume(): Promise<CoreVolumeSnapshot | null> {
  return readSnapshot<CoreVolumeSnapshot>("core-volume");
}

export function writeCoreVolume(snap: CoreVolumeSnapshot): Promise<void> {
  return writeSnapshot("core-volume", snap, snap.generatedAt);
}
