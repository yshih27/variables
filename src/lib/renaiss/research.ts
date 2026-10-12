/**
 * Renaiss research: what happens to a prize after the pull, how Renaiss's
 * stated prize values compare with what the same slabs later sold for, and how
 * Renaiss's marketplace prices compare with the Renaiss Index (the physical
 * market). Pure functions over rows the script reads; no I/O here.
 *
 * ⚠️ EVERY FIGURE IS MEASURED ON OUR STORES, WITH ITS n AND ITS WINDOW.
 * - A pull's prize is a token. The same token can come out of a pack more than
 *   once: between two pulls it went back to Renaiss (a buyback or a sale to the
 *   house). That is the only "back to Renaiss" signal the stores carry; a
 *   redemption (burn) or an off-market transfer is invisible here, so "kept"
 *   means "neither resold on the marketplace nor pulled again", nothing more.
 * - A fate is read at a fixed horizon (30 days) and only for pulls at least
 *   that old, so recent pulls are not counted as "kept" for lack of time.
 */

export const DAY_MS = 86_400_000;

/** One named pull, as the research needs it. */
export type ResearchPull = {
  pullId: string;
  tokenId: string;
  pulledAt: number; // ms
  buyer: string | null;
  paidUsd: number | null;
  statedUsd: number | null;
  machine: string;
  cert: string | null;
  grade: string | null;
};

/** One marketplace sale, as the research needs it. */
export type ResearchSale = {
  tokenId: string;
  soldAt: number; // ms
  seller: string | null;
  buyer: string | null;
  priceUsd: number;
  cert: string | null;
  grade: string | null;
};

export type Fate = "resold-by-puller" | "back-in-a-pack" | "kept";

export type PullOutcome = {
  pull: ResearchPull;
  /** The token's first marketplace sale after this pull (and before it was pulled again). */
  firstSale: ResearchSale | null;
  /** When the same token next came out of a pack, if it did. */
  nextPullAt: number | null;
  /** How many times this token had been pulled before this pull. */
  priorPulls: number;
};

/** Value tiers by Renaiss's stated prize value, in dollars: [label, low, high). */
export const VALUE_TIERS: [string, number, number][] = [
  ["under $25", 0, 25],
  ["$25–100", 25, 100],
  ["$100–500", 100, 500],
  ["$500+", 500, Infinity],
];

export function tierOf(usd: number | null): string | null {
  if (usd == null || !(usd > 0)) return null;
  return VALUE_TIERS.find(([, lo, hi]) => usd >= lo && usd < hi)?.[0] ?? null;
}

const lower = (a: string | null) => (a ? a.toLowerCase() : null);

/**
 * Join every pull to its token's later history: the next pull of the same
 * token, the first marketplace sale between the two, and how many times the
 * token had come out of a pack before.
 */
export function outcomesOf(pulls: ResearchPull[], sales: ResearchSale[]): PullOutcome[] {
  const pullsByToken = new Map<string, ResearchPull[]>();
  for (const p of pulls) {
    const list = pullsByToken.get(p.tokenId);
    if (list) list.push(p);
    else pullsByToken.set(p.tokenId, [p]);
  }
  const salesByToken = new Map<string, ResearchSale[]>();
  for (const s of sales) {
    const list = salesByToken.get(s.tokenId);
    if (list) list.push(s);
    else salesByToken.set(s.tokenId, [s]);
  }
  for (const l of pullsByToken.values()) l.sort((a, b) => a.pulledAt - b.pulledAt);
  for (const l of salesByToken.values()) l.sort((a, b) => a.soldAt - b.soldAt);

  const out: PullOutcome[] = [];
  for (const [token, list] of pullsByToken) {
    const ts = salesByToken.get(token) ?? [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const nextPullAt = i + 1 < list.length ? list[i + 1].pulledAt : null;
      const firstSale = ts.find((s) => s.soldAt > p.pulledAt && (nextPullAt == null || s.soldAt < nextPullAt)) ?? null;
      out.push({ pull: p, firstSale, nextPullAt, priorPulls: i });
    }
  }
  return out;
}

/** The pull's fate at `horizonMs` after it, or null when the pull is younger than the horizon. */
export function fateAt(o: PullOutcome, horizonMs: number, nowMs: number): Fate | null {
  const end = o.pull.pulledAt + horizonMs;
  if (end > nowMs) return null;
  const sale = o.firstSale && o.firstSale.soldAt <= end ? o.firstSale : null;
  if (sale && lower(sale.seller) === lower(o.pull.buyer)) {
    // Resold on the marketplace by the wallet that pulled it, before any re-pull.
    if (o.nextPullAt == null || sale.soldAt < o.nextPullAt) return "resold-by-puller";
  }
  if (o.nextPullAt != null && o.nextPullAt <= end) return "back-in-a-pack";
  return "kept";
}

