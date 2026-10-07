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

/** Below this many 24h sales, a venue's tables read its trailing 7 days instead (fetchPlatform `salesWindow`). */
export const SALES_TABLE_MIN = 10;

export type CorePlatformVolume = {
  /** Where this platform's volume came from, for provenance. */
  source: "dune" | "rarible" | "beezie" | "dyli" | "renaiss";
  /** 24h aggregate stats (volume, count, unique buyers/sellers, avg). */
  stats24h: CollectionStats;
  /** 24h sale-level rows (powers Top Sales + per-IP aggregation). */
  sales24h: NormalizedSale[];
  /**
   * The trailing 7 days' sale-level rows — present ONLY when the 24h holds
   * fewer than SALES_TABLE_MIN sales, so a thin venue's tables (Renaiss clears
   * about 6 a day) read a week rather than render empty. Absent otherwise:
   * a busy venue's week would only bloat the snapshot.
   */
  sales7d?: NormalizedSale[];
  /** 7d / 30d volume — present where the source covers it (CC via Dune); null otherwise. */
  vol7dUsd: number | null;
  vol30dUsd: number | null;
  sales7dCount: number | null;
  sales30dCount: number | null;
  /**
   * Rolling GACHA-lane volume, for platforms whose gacha arrives through a
   * native feed rather than the Dune gacha snapshot (DYLI's box sales, Renaiss's
   * pack pulls). Optional and absent
   * everywhere else — `fetchPlatform` prefers the gacha snapshot and only falls
   * back here, so a platform present in both keeps its existing numbers.
   */
  gachaVol24Usd?: number;
  gachaVol7Usd?: number;
  gachaSales24h?: number;
};

export type CoreVolumeSnapshot = {
  generatedAt: string;
  /** Keyed by platform key (collector-crypt | beezie | courtyard | dyli | renaiss). */
  platforms: Record<string, CorePlatformVolume>;
};

export function readCoreVolume(): Promise<CoreVolumeSnapshot | null> {
  return readSnapshot<CoreVolumeSnapshot>("core-volume");
}

export function writeCoreVolume(snap: CoreVolumeSnapshot): Promise<void> {
  return writeSnapshot("core-volume", snap, snap.generatedAt);
}
