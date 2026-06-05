/**
 * Hourly historical sales bucketing per platform. Backed by the Postgres
 * `snapshots` blobs (key='history:<platformKey>'); populated by
 * `npm run backfill-history`. The list is the rolling 7d window (168 hours)
 * ordered oldest → newest.
 */
import { collectSales, type NormalizedSale } from "@/lib/rarible/queries";
import { readSnapshot, writeSnapshot } from "../db/snapshots";

const HOUR = 60 * 60 * 1000;

export type HourBucket = {
  hourStart: string;
  volumeUsd: number;
  sales: number;
};

export type PlatformHistory = {
  generatedAt: string;
  buckets: HourBucket[];
};

function keyFor(platformKey: string): string {
  return `history:${platformKey}`;
}

export async function writeHistory(key: string, history: PlatformHistory): Promise<void> {
  await writeSnapshot(keyFor(key), history, history.generatedAt);
}

export async function readHistory(key: string): Promise<PlatformHistory | null> {
  return readSnapshot<PlatformHistory>(keyFor(key));
}

/**
 * Build hourly buckets covering the last `hours` hours from a list of sales.
 */
export function bucketsFromSales(sales: NormalizedSale[], hours: number): HourBucket[] {
  const now = Date.now();
  const start = now - hours * HOUR;
  const out: HourBucket[] = [];
  for (let i = 0; i < hours; i++) {
    const hourStart = new Date(start + i * HOUR).toISOString();
    out.push({ hourStart, volumeUsd: 0, sales: 0 });
  }
  for (const sale of sales) {
    const t = Date.parse(sale.date);
    if (!Number.isFinite(t) || t < start || t > now) continue;
    const idx = Math.min(hours - 1, Math.floor((t - start) / HOUR));
    out[idx].volumeUsd += sale.priceUsd;
    out[idx].sales += 1;
  }
  return out;
}

/**
 * Compute history for a platform from scratch (full 7d window). Slow path,
 * intended for the backfill cron.
 */
export async function computePlatformHistory(
  collectionId: string,
  hours = 168,
): Promise<PlatformHistory> {
  const sales = await collectSales(collectionId, hours * HOUR);
  return {
    generatedAt: new Date().toISOString(),
    buckets: bucketsFromSales(sales, hours),
  };
}

/** Sum buckets covering the last `hours` window. */
export function sumLast(buckets: HourBucket[], hours: number): { volumeUsd: number; sales: number } {
  const slice = buckets.slice(-hours);
  return {
    volumeUsd: slice.reduce((s, b) => s + b.volumeUsd, 0),
    sales: slice.reduce((s, b) => s + b.sales, 0),
  };
}

/** Period-over-period % change between [-2*hours, -hours] and [-hours, now]. */
export function pctChange(buckets: HourBucket[], hours: number): number | null {
  if (buckets.length < hours * 2) return null;
  const recent = buckets.slice(-hours).reduce((s, b) => s + b.volumeUsd, 0);
  const prior = buckets.slice(-hours * 2, -hours).reduce((s, b) => s + b.volumeUsd, 0);
  if (prior === 0) return null;
  return ((recent - prior) / prior) * 100;
}