export type Quantiles = { n: number; p25: number | null; median: number | null; p75: number | null };

export function quantiles(xs: number[]): Quantiles {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const q = (f: number) => (v.length ? v[Math.min(v.length - 1, Math.floor(f * (v.length - 1) + 0.5))] : null);
  return { n: v.length, p25: q(0.25), median: q(0.5), p75: q(0.75) };
}

export type FateRow = { group: string; n: number; resold: number; backInPack: number; kept: number; medianDaysToResale: number | null };

/** Fate shares at the horizon, overall and by a grouping. */
export function fateTable(outcomes: PullOutcome[], groupOf: (o: PullOutcome) => string | null, horizonMs: number, nowMs: number): FateRow[] {
  const acc = new Map<string, { n: number; resold: number; back: number; kept: number; days: number[] }>();
  for (const o of outcomes) {
    const f = fateAt(o, horizonMs, nowMs);
    if (!f) continue;
    const g = groupOf(o);
    if (!g) continue;
    const a = acc.get(g) ?? { n: 0, resold: 0, back: 0, kept: 0, days: [] };
    a.n++;
    if (f === "resold-by-puller") {
      a.resold++;
      a.days.push((o.firstSale!.soldAt - o.pull.pulledAt) / DAY_MS);
    } else if (f === "back-in-a-pack") a.back++;
    else a.kept++;
    acc.set(g, a);
  }
  return [...acc.entries()]
    .map(([group, a]) => ({ group, n: a.n, resold: a.resold / a.n, backInPack: a.back / a.n, kept: a.kept / a.n, medianDaysToResale: quantiles(a.days).median }))
    .sort((a, b) => b.n - a.n);
}

export type RatioRow = { group: string; n: number; ratio: Quantiles; pooled: number | null };

/**
 * Renaiss's stated prize value against the price the same slab fetched on
 * Renaiss's marketplace: the first sale after the pull, within `withinMs`
 * (so the market has not moved far from the pull). ratio = sale ÷ stated;
 * pooled = Σ sale ÷ Σ stated.
 */
export function statedVsResale(outcomes: PullOutcome[], groupOf: (o: PullOutcome) => string | null, withinMs: number): RatioRow[] {
  const acc = new Map<string, { r: number[]; sale: number; stated: number }>();
  for (const o of outcomes) {
    const v = o.pull.statedUsd;
    const s = o.firstSale;
    if (!s || v == null || !(v > 0) || s.soldAt - o.pull.pulledAt > withinMs) continue;
    const g = groupOf(o);
    if (!g) continue;
    const a = acc.get(g) ?? { r: [], sale: 0, stated: 0 };
    a.r.push(s.priceUsd / v);
    a.sale += s.priceUsd;
    a.stated += v;
    acc.set(g, a);
  }
  return [...acc.entries()]
    .map(([group, a]) => ({ group, n: a.r.length, ratio: quantiles(a.r), pooled: a.stated > 0 ? a.sale / a.stated : null }))
    .sort((a, b) => b.n - a.n);
}

/** How many times each token came out of a pack, as a distribution. */
export function recycling(pulls: ResearchPull[]): { tokens: number; pulls: number; repullShare: number; byCount: Record<string, number>; maxPulls: number; daysBetween: Quantiles } {
  const byToken = new Map<string, number[]>();
  for (const p of pulls) {
    const l = byToken.get(p.tokenId);
    if (l) l.push(p.pulledAt);
    else byToken.set(p.tokenId, [p.pulledAt]);
  }
  const byCount: Record<string, number> = {};
  let max = 0;
  const gaps: number[] = [];
  for (const ts of byToken.values()) {
    ts.sort((a, b) => a - b);
    const k = ts.length >= 5 ? "5+" : String(ts.length);
    byCount[k] = (byCount[k] ?? 0) + 1;
    max = Math.max(max, ts.length);
    for (let i = 1; i < ts.length; i++) gaps.push((ts[i] - ts[i - 1]) / DAY_MS);
  }
  const repulls = pulls.length - byToken.size;
  return { tokens: byToken.size, pulls: pulls.length, repullShare: pulls.length ? repulls / pulls.length : 0, byCount, maxPulls: max, daysBetween: quantiles(gaps) };
}
