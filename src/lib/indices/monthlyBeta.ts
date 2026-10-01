/**
 * β and correlation of a MONTHLY index against BTC — on monthly returns, against
 * BTC's month-end closes. Pure, no I/O.
 *
 * ⚠️ WHY THIS REPLACED THE OLD JOIN. `indexStats` used to pair monthly index
 * points with WEEKLY BTC closes by timestamp. A month-end stamp and a week-end
 * stamp almost never coincide, so the pairs were empty and β and correlation
 * came back 0 — a number that was not a measurement. Here both sides are on the
 * same grid: the index's month-end level and BTC's last close of that month.
 *
 * Below MIN_ALIGNED_MONTHS aligned monthly returns the answer is null with the
 * reason, never 0. A return counts only across ADJACENT calendar months on both
 * sides: a month the index withheld leaves a two-month move, which is not a
 * monthly return and is skipped rather than labelled as one.
 */

/** Aligned monthly returns below which β and correlation are not computed. */
export const MIN_ALIGNED_MONTHS = 12;

type Pt = { ts: string; value: number };

const monthIndex = (ms: number): number => {
  const d = new Date(ms);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};

/** Calendar month index → BTC's last close in that month, for COMPLETE months only. */
export function btcMonthEndCloses(daily: Pt[], nowMs: number = Date.now()): Map<number, number> {
  const running = monthIndex(nowMs);
  const last = new Map<number, { t: number; v: number }>();
  for (const p of daily) {
    const t = Date.parse(p.ts);
    if (!Number.isFinite(t) || !(p.value > 0)) continue;
    const m = monthIndex(t);
    if (m >= running) continue; // the running month has no close yet
    const cur = last.get(m);
    if (!cur || t > cur.t) last.set(m, { t, v: p.value });
  }
  return new Map([...last].map(([m, x]) => [m, x.v]));
}

export type MonthlyBeta = {
  beta: number | null;
  corr: number | null;
  /** Aligned monthly returns the figures rest on. */
  months: number;
  /** Why β and correlation are null; absent when they are computed. */
  reason?: string;
};

export function monthlyBetaVsBtc(index: Pt[], btcDaily: Pt[], opts: { nowMs?: number; minMonths?: number } = {}): MonthlyBeta {
  const min = opts.minMonths ?? MIN_ALIGNED_MONTHS;
  const btc = btcMonthEndCloses(btcDaily, opts.nowMs);
  const pts = index
    .filter((p) => p.value > 0 && Number.isFinite(Date.parse(p.ts)))
    .map((p) => ({ m: monthIndex(Date.parse(p.ts)), v: p.value }))
    .sort((a, b) => a.m - b.m);
  const rIdx: number[] = [];
  const rBtc: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (b.m - a.m !== 1) continue; // a withheld month between them: not a monthly return
    const ba = btc.get(a.m);
    const bb = btc.get(b.m);
    if (!ba || !bb) continue;
    rIdx.push(b.v / a.v - 1);
    rBtc.push(bb / ba - 1);
  }
  const n = rIdx.length;
  if (n < min) return { beta: null, corr: null, months: n, reason: `${n} aligned monthly return${n === 1 ? "" : "s"}; ${min} needed` };
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const mx = mean(rIdx);
  const my = mean(rBtc);
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = rIdx[i] - mx;
    const dy = rBtc[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (!(vy > 0)) return { beta: null, corr: null, months: n, reason: "BTC did not move across the aligned months" };
  if (!(vx > 0)) return { beta: cov / vy, corr: null, months: n, reason: "the index did not move across the aligned months" };
  return { beta: cov / vy, corr: cov / Math.sqrt(vx * vy), months: n };
}
