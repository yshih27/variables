import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { PlatformRail } from "@/components/PlatformRail";
import {
  IPActivityChart,
  type ActivityMetric,
  type MetricWindow,
  type Timeframe,
} from "@/components/IPActivityChart";
import { DominancePanel, type DomEntity } from "@/components/IPDominance";
import { IPByPlatform, type PlatformRow } from "@/components/IPByPlatform";
import { PlatformGachaPanel } from "@/components/PlatformGachaPanel";
import { PlatformTopCardsTable, RecentSalesTable } from "@/components/PlatformTables";
import { getPlatformDetail, type PlatformIPRow } from "@/lib/data/fetchPlatform";
import { readMetricSeries, type SeriesPoint } from "@/lib/data/metricSnapshots";
import { formatCompactUsd, formatInt } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Deterministic placeholder series (no RNG → no hydration drift), used per
 *  window only when the real metric_snapshots series has <2 points. */
function phSeries(seed: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = i / Math.max(1, n - 1);
    const v =
      0.55 +
      0.3 * Math.sin(seed + x * 6.2) +
      0.13 * Math.sin(seed * 1.7 + x * 12.5) +
      0.06 * Math.sin(seed * 3.1 + x * 22);
    out.push(Math.max(0.04, v));
  }
  return out;
}

/** Per-timeframe windows from a real daily series (metric_snapshots) + optional
 *  real 24h-hourly series. A window is real with ≥2 points, else a sample trend. */
function buildWindows(
  daily: SeriesPoint[],
  hourly: number[] | null,
  seed: number,
): Record<Timeframe, MetricWindow> {
  const vals = daily.map((p) => p.value);
  const win = (pts: number[], phLen: number, phSeed: number): MetricWindow =>
    pts.length >= 2 ? { points: pts, real: true } : { points: phSeries(phSeed, phLen), real: false };
  return {
    "24H": hourly && hourly.length >= 2 ? { points: hourly, real: true } : win([], 24, seed),
    "7D": win(vals.slice(-7), 28, seed + 0.5),
    "30D": win(vals.slice(-30), 30, seed + 1),
    ALL: win(vals, 36, seed + 1.5),
  };
}

export default async function PlatformDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const [detail, volS, walletsS, tradesS, mcapS] = await Promise.all([
    getPlatformDetail(key),
    readMetricSeries("platform", key, "volume_usd").catch(() => [] as SeriesPoint[]),
    readMetricSeries("platform", key, "active_wallets").catch(() => [] as SeriesPoint[]),
    readMetricSeries("platform", key, "trades").catch(() => [] as SeriesPoint[]),
    readMetricSeries("platform", key, "mcap_usd").catch(() => [] as SeriesPoint[]),
  ]);
  if (!detail) notFound();

  // Avg-trade daily series = volume / trades, aligned by day.
  const tradesByTs = new Map(tradesS.map((p) => [p.ts, p.value]));
  const avgS: SeriesPoint[] = volS
    .map((p) => {
      const t = tradesByTs.get(p.ts) ?? 0;
      return { ts: p.ts, value: t > 0 ? p.value / t : NaN };
    })
    .filter((p) => Number.isFinite(p.value));

  // Activity metrics — chip headline values are always real; 24h volume is real
  // (hourly buckets); longer windows are real where metric_snapshots has ≥2
  // points, else a deterministic sample (the chart tags "SAMPLE").
  const metrics: ActivityMetric[] = [
    { key: "volume", label: "Volume", color: "#f3ff42", value: formatCompactUsd(detail.vol24Usd), series: buildWindows(volS, detail.hourlyVol, 1) },
    { key: "marketCap", label: "Market Cap", color: "#5b9bff", value: detail.mcapUsd > 0 ? formatCompactUsd(detail.mcapUsd) : "—", series: buildWindows(mcapS, null, 2) },
    { key: "trades", label: "Trades", color: "#a78bfa", value: formatInt(detail.trades24h), series: buildWindows(tradesS, null, 3) },
    { key: "avgTrade", label: "Avg Trade", color: "#2bd6a0", value: formatCompactUsd(detail.avgTradeUsd), series: buildWindows(avgS, null, 4) },
    { key: "activeWallets", label: "Active Wallets", color: "#f5c451", value: formatInt(detail.uniqueWallets), series: buildWindows(walletsS, null, 5) },
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
    <>
      <NavBar />
      <div className="mx-auto max-w-[1720px] px-7">
        {/* Desktop: a viewport-height shell. The rail is static (never scrolls);
            the right column is the ONLY scroll area. Mobile: normal page flow. */}
        <div className="grid grid-cols-1 min-[860px]:grid-cols-[280px_1fr] min-[860px]:h-[calc(100vh-65px)] min-[860px]:overflow-hidden">
          <PlatformRail detail={detail} mcapPct={null} />

          <main className="scroll-y min-w-0 pb-24 pt-7 min-[860px]:h-full min-[860px]:min-h-0 min-[860px]:overflow-y-auto min-[860px]:pl-9">
            <IPActivityChart metrics={metrics} />
            {ipEntities.length > 0 && (
              <section className="mb-12 font-sans">
                <DominancePanel title="IP dominance" source={{ entities: ipEntities }} defaultMetric="volume" seed={7} seeAllHref={`/platform/${key}/ips`} />
              </section>
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
          </main>
        </div>
      </div>
    </>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const detail = await getPlatformDetail(key);
  if (!detail) return { title: "Not found · VARIABLE" };
  return {
    title: `${detail.source.name} · VARIABLE`,
    description: `Per-platform analytics for ${detail.source.name} (${detail.chain}) on VARIABLE — volume, IP composition, gacha sales, and recent activity.`,
  };
}
