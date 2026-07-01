/**
 * Indices engine — rebased market-cap index series for the TCG market + IPs, on
 * the SAME daily axis as the external benchmarks (benchmarks.ts), so the frontend
 * can overlay "Pokémon vs BTC vs S&P" on one chart.
 *
 * Methodology v1: a market-cap index = `mcap_usd` from the metric spine, rebased
 * to 100 at the window start and forward-filled across gaps. History only reaches
 * the spine's mcap inception (~2026-06-24) — we return exactly what we have (the
 * series simply starts at inception) and never fabricate earlier points. The thin
 * history is therefore visible (short series), not hidden.
 * Fast-follow (v2, not MVP): a repeat-sales price index from row-level Dune sales
 * for real backtest depth.
 */
import { readMetricSeries, dayStartUtc } from "./metricSnapshots";
import { readSnapshot } from "../db/snapshots";
import { ipsInCategory, type IPCategory } from "./ipCatalog";
import { weekStartUtc } from "./priceIndex";

export type IndexPoint = { ts: string; value: number; n?: number; lo?: number; hi?: number };

const DAY = 24 * 60 * 60 * 1000;

/**
 * Window to `from`, forward-fill a continuous daily axis, and rebase so the first
 * point equals `rebaseTo` (default 100). Shared by readIndexSeries AND
 * readBenchmarkSeries so internal indices and external benchmarks come back on
 * identical, directly-comparable axes.
 */
export function rebaseSeries(
  raw: { ts: string; value: number }[],
  from: string,
  rebaseTo = 100,
): IndexPoint[] {
  const fromMs = Date.parse(from);
  const fromDayMs = Number.isFinite(fromMs) ? Date.parse(dayStartUtc(fromMs)) : -Infinity;

  // Normalize to UTC day-start; keep finite positive values at/after `from`;
  // dedupe to one value per day (latest wins).
  const byDay = new Map<string, number>();
  for (const p of raw) {
    const t = Date.parse(p.ts);
    if (!Number.isFinite(t) || !Number.isFinite(p.value) || p.value <= 0) continue;
    if (t < fromDayMs) continue;
    byDay.set(dayStartUtc(t), p.value);
  }
  if (byDay.size === 0) return [];

  const days = [...byDay.keys()].sort();
  const firstMs = Date.parse(days[0]);
  const lastMs = Date.parse(days[days.length - 1]);
  const base = byDay.get(days[0]);
  if (!base || base <= 0) return [];

  const out: IndexPoint[] = [];
  let last = base;
  for (let t = firstMs; t <= lastMs; t += DAY) {
    const day = dayStartUtc(t);
    const v = byDay.get(day);
    if (v !== undefined) last = v; // forward-fill: carry last close over gaps
    out.push({ ts: day, value: (last / base) * rebaseTo });
  }
  return out;
}

