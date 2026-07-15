import type { ActivityMetric, MetricWindow, Timeframe } from "@/components/IPActivityChart";
import { readMetricSeries, type SeriesPoint } from "./metricSnapshots";
import { formatCompactUsd, formatCompactNumber } from "@/lib/format";

/** Market spine is daily — no intraday, so 24H is always empty (offer 7D+). */
function windows(daily: number[]): Record<Timeframe, MetricWindow> {
  return {
    "24H": { points: [] },
    "7D": { points: daily.slice(-7) },
    "30D": { points: daily.slice(-30) },
    ALL: { points: daily },
  };
}

/** Sum several daily series by UTC-day ts → one market daily series (oldest→newest). */
function sumByDay(lists: SeriesPoint[][]): number[] {
  const acc = new Map<string, number>();
  for (const s of lists) for (const p of s) acc.set(p.ts, (acc.get(p.ts) ?? 0) + p.value);
  return [...acc.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, v]) => v);
}
const lastUsd = (d: number[]) => (d.length ? formatCompactUsd(d[d.length - 1]) : "—");
const lastNum = (d: number[]) => (d.length ? formatCompactNumber(d[d.length - 1]) : "—");

/**
 * Market-level Activity series for the homepage chart. Market Cap is read from
 * the spine's `market/total` row; marketplace volume, trades and active wallets
 * are summed across the tracked platforms' daily spine series. All real, daily.
 * Volume is labelled "Marketplace Vol" so it's never confused with the homepage
 * total-volume KPI (which also includes gacha + primary).
 */
export async function buildMarketActivity(
  platformKeys: string[],
  currentMcapUsd: number,
): Promise<ActivityMetric[]> {
  const reads = await Promise.all([
    readMetricSeries("market", "total", "mcap_usd").catch(() => [] as SeriesPoint[]),
    ...platformKeys.flatMap((k) => [
      readMetricSeries("platform", k, "volume_usd").catch(() => [] as SeriesPoint[]),
      readMetricSeries("platform", k, "trades").catch(() => [] as SeriesPoint[]),
      readMetricSeries("platform", k, "active_wallets").catch(() => [] as SeriesPoint[]),
    ]),
  ]);

  const mcap = reads[0].map((p) => p.value);
  const vol: SeriesPoint[][] = [];
  const trades: SeriesPoint[][] = [];
  const wallets: SeriesPoint[][] = [];
  for (let i = 0; i < platformKeys.length; i++) {
    vol.push(reads[1 + i * 3]);
    trades.push(reads[2 + i * 3]);
    wallets.push(reads[3 + i * 3]);
  }
  const volD = sumByDay(vol);
  const tradesD = sumByDay(trades);
  const walletsD = sumByDay(wallets);

  return [
    { key: "marketCap", label: "Market Cap", color: "#5b9bff", value: formatCompactUsd(currentMcapUsd), series: windows(mcap) },
    { key: "volume", label: "Marketplace Vol", color: "#bfef01", value: lastUsd(volD), series: windows(volD) },
    { key: "trades", label: "Trades", color: "#a78bfa", value: lastNum(tradesD), series: windows(tradesD) },
    { key: "activeWallets", label: "Active Wallets", color: "#f5c451", value: lastNum(walletsD), series: windows(walletsD) },
  ];
}
