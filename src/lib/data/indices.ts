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

export type IndexPoint = { ts: string; value: number };

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

/**
 * Rebased market-cap index for the whole market or a single IP.
 *   readIndexSeries("ip", "pokemon", { from }) → IndexPoint[] (= 100 at `from`)
 *   readIndexSeries("market", "total", { from })
 */
export async function readIndexSeries(
  entity: "market" | "ip",
  key: string,
  opts: { from: string; rebaseTo?: number },
): Promise<IndexPoint[]> {
  const raw = await readMetricSeries(entity, key, "mcap_usd");
  return rebaseSeries(raw, opts.from, opts.rebaseTo ?? 100);
}
