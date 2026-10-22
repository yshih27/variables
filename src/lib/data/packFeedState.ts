/**
 * Pack feeds a venue has stopped feeding us, entered by hand with their evidence.
 *
 * A resale feed that closes refuses our reads, and the warmer records that by
 * itself (resaleFeedState.ts). A pack feed has nothing to refuse: its payments
 * just stop arriving where we read them, and silence alone can't tell a moved
 * contract from a broken writer of ours — which is what INV-9 exists to catch.
 * So a venue is listed here only once the silence is explained, and leaves the
 * day its packs are read again. The date shown is never typed: it is the last
 * day the venue's `gacha_volume_usd` series recorded.
 *
 * Beezie (Oct 22 2026): its Claw contract on Base took its last USDC in the
 * Oct 19 06:00Z hour, and since Oct 20 the wallets that funded it bridge USDC
 * off Base through Relay (dune/beezie-claw-trace.sql, beezie-claw-candidate.sql,
 * beezie-claw-labels.sql). The Claw most likely moved to another chain.
 */
import type { SeriesPoint } from "./metricSnapshots";

export const CLOSED_PACK_FEEDS: Readonly<Record<string, { why: string }>> = {
  beezie: { why: "its Claw contract on Base has taken no USDC since then" },
};

export function closedPackFeed(venue: string): { why: string } | null {
  return CLOSED_PACK_FEEDS[venue] ?? null;
}

/** The last day a daily series recorded (ISO), or null for an empty series. */
export function lastSeriesDay(series: readonly SeriesPoint[]): string | null {
  let last: string | null = null;
  for (const p of series) {
    if (!Number.isFinite(Date.parse(p.ts)) || !Number.isFinite(p.value)) continue;
    if (last == null || p.ts > last) last = p.ts;
  }
  return last;
}
