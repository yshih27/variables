/**
 * Primary-market revenue per platform. Backed by the Postgres `snapshots` blob
 * (key='primary-revenue'); populated by `npm run warm-primary-revenue`.
 *
 *   primary_revenue = Σ(USDC inflow to platform's gacha receivers
 *                       from wallets NOT in internalExclusions)
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";

export type PrimaryPlatformEntry = {
  /** Sum of qualifying inbound USDC, last 24h. */
  vol24hUsd: number;
  /**
   * Sum of qualifying inbound USDC, last 7d. `null` when the warmer hit its
   * pagination cap before crossing the 7d cutoff for any receiver.
   */
  vol7dUsd: number | null;
  /** Tx count over 24h (one tx = one gacha pull / pack open). */
  count24h: number;
  /** Tx count over 7d. Null when incomplete. */
  count7d: number | null;
  /** True iff every receiver was walked all the way to the 7d cutoff. */
  complete7d: boolean;
  /** Pull-by-pull breakdown by USDC amount (dollars). */
  byAmount24h: Record<string, { count: number; vol: number }>;
  byAmount7d: Record<string, { count: number; vol: number }>;
};

export type PrimaryRevenueSnapshot = {
  generatedAt: string;
  platforms: Record<string, PrimaryPlatformEntry>;
};

export async function readPrimaryRevenue(): Promise<PrimaryRevenueSnapshot | null> {
  return readSnapshot<PrimaryRevenueSnapshot>("primary-revenue");
}

export async function writePrimaryRevenue(snap: PrimaryRevenueSnapshot): Promise<void> {
  await writeSnapshot("primary-revenue", snap, snap.generatedAt);
}
