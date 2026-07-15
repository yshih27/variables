import { notFound } from "next/navigation";
import { PlatformRail } from "@/components/PlatformRail";
import { SliceView } from "@/components/SliceView";
import {
  type ActivityMetric,
  type MetricWindow,
  type Timeframe,
} from "@/components/IPActivityChart";
import { DominancePanel, type DomEntity } from "@/components/IPDominance";
import { IPByPlatform, type PlatformRow } from "@/components/IPByPlatform";
import { PlatformGachaPanel } from "@/components/PlatformGachaPanel";
import { PlatformTopCardsTable, RecentSalesTable } from "@/components/PlatformTables";
import { getPlatformDetail, getPlatformActivitySeries, type PlatformIPRow } from "@/lib/data/fetchPlatform";
import { type SeriesPoint } from "@/lib/data/metricSnapshots";
import { formatCompactUsd, formatInt } from "@/lib/format";

// ISR: cached HTML, 30-min background revalidate (data changes every ~6h) — R2-B1.
// Dynamic [key] routes generate on-demand (first hit), then serve cached HTML.
export const revalidate = 1800;

/** Per-timeframe windows from a real daily series (metric_snapshots) + optional
 *  real 24h-hourly series. A window with <2 points — or an all-zero hourly (no sales
 *  inside the data's own last-24h) — has no history yet, so the chart disables that
 *  metric for the window ("no intraday data") instead of drawing a flat $0 line
 *  (QA-2). We never fabricate a series. */
function buildWindows(
  daily: SeriesPoint[],
  hourly: number[] | null,
): Record<Timeframe, MetricWindow> {
  const vals = daily.map((p) => p.value);
  const ts = daily.map((p) => p.ts);
  // 24h hourly buckets carry no stored timestamps — synthesize trailing-hour stamps
  // from request time (deterministic server-side → no hydration drift).
  const now = Date.now();
  const hourlyTs = (n: number) =>
    Array.from({ length: n }, (_, i) => new Date(now - (n - 1 - i) * 3_600_000).toISOString());
  const hourlyOk = !!hourly && hourly.length >= 2 && hourly.some((v) => v > 0);
  return {
    "24H": hourlyOk ? { points: hourly!, ts: hourlyTs(hourly!.length) } : { points: [] },
    "7D": { points: vals.slice(-7), ts: ts.slice(-7) },
    "30D": { points: vals.slice(-30), ts: ts.slice(-30) },
    ALL: { points: vals, ts },
  };
}

