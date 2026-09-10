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
import { weekStartUtc, weekEndUtc, monthStartUtc, monthEndUtc } from "@/lib/chart/period";

/**
 * GRAIN — v4 runs this index on calendar MONTHS, not weeks.
 *
 * v3 (#122) established that weekly identity comparables are too thin on this
 * panel: adjacent weeks share a median of 2 priced identities, so 0 of 22 steps
 * cleared the market floor and nothing published. Adjacent MONTHS share 21-75.
 * Nothing about the estimator changes — only the grid it runs on.
 *
 * Periods are addressed by an INTEGER index, not by milliseconds, because months
 * are not a fixed duration: adjacency is "the next calendar month", and a
 * ms-division would drift across 28/30/31-day months and DST-free UTC alike.
 */
export type Grain = "week" | "month";

type GrainSpec = {
  start: (ms: number) => string;
  end: (ms: number) => string;
  /** Period → integer so adjacency is `index(b) - index(a) === 1`. */
  index: (iso: string) => number;
  fromIndex: (i: number) => string;
  label: string;
};

const WEEK_MS = 7 * 24 * 3600 * 1000;

export const GRAINS: Record<Grain, GrainSpec> = {
  week: {
    start: weekStartUtc,
    end: weekEndUtc,
    index: (iso) => Math.round(Date.parse(iso) / WEEK_MS),
    fromIndex: (i) => new Date(i * WEEK_MS).toISOString(),
    label: "week",
  },
  month: {
    start: monthStartUtc,
    end: monthEndUtc,
    index: (iso) => {
      const d = new Date(iso);
      return d.getUTCFullYear() * 12 + d.getUTCMonth();
    },
    fromIndex: (i) => new Date(Date.UTC(Math.floor(i / 12), i % 12, 1)).toISOString(),
    label: "month",
  },
};

/** Sales of one identity in one week, below which the week's price is not a price. */
export const MIN_SALES_PER_IDENTITY = 2;
/** Identities overlapping two adjacent weeks, below which the step is withheld. */
export const MIN_IDENTITIES_BROAD = 20; // market + category
export const MIN_IDENTITIES_IP = 10; // single IP
/**
 * INV-11 at monthly grain: a step beyond ±25% is only publishable when the month
 * rests on at least this many identities. Lower than the weekly pair threshold
 * (100) because an identity priced from >=2 sales in BOTH months is a much stronger
 * observation than one token resold once.
 */
export const THIN_MONTH_IDENTITIES = 50;
/** INV-11's magnitude limit: a step beyond this needs THIN_MONTH_IDENTITIES. */
export const STEP_LIMIT_PCT = 25;

export type IdentityIndexPoint = IndexPoint & {
  /** Weeks since the previously published point (1 = no gap). Withheld steps make
   *  this > 1, and the reader must not treat the move as a single week's. */
  spansWeeks?: number;
  /**
   * The per-identity observations behind this point's step, [logReturn, weight].
   * Carried so INV-13 can re-derive the estimator from the raw sample and prove
   * the step never rests on one identity. The warmer strips it into the blob's
   * `stepObs` block; it is not part of the published `series` shape.
   */
  obs?: [number, number][];
};

/** Weighted median — the weight-aware 50th percentile. */
/**
 * INTERPOLATED weighted median — the v4.1 estimator, and the ONE implementation
 * (the premium and the bootstrap import it; there is no second copy).
 *
 * ⚠️ WHY NOT THE PLAIN WEIGHTED MEDIAN. The plain form returns the first
 * observation whose cumulative weight crosses 50%, i.e. ONE identity's return.
 * Measured Sep 10 on the market's June → July step: 49 identities priced in both
 * months, 22 up, 2 flat, 25 down, unweighted median −2.08% — and the published
 * step was exactly 0.00%, because the sale-count-weighted cut landed on one of
 * the two identities that resold at the same price. The level of the whole market
 * rested on a single card, and the hero drew a flat month.
 *
 * Here each sorted observation owns a weight interval and is positioned at that
 * interval's MIDPOINT, p_k = (Σ_{i<k} w_i + w_k/2) / W. The 50% mark is then
 * linearly interpolated between the two observations that straddle it — the
 * "type 7" treatment generalised to weights. With equal weights it reduces to the
 * textbook median (middle element for odd n, mean of the two middle elements for
 * even n); with unequal weights the answer can equal a single identity's return
 * only when the mark lands exactly on that identity's midpoint, or when the two
 * straddling identities carry the same return — the degenerate cases INV-13
 * allows and logs.
 *
 * A trimmed mean was considered and rejected: it changes what the index measures.
 */
