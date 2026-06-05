/**
 * CC 24h sales snapshot. The homepage reads from here so Helius rate limits
 * never block a render. Backed by the Postgres `snapshots` blob (key='cc-sales');
 * populated by `npm run warm-cc-sales`.
 */
import type { NormalizedSale } from "@/lib/rarible/queries";
import { readSnapshot, writeSnapshot } from "../db/snapshots";

export type CCSalesSnapshot = {
  generatedAt: string;
  sales: NormalizedSale[];
};

export async function readCCSales(): Promise<CCSalesSnapshot | null> {
  return readSnapshot<CCSalesSnapshot>("cc-sales");
}

export async function writeCCSales(snap: CCSalesSnapshot): Promise<void> {
  await writeSnapshot("cc-sales", snap, snap.generatedAt);
}

/** How fresh is the snapshot, in seconds? Returns Infinity if missing. */
export function ageSeconds(snap: CCSalesSnapshot | null): number {
  if (!snap) return Infinity;
  return (Date.now() - new Date(snap.generatedAt).getTime()) / 1000;
}
