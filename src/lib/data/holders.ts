/**
 * Holder counts per IP per platform. Backed by the Postgres `snapshots` blob
 * (key='holders'); populated by `npm run warm-holders`.
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";

export type HoldersIPEntry = {
  total: number;
  perPlatform: Record<string, number>;
};

export type HoldersSnapshot = {
  generatedAt: string;
  platforms: Record<string, number>;
  byIp: Record<string, HoldersIPEntry>;
  /**
   * TRUE cross-platform holder count (unique wallets), computed in the warmer.
   * beezie (Base) can't overlap the Solana platforms, but CC + Phygitals are both
   * Solana and share an address space, so this unions their owner sets rather than
   * summing (a plain sum double-counts wallets active on both — X2). Optional for
   * back-compat with older snapshots; readers fall back to the per-platform sum.
   */
  totalHolders?: number;
};

export async function readHolders(): Promise<HoldersSnapshot | null> {
  return readSnapshot<HoldersSnapshot>("holders");
}

export async function writeHolders(snap: HoldersSnapshot): Promise<void> {
  await writeSnapshot("holders", snap, snap.generatedAt);
}

export function holdersForIp(snap: HoldersSnapshot | null, ipKey: string): number {
  if (!snap) return NaN;
  return snap.byIp[ipKey]?.total ?? 0;
}

export function holdersForPlatform(snap: HoldersSnapshot | null, platformKey: string): number {
  if (!snap) return NaN;
  return snap.platforms[platformKey] ?? 0;
}
