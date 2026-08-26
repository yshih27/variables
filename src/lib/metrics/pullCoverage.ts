/**
 * Pull-capture completeness — how much of a platform's on-chain gacha spend our
 * own `gacha_pulls` table actually holds, month by month.
 *
 * WHY THIS EXISTS. Player analytics is derived entirely from `gacha_pulls`, but
 * that table was populated by a capture that switched on partway through the
 * market's life and ramped. The spine's `gacha_volume_usd` is the independent
 * measure of the same flow (daily-bucketed Dune), so pulls ÷ spine per month is a
 * direct read on completeness. Measured 2026-08-25:
 *
 *   collector-crypt  2026-06 50.5% · 2026-07 74.6% · 2026-08 81.4%
 *   phygitals        2026-06 11.3% · 2026-07 35.3% · 2026-08 20.0%
 *
 * Plotted raw, those months read as a collapse in player spending followed by a
 * boom. Nothing collapsed — we simply were not recording yet. A month that holds
 * half the money is not a smaller month, it is a partly-observed one, and the two
 * are indistinguishable to a reader unless we say so.
 *
 * ⚠️ COVERAGE IS NOT A SCALE FACTOR. Do not divide a month's spend by its coverage
 * to "correct" it. The missing pulls are not a random sample of the present ones —
 * whichever wallets, price bands or partners the capture missed are missing
 * systematically — so grossing up would fabricate a distribution rather than
 * recover one. The only honest moves are to show a month or to withhold it.
 */
import type { SeriesPoint } from "@/lib/data/metricSnapshots";

/**
 * Minimum share of spine spend a month must carry to be plotted.
 *
 * 80% is a judgement call, and a consequential one: at this threshold Collector
 * Crypt keeps only 2026-08 and Phygitals keeps NOTHING. Lower it and you start
 * drawing months whose shape is capture ramp rather than player behaviour; raise
 * it and even the current month drops out. It lives here, named, so the tradeoff
 * is a visible constant rather than a magic number inside a filter.
 */
export const PULL_COVERAGE_MIN_PCT = 80;

/** Month key ("YYYY-MM") → share of spine gacha spend our pulls hold, 0–100. */
export type PullCoverage = Record<string, number>;

/** Σ a daily spine series into UTC month buckets. */
function byMonth(daily: SeriesPoint[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of daily) {
    if (!Number.isFinite(p.value)) continue;
    const m = String(p.ts).slice(0, 7);
    if (m.length !== 7) continue;
    out.set(m, (out.get(m) ?? 0) + p.value);
  }
  return out;
}

/**
 * Per-month capture rate for one platform.
 *
 * A month the spine has no reading for is OMITTED rather than scored: with no
 * independent measure there is nothing to be complete against, and scoring it 0%
 * would hide a real month behind a missing denominator.
 */
export function monthlyPullCoverage(
  monthly: { month: string; totalUsd: number }[],
  spineDaily: SeriesPoint[],
): PullCoverage {
  const spine = byMonth(spineDaily);
  const out: PullCoverage = {};
  for (const m of monthly) {
    const denom = spine.get(m.month);
    if (denom == null || !(denom > 0)) continue;
    out[m.month] = (m.totalUsd / denom) * 100;
  }
  return out;
}

/** Months clearing the bar, oldest → newest. */
export function completeMonths(
  monthly: { month: string }[],
  coverage: PullCoverage,
  minPct = PULL_COVERAGE_MIN_PCT,
): string[] {
  return monthly
    .map((m) => m.month)
    .filter((m) => (coverage[m] ?? 0) >= minPct)
    .sort();
}

/**
 * Capture rate across every month we hold pulls for — the figure that qualifies
 * the LIFETIME aggregates (tiers, concentration, averages), which are summed over
 * all pulls regardless of which month they landed in.
 *
 * Returns null when no month has a spine denominator to compare against.
 */
export function overallPullCoverage(
  monthly: { month: string; totalUsd: number }[],
  spineDaily: SeriesPoint[],
): number | null {
  const spine = byMonth(spineDaily);
  let pulls = 0;
  let denom = 0;
  for (const m of monthly) {
    const d = spine.get(m.month);
    if (d == null || !(d > 0)) continue;
    pulls += m.totalUsd;
    denom += d;
  }
  return denom > 0 ? (pulls / denom) * 100 : null;
}
