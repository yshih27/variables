/**
 * Daily benchmark closes → metric spine (entity_type "benchmark", metric "close").
 *
 *   npx tsx scripts/warm-benchmarks.ts
 *
 * BTC/ETH from CoinGecko market_chart; S&P 100 (^oex) + NASDAQ-100 (^ndx) from
 * Stooq's free daily CSV (no key). Idempotent upsert; stores the last ~400 days so
 * the indices engine's benchmark overlays cover any window the internal index
 * reaches (index inception ~2026-06-24). Read via readBenchmarkSeries (rebased).
 *
 * Runs in the DAILY warm batch.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { fetchCoinGeckoMarketChart } from "../src/lib/data/prices";
import {
  fetchEquityDailyCloses,
  BENCHMARK_COINGECKO_ID,
  BENCHMARK_EQUITY,
} from "../src/lib/data/benchmarks";
import { writeMetricSnapshots, dayStartUtc, type MetricRow } from "../src/lib/data/metricSnapshots";
import { runWarmer } from "../src/lib/db/runWarmer";

const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 400;

/** Bucket raw [ms, price] points to one close per UTC day (latest wins). */
function bucketDaily(prices: [number, number][]): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const [ms, price] of prices) {
    if (!Number.isFinite(ms) || !Number.isFinite(price) || price <= 0) continue;
    byDay.set(dayStartUtc(ms), price);
  }
  return byDay;
}

async function main() {
  const since = Date.now() - WINDOW_DAYS * DAY;
  const rows: MetricRow[] = [];
  const add = (symbol: string, ts: string, close: number) => {
    if (Date.parse(ts) >= since) {
      rows.push({ entity_type: "benchmark", entity_key: symbol, metric: "close", value: close, ts });
    }
  };

  // ── Crypto: CoinGecko market_chart (daily for days > 90) ──
  for (const [symbol, id] of Object.entries(BENCHMARK_COINGECKO_ID)) {
    try {
      const before = rows.length;
      const byDay = bucketDaily(await fetchCoinGeckoMarketChart(id, 365));
      for (const [ts, close] of byDay) add(symbol, ts, close);
      console.log(`→ ${symbol} (CoinGecko ${id}): ${rows.length - before} closes in window`);
    } catch (e) {
      console.warn(`→ ${symbol} (CoinGecko) FAILED: ${(e as Error).message}`);
    }
  }

  // ── Equities: FRED → Stooq → Yahoo fallback ──
  for (const symbol of Object.keys(BENCHMARK_EQUITY) as ("SP500" | "NASDAQ")[]) {
    try {
      const before = rows.length;
      for (const c of await fetchEquityDailyCloses(symbol)) add(symbol, c.ts, c.close);
      console.log(`→ ${symbol} (equity): ${rows.length - before} closes in window`);
    } catch (e) {
      console.warn(`→ ${symbol} (equity) FAILED: ${(e as Error).message}`);
    }
  }

  const written = await writeMetricSnapshots(rows);
  console.log(`Wrote ${written} benchmark rows`);
  return { rowsWritten: written };
}

runWarmer("benchmarks", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
