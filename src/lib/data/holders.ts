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
  /**
   * Circulating token SUPPLY per platform = every asset the holder scan enumerated
   * (not wallets). Phygitals cards aren't fully indexed anywhere else (the
   * marketplace crawl only sees LISTED cards), so this is the only true supply
   * count we have — used for its floor×supply market cap. Optional (older snapshots
   * predate it); carried forward when a scan fails so an outage can't zero it.
   */
  supply?: Record<string, number>;
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

/**
 * NaN when this platform is absent from the snapshot — warm-holders only scans
 * beezie / collector-crypt / phygitals, so Courtyard was reporting a confident
 * "0 holders" for a platform we never counted. A scanned platform with genuinely
 * zero holders writes an explicit 0 and keeps it.
 *
 * fetchPlatform already made this call for the detail page; doing it here too is
 * what stops /platforms and /platform/courtyard disagreeing (0 vs "—").
 */
export function holdersForPlatform(snap: HoldersSnapshot | null, platformKey: string): number {
  if (!snap) return NaN;
  return snap.platforms[platformKey] ?? NaN;
}
