import { notFound } from "next/navigation";
import { IPRail } from "@/components/IPRail";
import { SliceView } from "@/components/SliceView";
import { CategoryTrendChart } from "@/components/CategoryTrendChart";
import {
  type ActivityMetric,
  type MetricWindow,
  type Timeframe,
} from "@/components/IPActivityChart";
import { IPByPlatform, type PlatformRow } from "@/components/IPByPlatform";
import { IPDominance, type DominanceSource } from "@/components/IPDominance";
import { IPTopCards, IPSets } from "@/components/IPTables";
import { getIPDetail, getIPActivitySeries } from "@/lib/data/fetchIP";
import { readMarketCap } from "@/lib/data/marketcap";
import { readHolders } from "@/lib/data/holders";
import { type SeriesPoint } from "@/lib/data/metricSnapshots";
import { formatCompactUsd, formatInt } from "@/lib/format";
import { gradeColor } from "@/lib/gradeColor";
import { buildSeriesTrend } from "@/lib/category/rollup";
import { buildPriceComparison, PRICE_RANGES } from "@/lib/data/perfCompare";

// ISR: cached HTML, 30-min background revalidate (data changes every ~6h) — R2-B1.
// Dynamic [key] routes generate on-demand (first hit), then serve cached HTML.
export const revalidate = 1800;

const PLATFORM_META: Record<string, { name: string; chain: string; chainColor: string; color: string }> = {
  beezie: { name: "Beezie", chain: "Base", chainColor: "#5fa3ff", color: "#a78bfa" },
  "collector-crypt": { name: "Collector Crypt", chain: "Solana", chainColor: "#14f195", color: "#5b9bff" },
};

const SET_PALETTE = ["#f3ff42", "#5b9bff", "#a78bfa", "#2bd6a0", "#f5c451", "#9aa6ff"];

/** Per-timeframe windows from a real daily series (metric_snapshots) + optional
 *  real 24h-hourly series. A window with <2 points has no history yet — the chart
 *  disables that metric for the window. We never fabricate a series. */
function buildWindows(
  daily: SeriesPoint[],
  hourly: number[] | null,
): Record<Timeframe, MetricWindow> {
  const vals = daily.map((p) => p.value);
  const ts = daily.map((p) => p.ts);
  // 24H hourly buckets carry no stored timestamps — synthesize trailing-hour
  // stamps from request time (deterministic server-side → no hydration drift).
  const now = Date.now();
  const hourlyTs = (n: number) =>
    Array.from({ length: n }, (_, i) => new Date(now - (n - 1 - i) * 3_600_000).toISOString());
  // An all-zero hourly (no sales inside the data's own last-24h) is "no intraday
  // data", not a flat $0 line — disable the 24H window rather than draw zeros (QA-2).
  const hourlyOk = !!hourly && hourly.length >= 2 && hourly.some((v) => v > 0);
  return {
    "24H": hourlyOk ? { points: hourly!, ts: hourlyTs(hourly!.length) } : { points: [] },
    "7D": { points: vals.slice(-7), ts: ts.slice(-7) },
    "30D": { points: vals.slice(-30), ts: ts.slice(-30) },
    ALL: { points: vals, ts },
  };
}

