/**
 * Constant-quality price-index estimators over the sale-price panel (B1, kind:"price").
 *
 * v1 = STRATIFIED MEDIAN: within an entity, partition sales into set×grade cells,
 * index each cell's weekly median against the cell's first-week base, and combine
 * cells by trade-share weighting → a mix-controlled (constant-quality) weekly index
 * — price movement, not composition drift. Liquidity floor: weeks below `minWeekN`
 * trades are dropped, and an entity with fewer than `minWeeks` qualifying weeks
 * returns [] ("insufficient data" — never a fabricated line).
 *
 * Category / market = a CHAINED cap-weighted roll-up of the constituent IP indices:
 * each week-over-week return is computed only over IPs present in BOTH weeks, so an
 * IP entering/leaving (new tokenizations) never creates a jump — the chained form of
 * an S&P-style index divisor. Cap-weight by mcap; pass all-1 weights for equal-weight.
 */
import type { IndexPoint } from "./indices";
import type { SaleRow } from "./salePanel";

const DAY = 24 * 60 * 60 * 1000;

/** Monday-anchored UTC week start (ISO week) as an ISO string. The canonical week
 *  IDENTITY — used to BUCKET sales into weeks. (The emitted point LABEL is the
 *  week END, see weekEndUtc: a Mon–Sun week's value is reported "as of" its Sunday.) */
export function weekStartUtc(ms: number): string {
  const d = new Date(ms);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow),
  ).toISOString();
}

/** Sunday-anchored UTC week END (the ISO week's last day = week start + 6d) as an
 *  ISO string. This is the STAMP for a weekly point: a value computed from a week's
 *  sales (Mon–Sun) IS the value as of that Sunday, so a Jul 13–19 median is labelled
 *  Jul 19 — not Jul 13, which reads 6 days stale. Pure label; the value is unchanged.
 *  Bucketing still uses weekStartUtc; only the emitted `ts` uses this. */
export function weekEndUtc(ms: number): string {
  const d = new Date(Date.parse(weekStartUtc(ms)));
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 6),
  ).toISOString();
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Linear-interpolated quantile over a pre-sorted array. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const MIN_WEEK_N = 8; // weekly-trade liquidity floor (below → week dropped)
export const MIN_WEEKS = 3; // entity needs ≥ this many qualifying weeks, else []
const BAND_K = 0.5; // confidence half-width ≈ value · BAND_K/√n (widens as n falls)

/**
 * Stratified-median weekly price index for ONE entity's sales (e.g. all of an IP's
 * sales). Returns IndexPoint[] rebased to 100 at the first qualifying week, each
 * with `n` (trades) + `lo`/`hi` band — or [] when too thin (liquidity floor).
 */
