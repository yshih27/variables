/**
 * Courtyard primary-market revenue (USDC transfers to the tokenization
 * treasury). Backed by the Postgres `snapshots` blob (key='courtyard-primary');
 * populated by `npm run warm-courtyard-primary`.
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";

export type CourtyardPrimarySnapshot = {
  generatedAt: string;
  treasury: string;
  /** 24h USD volume of incoming USDC transfers to the treasury. */
  volume24hUsd: number;
  /** 7d USD volume. */
  volume7dUsd: number;
  /** Tx count over 24h. */
  count24h: number;
};

export async function readCourtyardPrimary(): Promise<CourtyardPrimarySnapshot | null> {
  return readSnapshot<CourtyardPrimarySnapshot>("courtyard-primary");
}

export async function writeCourtyardPrimary(snap: CourtyardPrimarySnapshot): Promise<void> {
  await writeSnapshot("courtyard-primary", snap, snap.generatedAt);
}
