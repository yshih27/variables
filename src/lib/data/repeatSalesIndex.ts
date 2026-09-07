/**
 * REPEAT-SALES price index (Bailey–Muth–Nourse / Case–Shiller family).
 *
 * WHY THIS REPLACED THE STRATIFIED MEDIAN. The cell method indexed each
 * `set|grade` cell against whatever happened to sell in its first week, so a cell
 * mixing a $10 common with a $1,000 chase card carried relatives of 30–114× and a
 * handful of one-trade cells supplied most of the printed level. Its week-over-week
 * series was independent noise (lag-1 autocorrelation −0.32, 11 sign flips in 21
 * weeks) — the index moved when the MIX moved, with no card repricing.
 *
 * The same physical card (same `tokenId`) sold in two different weeks is the only
 * constant-quality comparison the panel supports, and there are plenty of them. A
 * pair carries no composition at all: whatever the card is, it is the same card on
 * both dates.
 *
 * ESTIMATOR — BOTH WERE BUILT AND MEASURED; THE MEDIAN-RATE ONE SHIPS.
 *
 * The brief named weighted least squares over week dummies as the primary and the
 * median rate as an acceptable v1. Measured on the live panel, the regression FAILS
 * this index's acceptance test and the median does not, so the median ships:
 *
 *     V-MKT over 32 backfilled weeks     lag-1 autocorr    sign flips    cumulative
 *       old stratified median                 -0.32          16/33         +202.2%
 *       WLS over week dummies                 -0.29          16/31         +135.3%
 *       median rate  (SHIPPED)                +0.56           0/31          +82.7%
 *
 * Why the regression sawtooths here: it gives every week its own free parameter, so
 * with ~1,700 pairs spread over 50+ weekly dummies the thin weeks are estimated off
 * a handful of pair endpoints and alternate sign — the same high-frequency
 * fragility that broke the cell method, arrived at by a different route. Weekly
 * dummies are simply too fine a grid for this panel's pair density.
 *
 * The shipped estimator instead lets each pair speak for EVERY week it spans: a
 * pair with sales in weeks i < j contributes its average weekly log-return
 * `ln(p1/p0) / (j-i)` to each of those weeks, weighted by `1/(j-i)` (a long gap says
 * less about any single week). beta_k is the weighted MEDIAN of those
 * contributions, so a handful of extreme pairs cannot move a week. Both estimators
 * remain exported: `estimator: "wls"` reproduces the regression, which is how the
 * table above is regenerated.
 *
 * The cost is honest and worth stating: smearing a ratio uniformly across a gap
 * assigns some of a move to weeks in which it may not have happened, so this index
 * is smoother than the truth at weekly resolution. It is a trend estimator. The
 * alternative on this panel is not a sharper index, it is a noisier one.
 */
import type { IndexPoint } from "./indices";
import type { SaleRow } from "./salePanel";
import { weekStartUtc, weekEndUtc } from "@/lib/chart/period";

/** Ratio bounds — outside this a "pair" is a re-grade or a data error, not a move. */
export const RATIO_MIN = 0.2;
export const RATIO_MAX = 5;
/** A pair spanning more than this says nothing useful about any single week. */
export const MAX_GAP_WEEKS = 26;
/** Pairs touching a week, below which the week is not printed. */
export const MIN_PAIRS_BROAD = 30; // market + category
export const MIN_PAIRS_IP = 15; // single IP
/**
 * INV-11: a weekly step beyond ±this much is only publishable when the week is
 * thick enough to mean it. Below THIN_WEEK_PAIRS the point is WITHHELD (reason
 * `thin-week`) rather than printed — the +40.5% week that triggered the rebuild
 * had 345 pairs, so this is a guard against thin-week artefacts, not against
 * genuine moves.
 */
export const STEP_LIMIT_PCT = 25;
export const THIN_WEEK_PAIRS = 100;
/** Band half-width ≈ value · BAND_K/√n, same convention as the old index. */
const BAND_K = 0.5;
/** Ridge term: keeps the normal equations solvable when a week has no spanning pair. */
const RIDGE = 1e-6;