export default async function IPDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  // getIPDetail + getIPActivitySeries are both cached (unstable_cache) — one memoized
  // call each instead of 6 uncached readMetricSeries round-trips per request (R2-B1).
  const [detail, mcapSnap, holdersSnap, series] = await Promise.all([
    getIPDetail(key),
    readMarketCap(),
    readHolders(),
    getIPActivitySeries(key),
  ]);
  if (!detail) notFound();
  const { volume: volS, mcap: mcapS, wallets: walletsS, trades: tradesS, cards: cardsS, marketMcap: marketMcapS } = series;

  // Real per-IP market cap from the marketcap snapshot (fetchIP doesn't carry it).
  const mcapUsd = mcapSnap?.byIp?.[key]?.mcapUsd ?? 0;

  // By-Platform rows: vol / trades / avg-trade real (byPlatform); holders real
  // (holders snapshot); per-platform card counts + market cap real (marketcap
  // byPlatform breakdown). null → "—" for platforms we don't value (Courtyard/Phygitals).
  const perPlatHolders = holdersSnap?.byIp?.[key]?.perPlatform ?? {};
  const platformRows: PlatformRow[] = detail.byPlatform.map((p) => {
    const meta =
      PLATFORM_META[p.platform] ??
      { name: p.platform, chain: "—", chainColor: "#707070", color: "#707070" };
    const comp = mcapSnap?.byPlatform?.[p.platform]?.byIp?.[key];
    return {
      key: p.platform,
      name: meta.name,
      chain: meta.chain,
      chainColor: meta.chainColor,
      color: meta.color,
      cards: comp?.cards ?? null,
      vol24Usd: p.vol24Usd,
      mcapUsd: comp?.mcapUsd ?? null,
      trades24h: p.trades24h,
      avgTradeUsd: p.trades24h > 0 ? p.vol24Usd / p.trades24h : 0,
      holders: perPlatHolders[p.platform] ?? null,
    };
  });

  // Activity metrics — real time-series from metric_snapshots where it has data;
  // chip headline values are always real. Avg-trade daily = volume / trades.
  const tradesByTs = new Map(tradesS.map((p) => [p.ts, p.value]));
  const avgS: SeriesPoint[] = volS
    .map((p) => {
      const t = tradesByTs.get(p.ts) ?? 0;
      return { ts: p.ts, value: t > 0 ? p.value / t : NaN };
    })
    .filter((p) => Number.isFinite(p.value));

  const metrics: ActivityMetric[] = [
    { key: "volume", label: "Volume", color: "#f3ff42", value: formatCompactUsd(detail.vol24Usd), series: buildWindows(volS, detail.hourlyVol) },
    { key: "marketCap", label: "Market Cap", color: "#5b9bff", value: mcapUsd > 0 ? formatCompactUsd(mcapUsd) : "—", series: buildWindows(mcapS, null) },
    { key: "cardsTraded", label: "Cards Traded", color: "#a78bfa", value: formatInt(detail.uniqueCards), series: buildWindows(cardsS, null) },
    { key: "avgTrade", label: "Avg Trade", color: "#2bd6a0", value: formatCompactUsd(detail.avgTradeUsd), series: buildWindows(avgS, null) },
    { key: "activeWallets", label: "Active Wallets", color: "#f5c451", value: formatInt(detail.uniqueWallets), series: buildWindows(walletsS, null) },
  ];

  // IP vs market — prefer the constant-quality PRICE index vs BTC/ETH/S&P/NASDAQ
  // (QA-6, apples-to-apples). Fall back to the mcap "market size" index (no
  // benchmarks) for IPs that don't yet have a price series.
  const priceVsMarket = await buildPriceComparison([
    { entity: "ip", key, label: detail.ip.name, color: "#f3ff42" },
    { entity: "market", key: "total", label: "Market", color: "#8b8b94" },
  ]);
  const ipHasPrice = priceVsMarket.datasets.some((d) => d.group === detail.ip.name);
  const mcapVsMarket = buildSeriesTrend(
    [
      { group: detail.ip.name, color: "#f3ff42", series: mcapS },
      { group: "Market", color: "#8b8b94", series: marketMcapS },
    ],
    "hold",
  );
  const vsMarket = ipHasPrice ? priceVsMarket : mcapVsMarket;

  // Set / Grade dominance entities — current shares are real for the chosen metric.
  const topSets = detail.sets.slice(0, 5);
  const restSets = detail.sets.slice(5);
  const setSource: DominanceSource = {
    entities: [
      ...topSets.map((s, i) => ({
        name: s.name,
        color: SET_PALETTE[i % SET_PALETTE.length],
        values: { volume: s.vol24Usd, cards: s.cards, trades: s.trades, avgTrade: s.avgTradeUsd },
      })),
      ...(restSets.length
        ? [
            {
              name: "Other",
              color: "#52525b",
              values: {
                volume: restSets.reduce((a, s) => a + s.vol24Usd, 0),
                cards: restSets.reduce((a, s) => a + s.cards, 0),
                trades: restSets.reduce((a, s) => a + s.trades, 0),
                avgTrade: restSets.length
                  ? restSets.reduce((a, s) => a + s.avgTradeUsd, 0) / restSets.length
                  : 0,
              },
            },
          ]
        : []),
    ],
  };
  const gradeSource: DominanceSource = {
    entities: detail.grades.slice(0, 6).map((g) => ({
      name: g.label,
      color: gradeColor(g.grader, g.label),
      values: { volume: g.vol24Usd, cards: g.cards, trades: g.trades, avgTrade: g.avgTradeUsd },
    })),
  };

  return (
    <SliceView
      slice={{
        rail: <IPRail detail={detail} mcapUsd={mcapUsd} mcapPct={null} />,
        activity: metrics,
      }}
    >
      {vsMarket.datasets.length >= 2 && (
        <div className="mb-12">
          <CategoryTrendChart
            views={[{ key: "cmp", label: "Market cap", data: vsMarket }]}
            title={`${detail.ip.name} vs market`}
            defaultMode="rebased"
            allowRebase={false}
            basis={ipHasPrice ? "price" : "size"}
            ranges={ipHasPrice ? PRICE_RANGES : undefined}
            defaultRange={ipHasPrice ? "90D" : "30D"}
          />
        </div>
      )}
      {(setSource.entities.length > 0 || gradeSource.entities.length > 0) && (
        <IPDominance
          sets={setSource}
          grades={gradeSource}
          setsSeeAllHref={`/ip/${key}/sets`}
          gradesSeeAllHref={`/ip/${key}/grades`}
        />
      )}
      {platformRows.length > 0 && <IPByPlatform rows={platformRows} hrefBase="/platform/" />}
      <IPTopCards rows={detail.topCards.slice(0, 10)} seeAllHref={`/ip/${key}/cards`} total={detail.topCards.length} />
      <IPSets rows={detail.sets.slice(0, 10)} seeAllHref={`/ip/${key}/sets`} total={detail.sets.length} />
    </SliceView>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const detail = await getIPDetail(key);
  if (!detail) return { title: "Not found · VARIABLE" };
  return {
    title: `${detail.ip.name} · VARIABLE`,
    description: `Per-IP analytics for ${detail.ip.name} across tracked tokenized-collectibles platforms.`,
  };
}
