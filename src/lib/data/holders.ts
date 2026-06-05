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