export type RepeatPair = {
  tokenId: string;
  /** Week indices into the module's week grid, i < j. */
  i: number;
  j: number;
  /** ln(p1/p0). */
  r: number;
  weeks: number; // j - i
};

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** The contiguous Monday grid the regression indexes weeks against. */
export function weekGrid(sales: SaleRow[]): string[] {
  let min = Infinity, max = -Infinity;
  for (const s of sales) {
    const t = Date.parse(s.ts);
    if (!Number.isFinite(t)) continue;
    const w = Date.parse(weekStartUtc(t));
    if (w < min) min = w;
    if (w > max) max = w;
  }
  if (!Number.isFinite(min)) return [];
  const out: string[] = [];
  for (let t = min; t <= max; t += 7 * 24 * 3600 * 1000) out.push(new Date(t).toISOString());
  return out;
}

/**
 * Consecutive sales of the same token in DIFFERENT weeks → one pair each.
 * Consecutive (not all-pairs) so a token trading five times contributes four
 * independent links rather than ten overlapping ones that would double-count it.
 */
export function buildPairs(sales: SaleRow[], grid: string[]): RepeatPair[] {
  if (grid.length < 2) return [];
  const weekIndex = new Map<string, number>();
  grid.forEach((w, k) => weekIndex.set(w, k));

  // Panel-wide winsorization bounds. A sale outside them DROPS its pair — unlike
  // the old index we do not clamp, because a clamped price is a fabricated ratio.
  const sortedPrices = sales.map((s) => s.priceUsd).filter((p) => p > 0).sort((a, b) => a - b);
  const loP = quantile(sortedPrices, 0.01);
  const hiP = quantile(sortedPrices, 0.99);

  const byToken = new Map<string, SaleRow[]>();
  for (const s of sales) {
    if (!(s.priceUsd > 0) || !s.tokenId) continue;
    const a = byToken.get(s.tokenId);
    if (a) a.push(s);
    else byToken.set(s.tokenId, [s]);
  }

  const pairs: RepeatPair[] = [];
  for (const [tokenId, rows] of byToken) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    for (let k = 1; k < rows.length; k++) {
      const a = rows[k - 1], b = rows[k];
      const i = weekIndex.get(weekStartUtc(Date.parse(a.ts)));
      const j = weekIndex.get(weekStartUtc(Date.parse(b.ts)));
      if (i === undefined || j === undefined || j <= i) continue; // same week → no link
      if (j - i > MAX_GAP_WEEKS) continue;
      if (a.priceUsd < loP || a.priceUsd > hiP || b.priceUsd < loP || b.priceUsd > hiP) continue;
      const ratio = b.priceUsd / a.priceUsd;
      if (!(ratio >= RATIO_MIN && ratio <= RATIO_MAX)) continue;
      pairs.push({ tokenId, i, j, r: Math.log(ratio), weeks: j - i });
    }
  }
  return pairs;
}

/** Gaussian elimination with partial pivoting. Returns null if singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, k) => [...row, b[k]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let cc = c; cc <= n; cc++) M[r][cc] -= f * M[c][cc];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Weighted median — the weight-aware analogue of the 50th percentile. */
function weightedMedian(xs: { v: number; w: number }[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a.v - b.v);
  const total = s.reduce((acc, e) => acc + e.w, 0);
  let run = 0;
  for (const e of s) {
    run += e.w;
    if (run >= total / 2) return e.v;
  }
  return s[s.length - 1].v;
}

/**
 * MEDIAN-RATE estimator: each pair spanning week k contributes its average weekly
 * log-return `r / weeks`, weighted by `1/weeks`; beta_k is the weighted median of
 * those contributions.
 *
 * This is the estimator the index SHIPS with. See the module header for why it beat
 * the regression on this panel.
 */
export function fitMedianRate(pairs: RepeatPair[], gridLen: number): RepeatSalesFit | null {
  if (gridLen < 2 || pairs.length === 0) return null;
  const buckets: { v: number; w: number }[][] = Array.from({ length: gridLen }, () => []);
  const touching = new Array<number>(gridLen).fill(0);
  for (const p of pairs) {
    const rate = p.r / p.weeks;
    const w = 1 / p.weeks;
    for (let k = p.i + 1; k <= p.j; k++) {
      buckets[k].push({ v: rate, w });
      touching[k]++;
    }
  }
  const beta = new Array<number>(gridLen).fill(0);
  for (let k = 1; k < gridLen; k++) {
    const m = weightedMedian(buckets[k]);
    beta[k] = Number.isFinite(m) ? m : 0;
  }
  return { beta, touching, pairs };
}

