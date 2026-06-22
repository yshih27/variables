/**
 * Active-listing snapshot — one entry per tokenId holding the cheapest active
 * USD price across marketplaces. Backed by the Postgres `snapshots` blob
 * (key='listings'); populated by `npm run warm-listings`.
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";
import { gzipSync, gunzipSync } from "node:zlib";

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

/**
 * The listings blob is multi-MB (~59K priced tokens). A raw jsonb upsert that
 * large trips Postgres' statement_timeout through PostgREST — the warmer's write
 * had been failing for it — so we gzip the payload (≈5× smaller) into a tiny
 * wrapper object. Transparent to every caller: readListings auto-detects and
 * inflates, and still reads any legacy uncompressed snapshot.
 */
type GzWrapper = { __gz__: string };

function isGz(p: unknown): p is GzWrapper {
  return !!p && typeof p === "object" && typeof (p as { __gz__?: unknown }).__gz__ === "string";
}

export async function readListings(): Promise<ListingsSnapshot | null> {
  const raw = await readSnapshot<ListingsSnapshot | GzWrapper>("listings");
  if (!raw) return null;
  if (isGz(raw)) {
    return JSON.parse(gunzipSync(Buffer.from(raw.__gz__, "base64")).toString()) as ListingsSnapshot;
  }
  return raw;
}

export async function writeListings(snap: ListingsSnapshot): Promise<void> {
  const gz = gzipSync(Buffer.from(JSON.stringify(snap))).toString("base64");
  await writeSnapshot("listings", { __gz__: gz } satisfies GzWrapper, snap.generatedAt);
}
