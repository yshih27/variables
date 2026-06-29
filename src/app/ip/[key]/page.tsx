import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { IPRail } from "@/components/IPRail";
import {
  IPActivityChart,
  type ActivityMetric,
  type MetricWindow,
  type Timeframe,
} from "@/components/IPActivityChart";
import { IPByPlatform, type PlatformRow } from "@/components/IPByPlatform";
import { IPDominance, type DominanceSource } from "@/components/IPDominance";
import { IPTopCards, IPSets } from "@/components/IPTables";
import { getIPDetail } from "@/lib/data/fetchIP";
import { readMarketCap } from "@/lib/data/marketcap";
import { readHolders } from "@/lib/data/holders";
import { readMetricSeries, type SeriesPoint } from "@/lib/data/metricSnapshots";
import { formatCompactUsd, formatInt } from "@/lib/format";
import { gradeColor } from "@/lib/gradeColor";

export const dynamic = "force-dynamic";

const PLATFORM_META: Record<string, { name: string; chain: string; chainColor: string; color: string }> = {
  beezie: { name: "Beezie", chain: "Base", chainColor: "#5fa3ff", color: "#a78bfa" },
  "collector-crypt": { name: "Collector Crypt", chain: "Solana", chainColor: "#14f195", color: "#5b9bff" },
};

const SET_PALETTE = ["#f3ff42", "#5b9bff", "#a78bfa", "#2bd6a0", "#f5c451", "#9aa6ff"];

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

export default async function IPDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const [detail, mcapSnap, holdersSnap, volS, mcapS, walletsS, tradesS, cardsS] = await Promise.all([
    getIPDetail(key),
    readMarketCap(),
    readHolders(),
    readMetricSeries("ip", key, "volume_usd").catch(() => [] as SeriesPoint[]),
    readMetricSeries("ip", key, "mcap_usd").catch(() => [] as SeriesPoint[]),
    readMetricSeries("ip", key, "active_wallets").catch(() => [] as SeriesPoint[]),
    readMetricSeries("ip", key, "trades").catch(() => [] as SeriesPoint[]),
    readMetricSeries("ip", key, "cards_traded").catch(() => [] as SeriesPoint[]),
  ]);
  if (!detail) notFound();

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
    { key: "volume", label: "Volume", color: "#f3ff42", value: formatCompactUsd(detail.vol24Usd), series: buildWindows(volS, detail.hourlyVol, 1) },
    { key: "marketCap", label: "Market Cap", color: "#5b9bff", value: mcapUsd > 0 ? formatCompactUsd(mcapUsd) : "—", series: buildWindows(mcapS, null, 2) },
    { key: "cardsTraded", label: "Cards Traded", color: "#a78bfa", value: formatInt(detail.uniqueCards), series: buildWindows(cardsS, null, 3) },
    { key: "avgTrade", label: "Avg Trade", color: "#2bd6a0", value: formatCompactUsd(detail.avgTradeUsd), series: buildWindows(avgS, null, 4) },
    { key: "activeWallets", label: "Active Wallets", color: "#f5c451", value: formatInt(detail.uniqueWallets), series: buildWindows(walletsS, null, 5) },
  ];

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
    <>
      <NavBar />
      <div className="mx-auto max-w-[1720px] px-7">
        {/* Desktop: a viewport-height shell. The rail is static (never scrolls);
            the right column is the ONLY scroll area. Mobile: normal page flow. */}
        <div className="grid grid-cols-1 min-[860px]:grid-cols-[280px_1fr] min-[860px]:h-[calc(100vh-65px)] min-[860px]:overflow-hidden">
          <IPRail detail={detail} mcapUsd={mcapUsd} mcapPct={null} />

          {/* Right column — the scroll area. */}
          <main className="scroll-y min-w-0 pb-24 pt-7 min-[860px]:h-full min-[860px]:min-h-0 min-[860px]:overflow-y-auto min-[860px]:pl-9">
            <IPActivityChart metrics={metrics} />
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
  const detail = await getIPDetail(key);
  if (!detail) return { title: "Not found · VARIABLE" };
  return {
    title: `${detail.ip.name} · VARIABLE`,
    description: `Per-IP analytics for ${detail.ip.name} across tracked tokenized-collectibles platforms.`,
  };
}
