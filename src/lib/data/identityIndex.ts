/**
 * PRICE INDEX v3 — identity-level comparables, chained on adjacent weeks.
 *
 * WHY v2 HAD TO GO. v2 measured token-level repeat sales: the same physical token
 * sold twice. That fixed v1's composition problem and introduced a worse one — it
 * can only observe cards somebody CHOSE to resell. Measured on the Pokémon pairs:
 *
 *   holding period   pairs   closed higher   median ratio   per-week
 *     1 week           883        61%           1.054         +5.4%
 *     2-4 weeks      1,910        66%           1.079         +2.6%
 *     5-12 weeks     1,960        68%           1.114         +1.6%
 *     13-26 weeks      514        73%           1.200         +1.2%
 *
 * A real price index has the same per-week rate at every holding period. A rate
 * that FALLS with holding period, with gains beating losses ~2:1 at every horizon,
 * is selection: sellers relist what they can flip at a profit, and losers are held
 * or leave through buyback and off-marketplace channels. v2 compounded that drift
 * into a staircase — up in 31 of 31 weeks, +83% since Feb, while tracked market cap
 * sat flat at $63M.
 *
 * WHAT v3 MEASURES INSTEAD. An IDENTITY ("2023 Pokemon 151 Charizard EX #6 PSA 9")
 * is the same product whoever owns it, so every sale of any token with that
 * identity is one observation of one price. "Which token got resold" leaves the
 * sample entirely.
 *
 *   1. Weekly identity price = MEDIAN of that identity's sales that week, and only
 *      when n >= 2. One sale is a quote, not a price; those identities are dropped
 *      for that week and never imputed.
 *   2. Weekly step = WEIGHTED MEDIAN of ln(p_w / p_{w-1}) over identities present in
 *      BOTH adjacent weeks, weight = min(n_w, n_{w-1}). Adjacent weeks only — there
 *      is no smearing of a return across a span, which is the other half of what
 *      made v2 monotone.
 *   3. Liquidity floor: the step needs enough identities in the overlap (20 for
 *      market/category, 10 for an IP). Below it the week is WITHHELD and the chain
 *      DOES NOT ADVANCE — a withheld step is unknown, not zero. The next published
 *      point records how many weeks it spans (`spansWeeks`).
 *   4. Aggregates (market, category) pool identities across their members, the same
 *      pooling rule v2 used, so a thin IP cannot inject noise through a weight.
 *
 * v2's token pairs are kept as a CHECK, not as the index — see repeatSalesIndex.ts
 * and the bias tests in `biasTests.ts`.
 */
import type { IndexPoint } from "./indices";
import type { SaleRow } from "./salePanel";
import { weekStartUtc, weekEndUtc } from "@/lib/chart/period";

/** Sales of one identity in one week, below which the week's price is not a price. */
export const MIN_SALES_PER_IDENTITY = 2;
/** Identities overlapping two adjacent weeks, below which the step is withheld. */
export const MIN_IDENTITIES_BROAD = 20; // market + category
export const MIN_IDENTITIES_IP = 10; // single IP
const BAND_K = 0.5;

export type IdentityIndexPoint = IndexPoint & {
  /** Weeks since the previously published point (1 = no gap). Withheld steps make
   *  this > 1, and the reader must not treat the move as a single week's. */
  spansWeeks?: number;
};

/** Weighted median — the weight-aware 50th percentile. */
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

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type WeeklyIdentityPrices = Map<string, Map<string, { price: number; n: number }>>;

/**
 * week (Monday ISO) → identity → { median price, sales }. Identities with fewer
 * than MIN_SALES_PER_IDENTITY sales in a week are absent for that week.
 */
export function weeklyIdentityPrices(sales: SaleRow[]): WeeklyIdentityPrices {
  const raw = new Map<string, Map<string, number[]>>();
  for (const s of sales) {
    if (!s.identity || !(s.priceUsd > 0)) continue;
    const t = Date.parse(s.ts);
    if (!Number.isFinite(t)) continue;
    const wk = weekStartUtc(t);
    let byId = raw.get(wk);
    if (!byId) raw.set(wk, (byId = new Map()));
    const arr = byId.get(s.identity);
    if (arr) arr.push(s.priceUsd);
    else byId.set(s.identity, [s.priceUsd]);
  }
  const out: WeeklyIdentityPrices = new Map();
  for (const [wk, byId] of raw) {
    const kept = new Map<string, { price: number; n: number }>();
    for (const [id, prices] of byId) {
      if (prices.length < MIN_SALES_PER_IDENTITY) continue;
      kept.set(id, { price: median(prices), n: prices.length });
    }
    if (kept.size) out.set(wk, kept);
  }
  return out;
}