export function weightedMedian(xs: { v: number; w: number }[]): number {
  const s = xs.filter((e) => e.w > 0 && Number.isFinite(e.v)).sort((a, b) => a.v - b.v);
  if (!s.length) return NaN;
  if (s.length === 1) return s[0].v;
  const W = s.reduce((acc, e) => acc + e.w, 0);
  let cum = 0;
  const pos = s.map((e) => {
    const p = (cum + e.w / 2) / W;
    cum += e.w;
    return p;
  });
  if (pos[0] >= 0.5) return s[0].v;
  for (let k = 1; k < s.length; k++) {
    if (pos[k] >= 0.5) {
      const span = pos[k] - pos[k - 1];
      const t = span > 0 ? (0.5 - pos[k - 1]) / span : 0;
      return s[k - 1].v + t * (s[k].v - s[k - 1].v);
    }
  }
  return s[s.length - 1].v;
}

/**
 * Where the 50% mark sits relative to the observations — for INV-13's
 * "degenerate" classification. `onMidpoint` = the mark landed exactly on one
 * observation's midpoint (the estimator then equals that single value by
 * construction); `tie` = the two straddling observations share a value.
 */
export function weightedMedianDegeneracy(xs: { v: number; w: number }[]): { onMidpoint: boolean; tie: boolean } {
  const s = xs.filter((e) => e.w > 0 && Number.isFinite(e.v)).sort((a, b) => a.v - b.v);
  if (s.length < 2) return { onMidpoint: true, tie: false };
  const W = s.reduce((acc, e) => acc + e.w, 0);
  let cum = 0;
  const pos = s.map((e) => {
    const p = (cum + e.w / 2) / W;
    cum += e.w;
    return p;
  });
  const onMidpoint = pos.some((p) => Math.abs(p - 0.5) < 1e-12);
  let tie = false;
  for (let k = 1; k < s.length; k++) {
    if (pos[k] >= 0.5) {
      tie = Math.abs(s[k].v - s[k - 1].v) < 1e-9;
      break;
    }
  }
  return { onMidpoint, tie };
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type WeeklyIdentityPrices = Map<string, Map<string, { price: number; n: number }>>;
/** Same shape at any grain — period-start ISO → identity → { median price, sales }. */
export type PeriodIdentityPrices = WeeklyIdentityPrices;

/**
 * week (Monday ISO) → identity → { median price, sales }. Identities with fewer
 * than MIN_SALES_PER_IDENTITY sales in a week are absent for that week.
 */
export function weeklyIdentityPrices(sales: SaleRow[]): WeeklyIdentityPrices {
  return identityPrices(sales, "week");
}

/** Monthly identity prices — the v4 grid. */
export function monthlyIdentityPrices(sales: SaleRow[]): PeriodIdentityPrices {
  return identityPrices(sales, "month");
}

export function identityPrices(sales: SaleRow[], grain: Grain): PeriodIdentityPrices {
  const G = GRAINS[grain];
  const raw = new Map<string, Map<string, number[]>>();
  for (const s of sales) {
    if (!s.identity || !(s.priceUsd > 0)) continue;
    const t = Date.parse(s.ts);
    if (!Number.isFinite(t)) continue;
    const wk = G.start(t);
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
  week: string; // period-start ISO of the LATER period
  logReturn: number;
  /** Identities present in both periods — the liquidity measure the floor uses. */
  overlap: number;
  /** Per-identity log returns behind this step — the bootstrap resamples these. */
  obs: { v: number; w: number }[];
};

/** Adjacent-week steps. Only weeks that both have identity prices produce one. */
export function weeklySteps(prices: WeeklyIdentityPrices): WeeklyStep[] {
  return periodSteps(prices, "week");
}

export function monthlySteps(prices: PeriodIdentityPrices): WeeklyStep[] {
  return periodSteps(prices, "month");
}

export function periodSteps(prices: PeriodIdentityPrices, grain: Grain): WeeklyStep[] {
  const G = GRAINS[grain];
  const weeks = [...prices.keys()].sort();
  const out: WeeklyStep[] = [];
  for (let i = 1; i < weeks.length; i++) {
    const prev = prices.get(weeks[i - 1])!;
    const cur = prices.get(weeks[i])!;
    // Adjacency is by CALENDAR week, not by array position: if a week has no
    // identity prices at all it is a hole, and a step across it would silently
    // become a multi-week return labelled as one week.
    // Adjacency is CALENDAR adjacency: a period with no priced identities is a
    // hole, and a step across it would silently be a multi-period return labelled
    // as one period.
    if (G.index(weeks[i]) - G.index(weeks[i - 1]) !== 1) continue;
    const obs: { v: number; w: number }[] = [];
    for (const [id, c] of cur) {
      const p = prev.get(id);
      if (!p || !(p.price > 0) || !(c.price > 0)) continue;
      obs.push({ v: Math.log(c.price / p.price), w: Math.min(c.n, p.n) });
    }
    if (!obs.length) continue;
    out.push({ week: weeks[i], logReturn: weightedMedian(obs), overlap: obs.length, obs });
  }
  return out;
}

/** Deterministic LCG — a published index must not move because a band was reseeded. */
function lcg(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export const BOOTSTRAP_DRAWS = 200;

/**
 * Bootstrap the standard deviation of one step's weighted median by resampling
 * IDENTITIES with replacement. This is the honest uncertainty for this estimator:
 * the sampling unit is the identity, so that is what gets resampled — `k/√n`
 * assumed an independent-observation model this index does not have.
 */
function bootstrapSd(obs: { v: number; w: number }[], seed: number): number {
  const n = obs.length;
  if (n < 2) return NaN;
  const rnd = lcg(seed);
  const draws: number[] = [];
  for (let d = 0; d < BOOTSTRAP_DRAWS; d++) {
    const pick: { v: number; w: number }[] = new Array(n);
    for (let k = 0; k < n; k++) pick[k] = obs[Math.floor(rnd() * n)];
    draws.push(weightedMedian(pick));
  }
  const mu = draws.reduce((a, b) => a + b, 0) / draws.length;
  return Math.sqrt(draws.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(draws.length - 1, 1));
}

/**
 * Identity-comparables index for one entity's sales.
 *
 * v4 runs this at `grain: "month"`. Same IndexPoint shape, period-END stamping and
 * running-period gate as v1/v2/v3, plus `spansWeeks` (periods spanned) on points
 * that follow a withheld step.
 *
 * Bands are a bootstrap over identities, accumulated along the chain: the
 * uncertainty in a level is the uncertainty of every step that built it, so the
 * band widens with distance from the base — which is the truth about a chained
 * index and something the old k/√n band hid.
 */
export function identityIndex(
  sales: SaleRow[],
  opts: {
    minIdentities?: number;
    nowMs?: number;
    minWeeks?: number;
    grain?: Grain;
    /** z for the band; 1.96 ≈ 95%. */
    z?: number;
  } = {},
): IdentityIndexPoint[] {
  const grain = opts.grain ?? "month";
  const G = GRAINS[grain];
  const floor = opts.minIdentities ?? MIN_IDENTITIES_IP;
  const minPeriods = opts.minWeeks ?? 3;
  const z = opts.z ?? 1.96;

  const prices = identityPrices(sales, grain);
  const steps = periodSteps(prices, grain);
  if (!steps.length) return [];

  // Never publish the running period (mirrors completeWeeksOnly/completeMonthsOnly).
  const runningIdx = G.index(G.start(opts.nowMs ?? Date.now()));

  const qualifying = steps.filter((s) => s.overlap >= floor);
  if (!qualifying.length) return [];
  const baseIdx = G.index(qualifying[0].week) - 1;
  const baseStart = G.fromIndex(baseIdx);

  const out: IdentityIndexPoint[] = [];
  let logLevel = 0;
  let cumVar = 0;
  let lastPublishedIdx = baseIdx;

  if (baseIdx < runningIdx) {
    out.push({
      ts: G.end(Date.parse(baseStart)),
      value: 100,
      n: prices.get(baseStart)?.size ?? 0,
      spansWeeks: 0,
    });
  }

  for (const st of steps) {
    const idx = G.index(st.week);
    if (idx <= baseIdx) continue;
    // Below the floor the step is UNKNOWN: do not advance the chain, do not
    // publish, and do not treat it as zero.
    if (st.overlap < floor) continue;
    /**
     * INV-11, ENFORCED HERE AND NOT ONLY CHECKED. A step beyond ±25% resting on
     * fewer than THIN_MONTH_IDENTITIES identities is withheld the same way a
     * below-floor step is: unpublished AND not chained through.
     *
     * ⚠️ It must not advance the chain. Advancing while withholding would keep
     * the suspect move in the level and merely hide the point that shows it —
     * the number would still be in the line, just harder to see. The reader gets
     * a gap and `spansWeeks` instead. Before this, `THIN_MONTH_IDENTITIES` was
     * declared but only ever checked by check-invariants, so the invariant could
     * fail but never be satisfied by construction; `set:pokemon:black-star-promo`
     * 2026-05-31 (+27.5% on 12 identities) is the step that exposed it.
     */
    if (Math.abs(Math.exp(st.logReturn) - 1) * 100 > STEP_LIMIT_PCT && st.overlap < THIN_MONTH_IDENTITIES) {
      continue;
    }
    logLevel += st.logReturn;
    const sd = bootstrapSd(st.obs, 1000003 + idx * 7919);
    if (Number.isFinite(sd)) cumVar += sd * sd;
    if (idx >= runningIdx) continue;
    const spans = idx - lastPublishedIdx;
    lastPublishedIdx = idx;
    const value = 100 * Math.exp(logLevel);
    const half = z * Math.sqrt(cumVar);
    out.push({
      ts: G.end(Date.parse(st.week)),
      value,
      n: st.overlap,
      lo: value * Math.exp(-half),
      hi: value * Math.exp(half),
      spansWeeks: spans,
      // DISCLOSURE, not a hold: a step resting on fewer identities than
      // THIN_MONTH_IDENTITIES is published (the ±25% gate above is unchanged)
      // but says so, so the tooltip and the CSV can print "thin month · 49
      // identities" rather than presenting it with the same confidence as a
      // month with 200.
      thin: st.overlap < THIN_MONTH_IDENTITIES,
      obs: st.obs.map((o) => [o.v, o.w] as [number, number]),
    });
  }

  if (out.length < minPeriods) return [];
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