export type RepeatSalesFit = {
  /** Weekly log-returns; beta[k] is the return INTO grid week k (beta[0] unused). */
  beta: number[];
  /** Pairs whose interval covers each week — the liquidity measure the floor uses. */
  touching: number[];
  pairs: RepeatPair[];
};

/** Solve the weighted normal equations for the weekly log-returns. */
export function fitRepeatSales(pairs: RepeatPair[], gridLen: number): RepeatSalesFit | null {
  const K = gridLen - 1; // one unknown per week transition
  if (K < 1 || pairs.length === 0) return null;
  const A: number[][] = Array.from({ length: K }, () => new Array<number>(K).fill(0));
  const rhs = new Array<number>(K).fill(0);
  const touching = new Array<number>(gridLen).fill(0);

  for (const p of pairs) {
    const w = 1 / p.weeks;
    // Unknown index k-1 corresponds to beta_k (k = i+1 … j).
    const cols: number[] = [];
    for (let k = p.i + 1; k <= p.j; k++) {
      cols.push(k - 1);
      touching[k]++;
    }
    for (const c1 of cols) {
      rhs[c1] += w * p.r;
      for (const c2 of cols) A[c1][c2] += w;
    }
  }
  for (let c = 0; c < K; c++) A[c][c] += RIDGE;

  const x = solve(A, rhs);
  if (!x) return null;
  const beta = [0, ...x];
  return { beta, touching, pairs };
}

/**
 * Repeat-sales weekly index for one entity's sales. Same IndexPoint shape, same
 * week-END stamping and same in-progress-week gate as the old estimator, so nothing
 * downstream changes. Returns [] when no week clears the liquidity floor.
 */
export function repeatSalesIndex(
  sales: SaleRow[],
  opts: {
    minPairs?: number;
    bandK?: number;
    nowMs?: number;
    minWeeks?: number;
    /** "median-rate" (default, shipped) or "wls" (the textbook regression). */
    estimator?: "median-rate" | "wls";
  } = {},
): IndexPoint[] {
  const minPairs = opts.minPairs ?? MIN_PAIRS_IP;
  const bandK = opts.bandK ?? BAND_K;
  const minWeeks = opts.minWeeks ?? 3;
  const grid = weekGrid(sales);
  if (grid.length < 2) return [];
  const pairs = buildPairs(sales, grid);
  const fit =
    opts.estimator === "wls"
      ? fitRepeatSales(pairs, grid.length)
      : fitMedianRate(pairs, grid.length);
  if (!fit) return [];

  // Completeness gate — never publish the in-progress week (mirrors the reader's
  // completeWeeksOnly, so the raw blob equals the complete-weeks view).
  const runningCutoff = Date.parse(weekStartUtc(opts.nowMs ?? Date.now()));

  // Chain the log-returns across the WHOLE grid, then publish only qualifying
  // weeks. A withheld week still advances the chain — it is never interpolated,
  // and never silently drops the return that happened during it.
  let cum = 0;
  const out: IndexPoint[] = [];
  for (let k = 0; k < grid.length; k++) {
    cum += fit.beta[k] ?? 0;
    const stamp = weekEndUtc(Date.parse(grid[k]));
    if (Date.parse(stamp) >= runningCutoff) continue;
    const n = fit.touching[k];
    if (n < minPairs) continue;
    const value = 100 * Math.exp(cum);
    const hw = value * (bandK / Math.sqrt(n));
    out.push({ ts: stamp, value, n, lo: value - hw, hi: value + hw });
  }
  // INV-11 withholding: drop a point whose step from the last KEPT point exceeds
  // ±STEP_LIMIT_PCT while the week is thin. Never interpolated — the week simply
  // does not print, exactly like a liquidity-floor miss.
  const kept: IndexPoint[] = [];
  for (const p of out) {
    const prev = kept[kept.length - 1];
    if (prev && prev.value > 0 && (p.n ?? 0) < THIN_WEEK_PAIRS) {
      const stepPct = Math.abs(p.value / prev.value - 1) * 100;
      if (stepPct > STEP_LIMIT_PCT) continue; // thin-week
    }
    kept.push(p);
  }
  out.length = 0;
  out.push(...kept);

  if (out.length < minWeeks) return [];

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
