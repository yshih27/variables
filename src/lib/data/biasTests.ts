/**
 * BIAS TESTS — the acceptance gate for the price index.
 *
 * These exist because two successive index methods passed the tests they were
 * given and were still wrong. v1 passed a completeness gate and measured mix; v2
 * passed a smoothness gate (autocorrelation >= 0, no sawtooth) and measured which
 * cards sellers chose to flip. A smoothness test cannot distinguish a trend from a
 * compounding selection bias — a perfectly biased index is perfectly smooth.
 *
 * So the gate is now about the SAMPLE, not the shape of the line:
 *
 *  1. HOLDING-PERIOD INVARIANCE. A real price index has the same per-week rate
 *     whatever the interval it is measured over. v2's rate fell monotonically with
 *     holding period (+5.4%/wk at 1 week, +1.2%/wk at 6 months) — the fingerprint
 *     of resale selection. Buckets must agree within 1 percentage point per week.
 *  2. SIGN BALANCE. The share of down weeks must be within 15 points of what the
 *     least-smeared observation we have — 1-week-gap token pairs — says. An index
 *     that cannot print a down week is not measuring prices.
 *
 * Level sanity (the third test) needs market-cap series and lives in the rebuild
 * script, not here.
 */
import type { SaleRow } from "./salePanel";
import { identityPrices, GRAINS, type Grain } from "./identityIndex";
import { weekStartUtc } from "@/lib/chart/period";

const WEEK_MS = 7 * 24 * 3600 * 1000;

/** Per-week log-rate buckets by how far apart the two observations were. */
export const HOLDING_BUCKETS: [string, number, number][] = [
  ["1w", 1, 1],
  ["2-4w", 2, 4],
  ["5-12w", 5, 12],
];
/** v4 runs the same test on the monthly grid the index now uses. */
export const HOLDING_BUCKETS_MONTHLY: [string, number, number][] = [
  ["1m", 1, 1],
  ["2-3m", 2, 3],
];
/** Buckets must agree within this many percentage points per week. */
export const INVARIANCE_TOLERANCE_PP = 1;
/** Down-week share must be within this many points of the short-gap benchmark. */
export const SIGN_BALANCE_TOLERANCE_PP = 15;

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type HoldingBucket = { label: string; n: number; perWeekPct: number };
export type InvarianceResult = {
  buckets: HoldingBucket[];
  /** Max minus min per-week rate across buckets, in percentage points. */
  spreadPP: number;
  pass: boolean;
};

/**
 * Holding-period invariance over IDENTITY observations (not token pairs): for each
 * identity, every pair of its weekly prices contributes ln(ratio)/gap to the bucket
 * for that gap. Uses identities, so it measures the sample v3 actually indexes.
 */
export function holdingPeriodInvariance(
  sales: SaleRow[],
  opts: { grain?: Grain } = {},
): InvarianceResult {
  const grain = opts.grain ?? "month";
  const G = GRAINS[grain];
  const BUCKETS = grain === "month" ? HOLDING_BUCKETS_MONTHLY : HOLDING_BUCKETS;
  const maxGap = BUCKETS[BUCKETS.length - 1][2];
  const prices = identityPrices(sales, grain);
  const byIdentity = new Map<string, { wk: number; price: number }[]>();
  for (const [wk, byId] of prices) {
    const t = G.index(wk);
    for (const [id, v] of byId) {
      const a = byIdentity.get(id);
      if (a) a.push({ wk: t, price: v.price });
      else byIdentity.set(id, [{ wk: t, price: v.price }]);
    }
  }
  const buckets = new Map<string, number[]>(BUCKETS.map(([l]) => [l, []]));
  for (const obs of byIdentity.values()) {
    if (obs.length < 2) continue;
    obs.sort((a, b) => a.wk - b.wk);
    for (let i = 0; i < obs.length; i++) {
      for (let j = i + 1; j < obs.length; j++) {
        const gap = Math.round(obs[j].wk - obs[i].wk);
        if (gap < 1 || gap > maxGap) continue;
        if (!(obs[i].price > 0) || !(obs[j].price > 0)) continue;
        const b = BUCKETS.find(([, lo, hi]) => gap >= lo && gap <= hi);
        if (!b) continue;
        buckets.get(b[0])!.push(Math.log(obs[j].price / obs[i].price) / gap);
      }
    }
  }
  const out: HoldingBucket[] = BUCKETS.map(([label]) => {
    const xs = buckets.get(label)!;
    return { label, n: xs.length, perWeekPct: (Math.exp(median(xs)) - 1) * 100 };
  });
  const rates = out.filter((b) => b.n > 0 && Number.isFinite(b.perWeekPct)).map((b) => b.perWeekPct);
  const spreadPP = rates.length > 1 ? Math.max(...rates) - Math.min(...rates) : NaN;
  return { buckets: out, spreadPP, pass: Number.isFinite(spreadPP) && spreadPP <= INVARIANCE_TOLERANCE_PP };
}

