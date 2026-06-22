/**
 * Real-time gacha feed snapshot — Postgres `snapshots` blob, key='gacha:live'.
 *
 * Written by the always-on listener (scripts/listen-gacha.ts) every poll cycle
 * that lands new pulls: a rolling window of the freshest hits across platforms
 * (GachaBigHit-shaped, pack names included) + per-source heartbeats so any
 * consumer (site, status page, future alert bot) can see liveness at a glance.
 *
 * The durable record is still gacha_pulls — this blob is just the low-latency
 * read path; it never feeds aggregates.
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";
import type { GachaBigHit } from "./gachaDuneCache";

export const GACHA_LIVE_KEY = "gacha:live";

export type GachaLiveSnapshot = {
  generatedAt: string;
  /** Latest pulls, newest first (rolling window). */
  hits: GachaBigHit[];
  /** Last successful poll per source (ISO). */
  sources: Record<string, string>;
};

export async function readGachaLive(): Promise<GachaLiveSnapshot | null> {
  return readSnapshot<GachaLiveSnapshot>(GACHA_LIVE_KEY);
}

export async function writeGachaLive(snap: GachaLiveSnapshot): Promise<void> {
  await writeSnapshot(GACHA_LIVE_KEY, snap, snap.generatedAt);
}
