/**
 * External-market benchmarks (BTC / ETH / SOL / Gold / S&P 500 / NASDAQ Composite)
 * on the same rebased daily axis as the internal indices (indices.ts), so the
 * frontend can chart the TCG market against them.
 *
 * Daily closes live in the metric spine (`entity_type: "benchmark"`, metric
 * `"close"`, entity_key = symbol), written by scripts/warm-benchmarks.ts — so
 * reads never hit an external API per request.
 *   • BTC/ETH/SOL/GOLD → CoinGecko market_chart (prices.ts), free, no key.
 *   • SP500/NASDAQ → FRED (St. Louis Fed, FRED_API_KEY) as PRIMARY, with Stooq CSV
 *     → Yahoo chart-API as no-key fallbacks. FRED is reliable from servers; Stooq
 *     & Yahoo IP-block some datacenter hosts, so they're fallback-only.
 */
import { readMetricSeries, dayStartUtc } from "./metricSnapshots";
import { rebaseSeries, rebaseWithBands, resampleWeekly, type IndexPoint } from "./indices";

export type BenchmarkSymbol = "BTC" | "ETH" | "SOL" | "SP500" | "NASDAQ" | "GOLD";

/**
 * Every benchmark symbol, in display order. The SSOT the API routes enumerate for
 * their default set + unknown-symbol validation, so the type and the actually-served
 * set can never drift (add a symbol here and both /api/v1/benchmarks and the internal
 * chart twin pick it up).
 */
export const ALL_BENCHMARK_SYMBOLS: BenchmarkSymbol[] = ["BTC", "ETH", "SOL", "SP500", "NASDAQ", "GOLD"];

/**
 * CoinGecko-sourced benchmarks → coin ids (via prices.fetchCoinGeckoMarketChart).
 * BTC/ETH/SOL are the crypto majors; GOLD is PAX Gold (PAXG) — tokenized gold, fully
 * LBMA-backed and redeemable, so it tracks the spot gold price ~1:1 (within <1%).
 * CoinGecko is the reliable server-side source: FRED has NO daily spot-gold price
 * series anymore (the LBMA fixing series were discontinued → 400), and Stooq/Yahoo
 * IP-block datacenter hosts (so they fail in GitHub Actions). PAXG on CoinGecko is
 * as reliable here as BTC/ETH. SOL matters here specifically because much of the
 * RWA-TCG volume settles on Solana (Collector Crypt, Phygitals), so it's the
 * closest "native chain" benchmark for the market this app tracks.
 */
export const BENCHMARK_COINGECKO_ID: Record<"BTC" | "ETH" | "SOL" | "GOLD", string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  GOLD: "pax-gold",
};

/** Equity benchmarks → source symbols, tried FRED → Stooq → Yahoo in that order. */
export const BENCHMARK_EQUITY: Record<
  "SP500" | "NASDAQ",
  { fred: string; stooq: string; yahoo: string }
> = {
  SP500: { fred: "SP500", stooq: "^spx", yahoo: "^GSPC" }, // S&P 500
  NASDAQ: { fred: "NASDAQCOM", stooq: "^ndq", yahoo: "^IXIC" }, // NASDAQ Composite
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Rebased benchmark series (= 100 at `from`), same axis/shape as readIndexSeries —
 * pass both the same `from` to overlay them aligned.
 */
export async function readBenchmarkSeries(
  symbol: BenchmarkSymbol,
  opts: { from: string; freq?: "weekly" | "daily" },
): Promise<IndexPoint[]> {
  const raw = await readMetricSeries("benchmark", symbol, "close");
  if (opts.freq === "weekly") {
    // resample daily closes → weekly (align to the price index's weekly axis), then rebase
    return rebaseWithBands(resampleWeekly(raw.map((p) => ({ ts: p.ts, value: p.value }))), opts.from);
  }
  return rebaseSeries(raw, opts.from, 100);
}

/** Daily closes from FRED (PRIMARY equity source; reliable from servers, needs key). */
async function fetchFredDailyCloses(seriesId: string): Promise<{ ts: string; close: number }[]> {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error("FRED_API_KEY not set");
  const start = new Date(Date.now() - 800 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${key}&file_type=json&observation_start=${start}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`FRED ${res.status} for ${seriesId}`);
  const j = (await res.json()) as { observations?: { date: string; value: string }[] };
  const out: { ts: string; close: number }[] = [];
  for (const o of j.observations ?? []) {
    const close = Number(o.value); // "." (missing) → NaN, skipped
    const t = Date.parse(o.date);
    if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(t)) continue;
    out.push({ ts: dayStartUtc(t), close });
  }
  if (out.length === 0) throw new Error(`FRED ${seriesId}: 0 valid observations`);
  return out;
}

/** Daily closes from Stooq's free CSV (no key). Throws on a non-CSV (anti-bot) body. */
async function fetchStooqDailyCloses(stooqSymbol: string): Promise<{ ts: string; close: number }[]> {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=d`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`Stooq ${res.status}`);
  const csv = (await res.text()).trim();
  const lines = csv.split("\n");
  if (lines.length < 2 || !/^date,/i.test(lines[0])) throw new Error(`Stooq non-CSV ("${csv.slice(0, 40)}")`);
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
    if (typeof c === "number" && Number.isFinite(c) && c > 0) out.push({ ts: dayStartUtc(ts[i] * 1000), close: c });
  }
  if (out.length === 0) throw new Error("Yahoo returned 0 closes");
  return out;
}

/** Equity daily closes with source fallback: FRED → Stooq → Yahoo. */
export async function fetchEquityDailyCloses(
  symbol: "SP500" | "NASDAQ",
): Promise<{ ts: string; close: number }[]> {
  const { fred, stooq, yahoo } = BENCHMARK_EQUITY[symbol];
  const sources: [string, () => Promise<{ ts: string; close: number }[]>][] = [
    ["FRED", () => fetchFredDailyCloses(fred)],
    ["Stooq", () => fetchStooqDailyCloses(stooq)],
    ["Yahoo", () => fetchYahooDailyCloses(yahoo)],
  ];
  const errs: string[] = [];
  for (const [name, fn] of sources) {
    try {
      const rows = await fn();
      if (rows.length) return rows;
      errs.push(`${name}: 0 rows`);
    } catch (e) {
      errs.push(`${name}: ${(e as Error).message}`);
    }
  }
  throw new Error(`all equity sources failed (${errs.join("; ")})`);
}