/**
 * Down-week share of 1-week-gap token pairs — the least-smeared benchmark. For each
 * week, the median ratio of pairs whose two sales are exactly one week apart; the
 * benchmark is the share of those weeks whose median is below 1.
 */
export function shortGapDownShare(sales: SaleRow[]): { weeks: number; downPct: number; byWeek: Map<string, number> } {
  const byToken = new Map<string, { wk: number; price: number }[]>();
  for (const s of sales) {
    if (!(s.priceUsd > 0) || !s.tokenId) continue;
    const t = Date.parse(s.ts);
    if (!Number.isFinite(t)) continue;
    const wk = Date.parse(weekStartUtc(t)) / WEEK_MS;
    const a = byToken.get(s.tokenId);
    if (a) a.push({ wk, price: s.priceUsd });
    else byToken.set(s.tokenId, [{ wk, price: s.priceUsd }]);
  }
  const perWeek = new Map<number, number[]>();
  for (const rows of byToken.values()) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => a.wk - b.wk);
    for (let k = 1; k < rows.length; k++) {
      if (rows[k].wk - rows[k - 1].wk !== 1) continue; // exactly one week
      const arr = perWeek.get(rows[k].wk);
      if (arr) arr.push(rows[k].price / rows[k - 1].price);
      else perWeek.set(rows[k].wk, [rows[k].price / rows[k - 1].price]);
    }
  }
  const byWeek = new Map<string, number>();
  let down = 0;
  for (const [wk, ratios] of [...perWeek].sort((a, b) => a[0] - b[0])) {
    const m = median(ratios);
    byWeek.set(new Date(wk * WEEK_MS).toISOString().slice(0, 10), (m - 1) * 100);
    if (m < 1) down++;
  }
  const weeks = byWeek.size;
  return { weeks, downPct: weeks ? (down / weeks) * 100 : NaN, byWeek };
}

export type SignBalanceResult = {
  indexDownPct: number;
  benchmarkDownPct: number;
  gapPP: number;
  pass: boolean;
};

/** Down-week share of a published series vs the short-gap benchmark. */
export function signBalance(
  series: { value: number }[],
  benchmarkDownPct: number,
): SignBalanceResult {
  let down = 0, steps = 0;
  for (let i = 1; i < series.length; i++) {
    if (!(series[i - 1].value > 0)) continue;
    steps++;
    if (series[i].value < series[i - 1].value) down++;
  }
  const indexDownPct = steps ? (down / steps) * 100 : NaN;
  const gapPP = Math.abs(indexDownPct - benchmarkDownPct);
  return {
    indexDownPct,
    benchmarkDownPct,
    gapPP,
    pass: Number.isFinite(gapPP) && gapPP <= SIGN_BALANCE_TOLERANCE_PP,
  };
}
