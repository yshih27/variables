/**
 * Collector Crypt REALIZED stats from the `gacha_pulls` spine, over the
 * intervals our listener captured continuously — replacing the stats the
 * winners sample produced.
 *
 * ⚠️ WHY THE SAMPLE HAD TO GO. `/api/getAllWinners?perTier=N` ignores perTier
 * (measured Sep 7: ~636 pulls, ~10 per machine, at any N) and serves a
 * tier-STRATIFIED slice: about as many epics as commons, where commons are
 * 75–80% of real pulls. The old "complete-coverage window" only engaged when a
 * tier slice hit the perTier cap, which it never does now, so the whole
 * stratified slice was read as a census. On Oct 7 that put PKMN 50's realized
 * median at 2.36× (n=25) on a machine CC states at about 1.02–1.10× EV — the
 * "Best Typical Return 2.01×" headline. A right-skewed payout's median sits
 * BELOW its mean; a median that high is the sample, not the machine.
 *
 * THE SPINE. scripts/listen-gacha.ts polls CC's 200 most recent pulls every
 * 60 s (an ~8-minute buffer at ~24 pulls a minute) and upserts every pull into
 * `gacha_pulls`, so while it runs the spine holds EVERY CC pull. It runs on a
 * Mac and stops when the Mac sleeps, so coverage has gaps. A gap is visible in
 * the data: across all of CC's machines a pull lands every few seconds, so no
 * pull for COVERAGE_GAP_MS means the listener was not capturing. Stats use only
 * the pulls inside continuous segments of at least MIN_SEGMENT_MS — a census of
 * those hours, not a sample. With no such segment in the window, realized stats
 * are withheld (null), never estimated.
 */
import { db } from "../db/client";
import { PHYGITALS_VALUE_BANDS } from "./phygitalsGachaCache";
import type { CCTierKey } from "../cc/gacha";
import { CC_TIER_ORDER } from "../cc/gacha";

/** No CC pull for this long, across every machine, means the listener was down. */
export const COVERAGE_GAP_MS = 10 * 60_000;
/** A covered stretch shorter than this is too short to call continuous. */
export const MIN_SEGMENT_MS = 60 * 60_000;
/** How far back the spine read goes. */
export const CC_REALIZED_DAYS = 3;

export type Segment = [number, number];

/**
 * Continuous-coverage segments from every pull time (any order), pure. A gap
 * longer than `gapMs` closes a segment; segments shorter than `minMs` drop.
 */
export function coverageSegments(timesMs: number[], gapMs = COVERAGE_GAP_MS, minMs = MIN_SEGMENT_MS): Segment[] {
  const t = timesMs.filter(Number.isFinite).sort((a, b) => a - b);
  const out: Segment[] = [];
  if (!t.length) return out;
  let start = t[0];
  let prev = t[0];
  for (let i = 1; i < t.length; i++) {
    if (t[i] - prev > gapMs) {
      if (prev - start >= minMs) out.push([start, prev]);
      start = t[i];
    }
    prev = t[i];
  }
  if (prev - start >= minMs) out.push([start, prev]);
  return out;
}

const inSegments = (t: number, segs: Segment[]) => segs.some(([a, b]) => t >= a && t <= b);
const coveredMs = (segs: Segment[], from: number, to: number) =>
  segs.reduce((s, [a, b]) => s + Math.max(0, Math.min(b, to) - Math.max(a, from)), 0);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A prize value's tier, from the machine's stated tier ranges (rarest first). */
export function tierOfValue(valueUsd: number, ranges: Partial<Record<CCTierKey, { start: number; end: number }>> | undefined): CCTierKey | null {
  if (!ranges) return null;
  for (const tier of CC_TIER_ORDER) {
    const r = ranges[tier];
    if (r && valueUsd >= r.start) return tier;
  }
  return null;
}

export type SpineStats = {
  n: number;
  windowHours: number;
  fromISO: string;
  evMultiple: number;
  medianReturn: number | null;
  odds: { tier: CCTierKey; pct: number }[] | null;
  hitOdds: number | null;
  valueBands: { label: string; pct: number; hit: boolean }[];
  pulls24h: number;
  pulls24hEstimated: boolean;
};

