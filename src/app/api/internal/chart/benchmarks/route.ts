/**
 * GET /api/internal/chart/benchmarks — INTERNAL (same-origin, unauthed) twin of
 * /api/v1/benchmarks for the live chart. IP-rate-limited + cached; not CORS-open.
 * Same params + `data` shape as /api/v1/benchmarks.
 */
import { readBenchmarkSeries, type BenchmarkSymbol } from "@/lib/data/benchmarks";
import { rateLimitByIp } from "@/lib/api/auth";
import { v1OkInternal, v1Error, pickParam } from "@/lib/api/v1";
import { cachedChart, CHART_RATE } from "@/lib/api/chartSeries";

export const dynamic = "force-dynamic";

const ALL_SYMBOLS: BenchmarkSymbol[] = ["BTC", "ETH", "SP500", "NASDAQ", "GOLD"];

export async function GET(req: Request) {
  const rl = await rateLimitByIp(req, CHART_RATE);
  if (!rl.ok) return v1Error(429, rl.error);

  const url = new URL(req.url);
  const freq = pickParam(url, "freq", ["daily", "weekly"] as const, "daily");
  if (!freq) return v1Error(400, "freq must be daily | weekly");
  const from = url.searchParams.get("from") ?? "2000-01-01";
  if (!Number.isFinite(Date.parse(from))) return v1Error(400, "from must be an ISO date");

  const raw = url.searchParams.get("symbols");
  const symbols = raw
    ? (raw.split(",").map((s) => s.trim().toUpperCase()) as BenchmarkSymbol[])
    : ALL_SYMBOLS;
  const unknown = symbols.filter((s) => !ALL_SYMBOLS.includes(s));
  if (unknown.length) {
    return v1Error(400, `unknown symbol(s): ${unknown.join(", ")} — valid: ${ALL_SYMBOLS.join(", ")}`);
  }

  const series: Record<string, Awaited<ReturnType<typeof readBenchmarkSeries>>> = {};
  for (const symbol of symbols) {
    series[symbol] = await cachedChart(["bench", symbol, from, freq], () =>
      readBenchmarkSeries(symbol, { from, freq }),
    );
  }

  return v1OkInternal({ from, freq, rebasedTo: 100, series });
}
