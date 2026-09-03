/**
 * The SERVER-side ChartLoader — the same three reads the /api/internal/chart/*
 * routes perform, called directly instead of over HTTP.
 *
 * ⚠️ THIS IS WHERE GATING PARITY IS EARNED. Each method below mirrors its route
 * line for line: the same reader, the same arguments, the same `shapeSeries`
 * window/freq/rebase pass. It is not a reimplementation of what the routes mean —
 * the routes are themselves thin wrappers over exactly these calls, so a day the
 * live path gates is a day this path never sees either. If a route ever grows a
 * step that is not here, the precomputed bundle starts disagreeing with the live
 * chart, and that divergence is silent. Change them together.
 *
 * Server-only: it imports the DB readers, so nothing in the client bundle may
 * import this file (the client uses the HTTP loader in the component).
 */
import { readIndexSeries } from "@/lib/data/indices";
import { readBenchmarkSeries, ALL_BENCHMARK_SYMBOLS } from "@/lib/data/benchmarks";
import { readMetricSeriesBulk, type MetricEntityType, type SeriesPoint } from "@/lib/data/metricSnapshots";
import { shapeSeries } from "@/lib/api/chartSeries";
import type { ChartLoader } from "./catalog";

export function serverChartLoader(): ChartLoader {
  return {
    // Mirrors /api/internal/chart/index. The route also computes `stats`; the
    // catalog never reads them, so the bundle does not pay for them.
    async index({ entity, key, kind, from, freq }) {
      const points = await readIndexSeries(
        entity as "market" | "category" | "ip",
        key,
        { kind: kind as "price" | "mcap", from, freq: freq as "weekly" | "daily" },
      );
      return { points };
    },

    // Mirrors /api/internal/chart/benchmarks with no `symbols` param — every
    // symbol the SSOT enumerates, exactly as the route defaults.
    async benchmarks({ from, freq }) {
      const series: Record<string, unknown> = {};
      for (const symbol of ALL_BENCHMARK_SYMBOLS) {
        series[symbol] = await readBenchmarkSeries(symbol, { from, freq: freq as "weekly" | "daily" });
      }
      return { series };
    },

    // Mirrors the KEYLESS branch of /api/internal/chart/series: the bulk read
    // returns only POPULATED keys, then shaping drops any that are empty in the
    // window. That second cull is the "don't offer an empty series" rule and it
    // has to happen here too, or the bundle would advertise lines the live route
    // filters out.
    async series({ entity, metric, from }) {
      const fromMs = Date.parse(from);
      const bulk = await readMetricSeriesBulk(entity as MetricEntityType, metric);
      const series: Record<string, SeriesPoint[]> = {};
      for (const [k, raw] of bulk) {
        const shaped = shapeSeries(raw, { fromMs, fromIso: from, freq: "daily", rebase: false, metric });
        if (shaped.length) series[k] = shaped;
      }
      return { series };
    },
  };
}