/**
 * One machine's realized stats from its covered pulls, pure. Null when none of
 * its pulls fall inside a covered segment (or none carries a value).
 */
export function statsFromCoveredPulls(
  machine: { priceUsd: number; tierRanges?: Partial<Record<CCTierKey, { start: number; end: number }>> },
  pulls: { t: number; valueUsd: number }[],
  segments: Segment[],
  nowMs: number,
): SpineStats | null {
  if (!(machine.priceUsd > 0) || !segments.length) return null;
  const covered = pulls.filter((p) => p.valueUsd > 0 && inSegments(p.t, segments));
  if (!covered.length) return null;
  const mults = covered.map((p) => p.valueUsd / machine.priceUsd);
  const counts = PHYGITALS_VALUE_BANDS.map(() => 0);
  for (const m of mults) {
    const i = PHYGITALS_VALUE_BANDS.findIndex((b) => m >= b.minMult && m < b.maxMult);
    if (i >= 0) counts[i]++;
  }
  const tiers = new Map<CCTierKey, number>();
  let tiered = 0;
  for (const p of covered) {
    const tier = tierOfValue(p.valueUsd, machine.tierRanges);
    if (!tier) continue;
    tiered++;
    tiers.set(tier, (tiers.get(tier) ?? 0) + 1);
  }
  const odds = tiered ? CC_TIER_ORDER.map((tier) => ({ tier, pct: (tiers.get(tier) ?? 0) / tiered })) : null;
  const dayAgo = nowMs - 86_400_000;
  const cov24 = coveredMs(segments, dayAgo, nowMs);
  const in24 = covered.filter((p) => p.t >= dayAgo).length;
  // Exact when the last 24h is covered end to end (within a gap's slack);
  // otherwise the covered hours' rate, flagged as an estimate.
  const exact = cov24 >= 86_400_000 - COVERAGE_GAP_MS * 2;
  const totalMs = segments.reduce((s, [a, b]) => s + (b - a), 0);
  return {
    n: covered.length,
    windowHours: totalMs / 3_600_000,
    fromISO: new Date(segments[0][0]).toISOString(),
    evMultiple: mults.reduce((s, x) => s + x, 0) / mults.length,
    medianReturn: median(mults),
    odds,
    hitOdds: odds ? odds.filter((o) => o.tier !== "common").reduce((s, o) => s + o.pct, 0) : null,
    valueBands: PHYGITALS_VALUE_BANDS.map((b, i) => ({ label: b.label, pct: counts[i] / mults.length, hit: b.hit })),
    pulls24h: exact ? in24 : cov24 > 0 ? Math.round((in24 / cov24) * 86_400_000) : 0,
    pulls24hEstimated: !exact,
  };
}

/**
 * Every CC pull since `sinceMs` per machine code, over the
 * (product_id, pulled_at) index, paged past the 1,000-row cap. Read-only.
 */
export async function readCCSpinePulls(codes: string[], sinceMs: number): Promise<{ byCode: Map<string, { t: number; valueUsd: number }[]>; queries: number }> {
  const PAGE = 1000;
  const since = new Date(sinceMs).toISOString();
  const byCode = new Map<string, { t: number; valueUsd: number }[]>();
  let queries = 0;
  for (const code of codes) {
    const rows: { t: number; valueUsd: number }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db()
        .from("gacha_pulls")
        .select("pulled_at, prize_value_usd")
        .eq("product_id", `collector-crypt:${code}`)
        .gte("pulled_at", since)
        .order("pulled_at", { ascending: true })
        .range(from, from + PAGE - 1);
      queries++;
      if (error) throw new Error(`[gacha_pulls] CC spine read failed (${code}): ${error.message}`);
      for (const r of data ?? []) rows.push({ t: Date.parse(String(r.pulled_at)), valueUsd: Number(r.prize_value_usd) || 0 });
      if ((data ?? []).length < PAGE) break;
    }
    byCode.set(code, rows);
  }
  return { byCode, queries };
}
