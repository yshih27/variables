/**
 * Extended (multi-week) row-level secondary-sales feed — beyond the 24h `core-volume`
 * snapshot — so trending's 7d window + momentum work for platforms whose native feed
 * reaches back weeks (R4-2). Backed by Postgres (`snapshots`, key 'secondary-sales'),
 * written by scripts/warm-secondary-sales.ts, read by fetchTrending.
 *
 * Coverage:
 *   • beezie — api.beezie.com/activity (order_fulfilled) reaches months back; a single
 *     call yields ~30d of real secondary sales (~2.6K rows). This is the R4-2 win.
 *   • collector-crypt already has its own 30d Dune cache (fetchCCSecondarySales), so it
 *     is NOT duplicated here.
 *   • phygitals is intentionally absent: its /sales feed is 100% gacha (CLAW/BUY pulls)
 *     — zero peer-to-peer secondary sales — and its real secondary trades happen on
 *     Tensor / Magic Eden, which need a Dune query that doesn't exist yet. It slots in
 *     here (platform-keyed) the day that query lands.
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";
import type { NormalizedSale } from "../rarible/queries";

export type SecondarySalesSnapshot = {
  generatedAt: string;
  windowDays: number;
  /** platform key → row-level sales over the window. */
  platforms: Record<string, NormalizedSale[]>;
};

/** Cached extended sales for one platform, or [] if absent (never throws). */
export async function readSecondarySales(platform: string): Promise<NormalizedSale[]> {
  const snap = await readSnapshot<SecondarySalesSnapshot>("secondary-sales").catch(() => null);
  return snap?.platforms?.[platform] ?? [];
}

export function writeSecondarySales(snap: SecondarySalesSnapshot): Promise<void> {
  return writeSnapshot("secondary-sales", snap, snap.generatedAt);
}
