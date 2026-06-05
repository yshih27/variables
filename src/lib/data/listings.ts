/**
 * Active-listing snapshot — one entry per tokenId holding the cheapest active
 * USD price across marketplaces. Backed by the Postgres `snapshots` blob
 * (key='listings'); populated by `npm run warm-listings`.
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";

export type ListingEntry = {
  /** "POLYGON:0x…:tokenId" or "SOLANA:mint" */
  itemId: string;
  /** Best (lowest) active listing price in USD. */
  priceUsd: number;
  /** Platform key (beezie | courtyard | collector-crypt). */
  platform: string;
  /** Source marketplace name (OPEN_SEA, RARIBLE, COLLECTOR_CRYPT, etc). */
  source: string;
};

export type ListingsSnapshot = {
  generatedAt: string;
  /** itemId → ListingEntry */
  byItem: Record<string, ListingEntry>;
};

export async function readListings(): Promise<ListingsSnapshot | null> {
  return readSnapshot<ListingsSnapshot>("listings");
}

export async function writeListings(snap: ListingsSnapshot): Promise<void> {
  await writeSnapshot("listings", snap, snap.generatedAt);
}