export function stratifiedMedianIndex(
  sales: SaleRow[],
  opts: { minWeekN?: number; minWeeks?: number; bandK?: number } = {},
): IndexPoint[] {
  const minWeekN = opts.minWeekN ?? MIN_WEEK_N;
  const minWeeks = opts.minWeeks ?? MIN_WEEKS;
  const bandK = opts.bandK ?? BAND_K;
  if (sales.length === 0) return [];

  // Winsorize to [p1,p99] across the entity to tame absurd outliers before medians.
  const sortedPrices = sales.map((s) => s.priceUsd).sort((a, b) => a - b);
  const loP = quantile(sortedPrices, 0.01);
  const hiP = quantile(sortedPrices, 0.99);
  const clip = (p: number) => Math.min(Math.max(p, loP), hiP);

  // week → cell(set|grade) → clipped prices
  const weeks = new Map<string, Map<string, number[]>>();
  for (const s of sales) {
    const t = Date.parse(s.ts);
    if (!Number.isFinite(t)) continue;
    const wk = weekStartUtc(t);
    let cells = weeks.get(wk);
    if (!cells) { cells = new Map(); weeks.set(wk, cells); }
    const k = `${s.set ?? "—"}|${s.grade}`;
    const arr = cells.get(k);
    if (arr) arr.push(clip(s.priceUsd));
    else cells.set(k, [clip(s.priceUsd)]);
  }

  const cellBase = new Map<string, number>(); // cell → base median (first week seen)
  const out: IndexPoint[] = [];
  for (const wk of [...weeks.keys()].sort()) {
    const cells = weeks.get(wk)!;
    let weightedRel = 0, weightTot = 0, n = 0;
    for (const [k, prices] of cells) {
      n += prices.length;
      const med = median(prices);
      if (!cellBase.has(k)) cellBase.set(k, med); // first appearance defines the base
      const base = cellBase.get(k)!;
      if (!(base > 0) || !(med > 0)) continue;
      weightedRel += (med / base) * prices.length; // trade-share weighting
      weightTot += prices.length;
    }
    if (n < minWeekN || weightTot === 0) continue; // liquidity floor → drop week
    const value = (weightedRel / weightTot) * 100;
    const hw = value * (bandK / Math.sqrt(n));
    // STAMP at the week END (Sunday) — the value covers Mon–Sun, so it's "as of"
    // that Sunday, not the Monday it's bucketed under. Bucketing stays week-start.
    out.push({ ts: weekEndUtc(Date.parse(wk)), value, n, lo: value - hw, hi: value + hw });
  }

  if (out.length < minWeeks) return []; // too thin → insufficient data

  // Normalize so the first qualifying week reads exactly 100.
  const base0 = out[0].value;
  if (base0 > 0 && Math.abs(base0 - 100) > 1e-9) {
    const f = 100 / base0;
    for (const p of out) {
      p.value *= f;
      if (p.lo != null) p.lo *= f;
      if (p.hi != null) p.hi *= f;
    }
  }
  return out;
}

/**
 * Chained cap-weighted roll-up of constituent IP indices → category/market index.
 * Each week-over-week return uses only IPs present in BOTH weeks (no jump when an IP
 * enters/leaves). `weights` = per-IP cap weight (mcap); all-1 → equal-weight.
 */
export function rollupIndex(
  perIp: Map<string, IndexPoint[]>,
  weights: Map<string, number>,
): IndexPoint[] {
  const ipWeek = new Map<string, Map<string, IndexPoint>>();
  const allWeeks = new Set<string>();
  for (const [ip, series] of perIp) {
    if (!series.length) continue;
    const m = new Map<string, IndexPoint>();
    for (const p of series) { m.set(p.ts, p); allWeeks.add(p.ts); }
    ipWeek.set(ip, m);
  }
  const weeks = [...allWeeks].sort();
  if (weeks.length < 2) return [];

  const nAt = (wk: string) => {
    let n = 0;
    for (const m of ipWeek.values()) n += m.get(wk)?.n ?? 0;
    return n;
  };

  let level = 100;
  const out: IndexPoint[] = [{ ts: weeks[0], value: 100, n: nAt(weeks[0]) }];
  for (let i = 1; i < weeks.length; i++) {
    const wPrev = weeks[i - 1], wCur = weeks[i];
    let wRet = 0, wSum = 0;
    for (const [ip, m] of ipWeek) {
      const a = m.get(wPrev), b = m.get(wCur);
      if (!a || !b || !(a.value > 0)) continue;
      const w = Math.max(weights.get(ip) ?? 0, 0);
      if (w <= 0) continue;
      wRet += w * (b.value / a.value - 1);
      wSum += w;
    }
    if (wSum > 0) level *= 1 + wRet / wSum;
    const n = nAt(wCur);
    const hw = n > 0 ? level * (0.5 / Math.sqrt(n)) : 0;
    out.push({ ts: wCur, value: level, n, lo: n > 0 ? level - hw : undefined, hi: n > 0 ? level + hw : undefined });
  }
  return out;
}

export const PRICE_INDEX_DAY = DAY; // re-exported for the warmer's week math
