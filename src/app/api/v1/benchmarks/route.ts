/**
 * GET /api/v1/benchmarks — external benchmark series (BTC/ETH/SP500/NASDAQ/GOLD)
 * rebased onto the same axis as /api/v1/index, for overlays (B9-3). Thin wrapper
 * over readBenchmarkSeries.
 *
 * Query params:
 *   symbols  comma list of BTC,ETH,SP500,NASDAQ,GOLD  (default all)
 *   from     ISO date the series rebase to 100 at     (default 2000-01-01)
 *   freq     daily | weekly                           (default daily)
 *
 * Auth: Authorization: Bearer <key> (or ?api_key=). Attribution required — see meta.terms.
 */
import { readBenchmarkSeries, type BenchmarkSymbol } from "@/lib/data/benchmarks";
import { requireApiKey } from "@/lib/api/auth";
import { v1Ok, v1Error, v1Options, pickParam } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

export const OPTIONS = v1Options;

const ALL_SYMBOLS: BenchmarkSymbol[] = ["BTC", "ETH", "SP500", "NASDAQ", "GOLD"];

export async function GET(req: Request) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return v1Error(auth.status, auth.error);

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
    series[symbol] = await readBenchmarkSeries(symbol, { from, freq });
  }

  return v1Ok({ from, freq, rebasedTo: 100, series }, auth);
}
