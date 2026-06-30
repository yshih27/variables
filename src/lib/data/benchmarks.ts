/**
 * External-market benchmarks (BTC / ETH / S&P 100 / NASDAQ-100) on the same
 * rebased daily axis as the internal indices (indices.ts), so the frontend can
 * chart the TCG market against them.
 *
 * Daily closes live in the metric spine (`entity_type: "benchmark"`, metric
 * `"close"`, entity_key = symbol), written by scripts/warm-benchmarks.ts — so
 * reads never hit an external API per request.
 *   • BTC/ETH  → CoinGecko market_chart (prices.ts), free, no key.
 *   • S&P 100 / NASDAQ-100 → Stooq daily CSV with a Yahoo Finance fallback (both
 *     free, no key). Both can IP-block datacenter hosts, so we try Stooq first
 *     then Yahoo; whichever the warmer's host can reach wins.
 */
import { readMetricSeries, dayStartUtc } from "./metricSnapshots";
import { rebaseSeries, type IndexPoint } from "./indices";

export type BenchmarkSymbol = "BTC" | "ETH" | "SP100" | "NDX";

/** Crypto benchmarks → CoinGecko coin ids (via prices.fetchCoinGeckoMarketChart). */
export const BENCHMARK_COINGECKO_ID: Record<"BTC" | "ETH", string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
};

/** Equity benchmarks → { Stooq symbol, Yahoo symbol } (tried in that order). */
export const BENCHMARK_EQUITY: Record<"SP100" | "NDX", { stooq: string; yahoo: string }> = {
  SP100: { stooq: "^oex", yahoo: "^OEX" }, // S&P 100
  NDX: { stooq: "^ndx", yahoo: "^NDX" }, // NASDAQ-100
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Rebased benchmark series (= 100 at `from`), same axis/shape as readIndexSeries —
 * pass both the same `from` to overlay them aligned.
 */
export async function readBenchmarkSeries(
  symbol: BenchmarkSymbol,
  opts: { from: string },
): Promise<IndexPoint[]> {
  const raw = await readMetricSeries("benchmark", symbol, "close");
  return rebaseSeries(raw, opts.from, 100);
}

/** Daily closes from Stooq's free CSV (no key). Throws on a non-CSV body (Stooq
 *  serves an HTML anti-bot page to blocked IPs) so the caller can fall back. */
async function fetchStooqDailyCloses(stooqSymbol: string): Promise<{ ts: string; close: number }[]> {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=d`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`Stooq ${res.status}`);
  const csv = (await res.text()).trim();
  const lines = csv.split("\n");
  if (lines.length < 2 || !/^date,/i.test(lines[0])) {
    throw new Error(`Stooq non-CSV ("${csv.slice(0, 40)}")`);
  }
  const out: { ts: string; close: number }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const t = Date.parse(cols[0]);
    const close = Number(cols[4]);
    if (!Number.isFinite(t) || !Number.isFinite(close) || close <= 0) continue;
    out.push({ ts: dayStartUtc(t), close });
  }
  return out;
}

/** Daily closes from Yahoo Finance's chart API (no key). Retries on 429/5xx. */
async function fetchYahooDailyCloses(
  yahooSymbol: string,
  attempt = 0,
): Promise<{ ts: string; close: number }[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=2y`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store" });
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return fetchYahooDailyCloses(yahooSymbol, attempt + 1);
  }
  if (!res.ok) throw new Error(`Yahoo ${res.status}`);
  const j = (await res.json()) as {
    chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
  };
  const r = j?.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const close = r?.indicators?.quote?.[0]?.close ?? [];
  const out: { ts: string; close: number }[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = close[i];
    if (typeof c === "number" && Number.isFinite(c) && c > 0) {
      out.push({ ts: dayStartUtc(ts[i] * 1000), close: c });
    }
  }
  if (out.length === 0) throw new Error("Yahoo returned 0 closes");
  return out;
}

/** Equity daily closes with source fallback: Stooq first, Yahoo on failure. */
export async function fetchEquityDailyCloses(
  symbol: "SP100" | "NDX",
): Promise<{ ts: string; close: number }[]> {
  const { stooq, yahoo } = BENCHMARK_EQUITY[symbol];
  try {
    const rows = await fetchStooqDailyCloses(stooq);
    if (rows.length) return rows;
    throw new Error("Stooq returned 0 rows");
  } catch (e1) {
    try {
      return await fetchYahooDailyCloses(yahoo);
    } catch (e2) {
      throw new Error(
        `both equity sources failed (stooq: ${(e1 as Error).message}; yahoo: ${(e2 as Error).message})`,
      );
    }
  }
}