export type WeeklyStep = {
  week: string; // Monday ISO of the LATER week
  logReturn: number;
  /** Identities present in both weeks — the liquidity measure the floor uses. */
  overlap: number;
};

/** Adjacent-week steps. Only weeks that both have identity prices produce one. */
export function weeklySteps(prices: WeeklyIdentityPrices): WeeklyStep[] {
  const weeks = [...prices.keys()].sort();
  const out: WeeklyStep[] = [];
  for (let i = 1; i < weeks.length; i++) {
    const prev = prices.get(weeks[i - 1])!;
    const cur = prices.get(weeks[i])!;
    // Adjacency is by CALENDAR week, not by array position: if a week has no
    // identity prices at all it is a hole, and a step across it would silently
    // become a multi-week return labelled as one week.
    const gapWeeks = Math.round(
      (Date.parse(weeks[i]) - Date.parse(weeks[i - 1])) / (7 * 24 * 3600 * 1000),
    );
    if (gapWeeks !== 1) continue;
    const obs: { v: number; w: number }[] = [];
    for (const [id, c] of cur) {
      const p = prev.get(id);
      if (!p || !(p.price > 0) || !(c.price > 0)) continue;
      obs.push({ v: Math.log(c.price / p.price), w: Math.min(c.n, p.n) });
    }
    if (!obs.length) continue;
    out.push({ week: weeks[i], logReturn: weightedMedian(obs), overlap: obs.length });
  }
  return out;
}

/**
 * v3 index for one entity's sales. Same IndexPoint shape, week-END stamping and
 * in-progress-week gate as v1/v2, plus `spansWeeks` on points that follow a
 * withheld step.
 */
export function identityIndex(
  sales: SaleRow[],
  opts: { minIdentities?: number; bandK?: number; nowMs?: number; minWeeks?: number } = {},
): IdentityIndexPoint[] {
  const floor = opts.minIdentities ?? MIN_IDENTITIES_IP;
  const bandK = opts.bandK ?? BAND_K;
  const minWeeks = opts.minWeeks ?? 3;
  const prices = weeklyIdentityPrices(sales);
  const steps = weeklySteps(prices);
  if (!steps.length) return [];

  const runningCutoff = Date.parse(weekStartUtc(opts.nowMs ?? Date.now()));
  const WEEK = 7 * 24 * 3600 * 1000;

  // The base is the first week that PARTICIPATES in a qualifying step, so the
  // series never opens on a week we could not measure a move out of.
  const qualifying = steps.filter((s) => s.overlap >= floor);
  if (!qualifying.length) return [];
  const baseWeek = new Date(Date.parse(qualifying[0].week) - WEEK).toISOString();

  const out: IdentityIndexPoint[] = [];
  let level = 100;
  let lastPublishedMs = Date.parse(baseWeek);
  const baseStamp = weekEndUtc(Date.parse(baseWeek));
  if (Date.parse(baseStamp) < runningCutoff) {
    out.push({ ts: baseStamp, value: 100, n: prices.get(baseWeek)?.size ?? 0, spansWeeks: 0 });
  }

  for (const st of steps) {
    // Below the floor: the step is UNKNOWN. Do not advance the chain, do not
    // publish, and do not treat it as zero.
    if (st.overlap < floor) continue;
    if (Date.parse(st.week) <= Date.parse(baseWeek)) continue;
    level *= Math.exp(st.logReturn);
    const stamp = weekEndUtc(Date.parse(st.week));
    if (Date.parse(stamp) >= runningCutoff) continue; // in-progress week
    const spans = Math.round((Date.parse(st.week) - lastPublishedMs) / WEEK);
    lastPublishedMs = Date.parse(st.week);
    const n = st.overlap;
    const hw = level * (bandK / Math.sqrt(n));
    out.push({ ts: stamp, value: level, n, lo: level - hw, hi: level + hw, spansWeeks: spans });
  }

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
