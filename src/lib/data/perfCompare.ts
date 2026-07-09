import type { CategoryTrend } from "../category/rollup";
import { readIndexSeries, rebaseSeries, resampleWeekly } from "./indices";
import { readMetricSeries } from "./metricSnapshots";
import { tickerOf } from "../indices/naming";

/**
 * Rebased PRICE-index comparison for the /ips + /ip[key] charts (QA-6): the given
 * internal entities (IPs and/or the whole market) plus the 4 external benchmarks
 * (BTC / ETH / S&P 500 / NASDAQ), aligned on ONE weekly axis. The price index is a
 * constant-quality (stratified-median) series, so overlaying it against benchmark
 * prices is apples-to-apples — that's why these charts drop the "market size" caveat.
 *
 * Benchmark datasets are flagged so the chart draws them dashed + defaults them off
 * (opt-in overlay). Returns empty when no internal entity has a price series, so the
 * caller can fall back to the mcap "market size" index.
 */
export type PriceEntity = { entity: "market" | "ip"; key: string; label: string; color: string };

/** Range options tuned for the WEEKLY price index (a 7D window would show ~1
 *  point). `days: 0` ⇒ "all". Passed to CategoryTrendChart's `ranges`. */
export const PRICE_RANGES = [
  { key: "30D", days: 30 },
  { key: "90D", days: 90 },
  { key: "6M", days: 182 },
  { key: "ALL", days: 0 },
];

const BENCHMARKS = [
  { sym: "BTC", label: "BTC", color: "#e8993a" },
  { sym: "ETH", label: "ETH", color: "#8b93c9" },
  { sym: "GOLD", label: "Gold", color: "#c8a951" },
  { sym: "SP500", label: "S&P 500", color: "#9aa0ab" },
  { sym: "NASDAQ", label: "NASDAQ", color: "#6fb0c9" },
] as const;

// A generous floor for the reads; price series naturally start much later (first
// week with enough graded sales), and benchmarks are windowed to that inception.
const FROM = "2025-06-01";

type Line = { group: string; color: string; benchmark: boolean; ticker?: string; series: { ts: string; value: number }[] };

export async function buildPriceComparison(entities: PriceEntity[]): Promise<CategoryTrend> {
  const internal = (
    await Promise.all(
      entities.map(async (e) => ({
        group: e.label,
        color: e.color,
        benchmark: false,
        // Internal index series carry a V- ticker (chart legend shows it; tooltip
        // keeps the plain `group` name). Benchmarks intentionally have none.
        ticker: tickerOf(e.entity, e.key),
        series: await readIndexSeries(e.entity, e.key, { kind: "price", from: FROM }),
      })),
    )
  ).filter((s) => s.series.length >= 2);
  if (internal.length === 0) return { labels: [], datasets: [] };

  // Anchor benchmarks to the earliest internal inception so all lines share one
  // start; the chart re-rebases to the visible window anyway.
  const inception = internal.reduce(
    (min, s) => (s.series[0].ts < min ? s.series[0].ts : min),
    internal[0].series[0].ts,
  );
  const benches = (
    await Promise.all(
      BENCHMARKS.map(async (b) => ({
        group: b.label,
        color: b.color,
        benchmark: true,
        series: resampleWeekly(rebaseSeries(await readMetricSeries("benchmark", b.sym, "close"), inception)),
      })),
    )
  ).filter((b) => b.series.length >= 2);

  return alignSparse([...internal, ...benches]);
}

/**
 * Align labelled weekly series onto one axis WITHOUT forward-filling gaps: a week
 * before a series begins stays NaN (not a 0), so a later-starting line simply
 * doesn't draw there rather than cratering to zero. The chart bridges the rare
 * internal gap by connecting its finite points.
 */
function alignSparse(items: Line[]): CategoryTrend {
  const tsSet = new Set<string>();
  for (const it of items) for (const p of it.series) tsSet.add(p.ts);
  const labels = [...tsSet].sort();
  const idx = new Map(labels.map((ts, i) => [ts, i]));
  const datasets = items
    .filter((it) => it.series.length > 0)
    .map((it) => {
      const arr = new Array<number>(labels.length).fill(NaN);
      for (const p of it.series) {
        const i = idx.get(p.ts);
        if (i != null && Number.isFinite(p.value)) arr[i] = p.value;
      }
      return { group: it.group, color: it.color, benchmark: it.benchmark, ticker: it.ticker, points: arr };
    });
  return { labels, datasets };
}