export default async function PlatformDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  // Both cached (unstable_cache) — one memoized call each instead of 5 uncached
  // round-trips per request (R2-B1).
  const [detail, series] = await Promise.all([
    getPlatformDetail(key),
    getPlatformActivitySeries(key),
  ]);
  if (!detail) notFound();
  const { volume: volS, wallets: walletsS, trades: tradesS, mcap: mcapS } = series;

  // Avg-trade daily series = volume / trades, aligned by day.
  const tradesByTs = new Map(tradesS.map((p) => [p.ts, p.value]));
  const avgS: SeriesPoint[] = volS
    .map((p) => {
      const t = tradesByTs.get(p.ts) ?? 0;
      return { ts: p.ts, value: t > 0 ? p.value / t : NaN };
    })
    .filter((p) => Number.isFinite(p.value));

  // Activity metrics — chip headline values are the live current figures; series
  // are real from metric_snapshots (24h volume from hourly buckets). A window
  // with <2 points has no history yet (the chart disables it); never fabricated.
  const metrics: ActivityMetric[] = [
    { key: "volume", label: "Volume", color: "#bfef01", value: formatCompactUsd(detail.vol24Usd), series: buildWindows(volS, detail.hourlyVol) },
    { key: "marketCap", label: "Market Cap", color: "#5b9bff", value: detail.mcapUsd > 0 ? formatCompactUsd(detail.mcapUsd) : "—", note: "Market cap tracked for Beezie & Collector Crypt only", series: buildWindows(mcapS, null) },
    { key: "trades", label: "Trades", color: "#a78bfa", value: formatInt(detail.trades24h), series: buildWindows(tradesS, null) },
    { key: "avgTrade", label: "Avg Trade", color: "#2bd6a0", value: formatCompactUsd(detail.avgTradeUsd), series: buildWindows(avgS, null) },
    { key: "activeWallets", label: "Active Wallets", color: "#f5c451", value: formatInt(detail.uniqueWallets), series: buildWindows(walletsS, null) },
  ];

  // IP composition — real per-IP volume/trades/mcap/cards/holders. Top N + an
  // "Other" bucket so the donut and dominance stay honest (sum to 100%) without
  // an overlong table.
  const sumBy = (rows: PlatformIPRow[], pick: (r: PlatformIPRow) => number) =>
    rows.reduce((a, r) => a + (pick(r) || 0), 0);

  // The catch-all "other" IP (uncategorized cards) is split out so it folds into
  // the single synthetic "Other" bucket — otherwise the data's own "Other" plus
  // the overflow bucket would surface as TWO "Other" rows.
  const namedIps = detail.ips.filter((ip) => ip.key !== "other");
  const catchAllIps = detail.ips.filter((ip) => ip.key === "other");

  const TOP = 8;
  const topIps = namedIps.slice(0, TOP);
  const restIps = [...namedIps.slice(TOP), ...catchAllIps];
  const ipRows: PlatformRow[] = [
    ...topIps.map((ip) => ({
      key: ip.key,
      name: ip.name,
      chain: "",
      chainColor: "",
      color: ip.color,
      cards: ip.cards,
      vol24Usd: ip.vol24Usd,
      mcapUsd: ip.mcapUsd,
      trades24h: ip.trades24h,
      avgTradeUsd: ip.avgTradeUsd,
      holders: ip.holders,
    })),
    ...(restIps.length
      ? [
          {
            key: "other",
            name: "Other",
            chain: "",
            chainColor: "",
            color: "#52525b",
            cards: sumBy(restIps, (r) => r.cards),
            vol24Usd: sumBy(restIps, (r) => r.vol24Usd),
            mcapUsd: sumBy(restIps, (r) => r.mcapUsd),
            trades24h: sumBy(restIps, (r) => r.trades24h),
            avgTradeUsd: 0,
            holders: null,
          },
        ]
      : []),
  ];

  const DOM = 6;
  const domTop = namedIps.slice(0, DOM);
  const domRest = [...namedIps.slice(DOM), ...catchAllIps];
  const ipEntities: DomEntity[] = [
    ...domTop.map((ip) => ({
      name: ip.name,
      color: ip.color,
      values: { volume: ip.vol24Usd, cards: ip.cards, trades: ip.trades24h, avgTrade: ip.avgTradeUsd },
    })),
    ...(domRest.length
      ? [
          {
            name: "Other",
            color: "#52525b",
            values: {
              volume: sumBy(domRest, (r) => r.vol24Usd),
              cards: sumBy(domRest, (r) => r.cards),
              trades: sumBy(domRest, (r) => r.trades24h),
              avgTrade: 0,
            },
          },
        ]
      : []),
  ];

  return (
    <SliceView
      slice={{
        rail: <PlatformRail detail={detail} mcapPct={null} />,
        activity: metrics,
      }}
    >
      {ipEntities.length > 0 && (
        <DominancePanel
          title="IP dominance"
          source={{ entities: ipEntities }}
          defaultMetric="volume"
          seeAllHref={`/platform/${key}/ips`}
          className="mb-12 font-sans"
        />
      )}
      {ipRows.length > 0 && (
        <IPByPlatform
          rows={ipRows}
          title="By IP"
          subtitle="How this platform's 24h volume breaks down across IPs"
          entityHeader="IP"
          donutTitle="IP share"
          showChain={false}
          hrefBase="/ip/"
        />
      )}
      <PlatformGachaPanel detail={detail} />
      <PlatformTopCardsTable rows={detail.topCards} maxRows={10} seeAllHref={`/platform/${key}/cards`} />
      <RecentSalesTable rows={detail.recentSales} maxRows={12} seeAllHref={`/platform/${key}/sales`} />
    </SliceView>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const detail = await getPlatformDetail(key);
  if (!detail) return { title: "Not found · VARIBLE" };
  return {
    title: `${detail.source.name} · VARIBLE`,
    description: `Per-platform analytics for ${detail.source.name} (${detail.chain}) on VARIBLE — volume, IP composition, gacha sales, and recent activity.`,
  };
}