/** Resample a daily series to weekly (Monday week-start key, last value in week). */
export function resampleWeekly(daily: IndexPoint[]): IndexPoint[] {
  const byWeek = new Map<string, IndexPoint>();
  for (const p of daily) {
    const t = Date.parse(p.ts);
    if (!Number.isFinite(t)) continue;
    const wk = weekStartUtc(t);
    byWeek.set(wk, { ...p, ts: wk }); // later day in the week overwrites → week's last
  }
  return [...byWeek.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

/** Window to `from` + rescale so the first in-window point = `rebaseTo`, preserving
 *  n/lo/hi. Unlike rebaseSeries it does NOT forward-fill (for already-sampled series). */
export function rebaseWithBands(series: IndexPoint[], from: string, rebaseTo = 100): IndexPoint[] {
  const fromMs = Date.parse(from);
  const fromDayMs = Number.isFinite(fromMs) ? Date.parse(dayStartUtc(fromMs)) : -Infinity;
  const pts = series
    .filter((p) => p.value > 0 && Number.isFinite(Date.parse(p.ts)) && Date.parse(p.ts) >= fromDayMs)
    .sort((a, b) => a.ts.localeCompare(b.ts));
  if (!pts.length || !(pts[0].value > 0)) return [];
  const f = rebaseTo / pts[0].value;
  return pts.map((p) => ({
    ts: p.ts,
    value: p.value * f,
    n: p.n,
    lo: p.lo != null ? p.lo * f : undefined,
    hi: p.hi != null ? p.hi * f : undefined,
  }));
}

/**
 * Sanitize a raw STOCK series (mcap/floor/holders) before it's rebased or charted:
 *   1. drop non-finite / non-positive readings — a $0 market cap is never real,
 *      it's a failed computation (an empty-cards scan), and it makes a rebased
 *      chart dive to zero.
 *   2. trim a LEADING ORPHAN cluster — an isolated early reading separated from the
 *      continuous body by a large gap (e.g. a one-off seed 26 days before daily
 *      coverage begins). Left in, it anchors the rebased index to pre-history and
 *      opens a gap that renders as a dip to ~0.
 * Stops at the first point whose gap to the next is within `maxLeadingGapDays`, so
 * only the leading orphan is trimmed — the continuous body is untouched. Weekly
 * series (7-day cadence) and benchmark weekend gaps stay well under the threshold.
 */
export function sanitizeStockSeries(
  raw: { ts: string; value: number }[],
  maxLeadingGapDays = 10,
): { ts: string; value: number }[] {
  const pos = raw
    .filter((p) => Number.isFinite(p.value) && p.value > 0 && Number.isFinite(Date.parse(p.ts)))
    .sort((a, b) => a.ts.localeCompare(b.ts));
  let i = 0;
  while (
    i < pos.length - 1 &&
    (Date.parse(pos[i + 1].ts) - Date.parse(pos[i].ts)) / DAY > maxLeadingGapDays
  ) {
    i += 1;
  }
  return pos.slice(i);
}

type PriceIndexSnapshot = { generatedAt: string; series: Record<string, IndexPoint[]> };

/** Read a precomputed price-index series (written by warm-sale-panel) from the blob. */
async function readPriceSeries(entity: string, key: string): Promise<IndexPoint[]> {
  const snap = await readSnapshot<PriceIndexSnapshot>("price-index");
  return snap?.series?.[`${entity}:${key}`] ?? [];
}

/** Market-size (mcap) raw series for an entity — sums member IPs for a category. */
async function readMcapSeries(
  entity: "market" | "category" | "ip",
  key: string,
): Promise<{ ts: string; value: number }[]> {
  if (entity !== "category") return sanitizeStockSeries(await readMetricSeries(entity, key, "mcap_usd"));
  const perDay = new Map<string, number>();
  for (const ip of ipsInCategory(key as IPCategory)) {
    // sanitize each IP's series first so one IP's zero/orphan day can't poison the sum
    for (const p of sanitizeStockSeries(await readMetricSeries("ip", ip, "mcap_usd"))) {
      const day = dayStartUtc(Date.parse(p.ts));
      perDay.set(day, (perDay.get(day) ?? 0) + p.value);
    }
  }
  const summed = [...perDay.entries()].map(([ts, value]) => ({ ts, value })).sort((a, b) => a.ts.localeCompare(b.ts));
  return sanitizeStockSeries(summed);
}

/**
 * Rebased index series (= 100 at `from`).
 *   kind:"price" — constant-quality stratified-median PRICE index (weekly; the fair
 *     overlay vs BTC/S&P; carries n/lo/hi; thin entities return []).
 *   kind:"mcap"  — MARKET-SIZE index (rebased mcap; compare vs total crypto mcap, NOT
 *     BTC price — it moves with supply). Daily, or weekly when freq:"weekly".
 */
export async function readIndexSeries(
  entity: "market" | "category" | "ip",
  key: string,
  opts: { kind: "price" | "mcap"; from: string; freq?: "weekly" | "daily" },
): Promise<IndexPoint[]> {
  if (opts.kind === "price") {
    return rebaseWithBands(await readPriceSeries(entity, key), opts.from); // natively weekly
  }
  const daily = rebaseSeries(await readMcapSeries(entity, key), opts.from);
  return opts.freq === "weekly" ? rebaseWithBands(resampleWeekly(daily), opts.from) : daily;
}

function betaCorr(x: number[], y: number[]): { beta: number; corr: number } {
  const n = Math.min(x.length, y.length);
  if (n < 2) return { beta: 0, corr: 0 };
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n));
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    cov += dx * dy; vx += dx * dx; vy += dy * dy;
  }
  return { beta: vy > 0 ? cov / vy : 0, corr: vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : 0 };
}

/**
 * Scorecard stats for the PRICE index: 30/90d return + beta & correlation of its
 * weekly returns vs BTC. NaN-safe (0s when history is too thin to compute).
 */
export async function indexStats(
  entity: "market" | "category" | "ip",
  key: string,
  opts: { from: string },
): Promise<{ return30d: number; return90d: number; betaVsBtc: number; corrVsBtc: number }> {
  const idx = await readIndexSeries(entity, key, { kind: "price", from: opts.from, freq: "weekly" });
  const ret = (days: number): number => {
    if (idx.length < 2) return 0;
    const last = idx[idx.length - 1];
    const targetMs = Date.parse(last.ts) - days * DAY;
    let prev = idx[0];
    for (const p of idx) {
      if (Date.parse(p.ts) <= targetMs) prev = p;
      else break;
    }
    return prev.value > 0 ? last.value / prev.value - 1 : 0;
  };
  const btcWeekly = resampleWeekly(
    rebaseSeries(await readMetricSeries("benchmark", "BTC", "close"), opts.from),
  );
  const btcByWk = new Map(btcWeekly.map((p) => [p.ts, p.value]));
  const rIdx: number[] = [], rBtc: number[] = [];
  for (let i = 1; i < idx.length; i++) {
    const a = idx[i - 1], b = idx[i];
    const ba = btcByWk.get(a.ts), bb = btcByWk.get(b.ts);
    if (a.value > 0 && b.value > 0 && ba && bb && ba > 0 && bb > 0) {
      rIdx.push(b.value / a.value - 1);
      rBtc.push(bb / ba - 1);
    }
  }
  const { beta, corr } = betaCorr(rIdx, rBtc);
  return { return30d: ret(30), return90d: ret(90), betaVsBtc: beta, corrVsBtc: corr };
}
