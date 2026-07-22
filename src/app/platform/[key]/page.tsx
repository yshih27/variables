import { notFound } from "next/navigation";
import { MCAP_BASIS, MCAP_BASIS_LABEL } from "@/lib/data/marketcap";
import { NavBar } from "@/components/NavBar";
import { PlatformOverviewHeader } from "@/components/PlatformOverviewHeader";
import { OverviewMetricColumn, type OverviewMetricRow } from "@/components/OverviewMetricColumn";
import { MetricBarCard } from "@/components/MetricBarCard";
import { IndexStudio } from "@/components/IndexStudio";
import { CompositionChart, type CompositionSeries } from "@/components/CompositionChart";
import { DominancePanel, type DomEntity } from "@/components/IPDominance";
import { IPByPlatform, type PlatformRow } from "@/components/IPByPlatform";
import { PlatformGachaPanel } from "@/components/PlatformGachaPanel";
import { PlatformTopCardsTable, RecentSalesTable } from "@/components/PlatformTables";
import { getPlatformDetail, getPlatformActivitySeries, type PlatformIPRow } from "@/lib/data/fetchPlatform";
import { pctChange, lastNDays, dropIncompleteTail, type SeriesPoint } from "@/lib/data/metricSnapshots";
import { formatCompactUsd } from "@/lib/format";

// ISR: cached HTML, 30-min background revalidate (data changes every ~6h) — R2-B1.
// Dynamic [key] routes generate on-demand (first hit), then serve cached HTML.
export const revalidate = 1800;

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
  const { volume: volS, trades: tradesS, mcap: mcapS, gacha: gachaS, holders: holdersS } = series;

  // ── Zone-1 rail rows ────────────────────────────────────────────────────────
  // Built here, not in OverviewMetricColumn, because delta units are a property
  // of the producer. Both producers used here return PERCENT already:
  //   • detail.vol24Pct        ← history.pctChange       (percent)
  //   • pctChange(series, n)   ← metricSnapshots         (percent)
  // so NOTHING is scaled by 100 on this page. (/ips does scale mcapPct24h,
  // because marketcap.pctChangeOverHours returns a FRACTION. Do not copy that
  // ×100 here — it would render 100× too high.)
  //
  // Honest absence, per platform:
  //   • vol24Pct is null for a platform with no secondary source (Phygitals).
  //   • gacha/trades/mcap/holders have NO delta field on PlatformDetail at all;
  //     they are derived from the spine here, and pctChange returns null rather
  //     than inventing a number when there is < 2 points of history.
  //   • mcap_usd and holders are FORWARD-ONLY (no backfill), so those deltas
  //     stay "—" until two days have accumulated. Courtyard has no mcap at all.
  //
  // ⚠️ TIER MIX: the levels are LIVE (rolling-24h blobs) while these deltas come
  // from the CHART tier (complete calendar days, excludes today). That is the
  // same pairing /ips uses; the "24h"/"7d" suffix is what keeps it honest.
  const railRows: OverviewMetricRow[] = [
    {
      label: "24h Marketplace Vol",
      metric: "marketplace",
      value: detail.vol24Usd,
      unit: "usd",
      deltaPct: detail.vol24Pct,
      window: "24h",
      detail:
        Number.isFinite(detail.vol7Usd) && detail.vol7Usd > 0
          ? [{ label: "7d volume", value: formatCompactUsd(detail.vol7Usd) }]
          : undefined,
    },
    {
      label: "24h Gacha Vol",
      metric: "gacha",
      value: detail.gachaVol24Usd ?? NaN,
      unit: "usd",
      deltaPct: pctChange(gachaS, 1),
      window: "24h",
    },
    {
      label: "Market Cap",
      metric: "marketCap",
      value: detail.mcapUsd,
      unit: "usd",
      deltaPct: pctChange(mcapS, 1),
      window: "24h",
      hero: true,
      // Say WHICH kind of cap this is, right next to it. Phygitals' floor×supply
      // lower bound rendered identically to Collector Crypt's vault appraisal,
      // and the reader had nothing to go on.
      sub: MCAP_BASIS[detail.source.key] ? MCAP_BASIS_LABEL[MCAP_BASIS[detail.source.key]] : undefined,
    },
    {
      label: "Holders",
      metric: "holders",
      value: detail.holders,
      unit: "count",
      deltaPct: pctChange(holdersS, 7),
      window: "7d",
    },
    {
      label: "24h Trades",
      metric: "trades",
      value: detail.trades24h,
      unit: "count",
      deltaPct: pctChange(tradesS, 1),
      window: "24h",
    },
  ];

  // Zone 2 — last 14 complete days per metric. An empty array is an honest
  // "building history" card, never a fabricated flat line.
  const last14 = (s: SeriesPoint[]) => s.slice(-14);

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
            // vol ÷ trades, like every real IP row (fetchPlatform buildIPRows) —
            // NaN → "—" when the bucket is trade-less, not a false $0 average (DQ-2).
            // (The IPDominance "Other" bucket below keeps avgTrade: 0 on purpose —
            // DominancePanel re-derives avg-trade from volume/trades and ignores it.)
            avgTradeUsd:
              sumBy(restIps, (r) => r.trades24h) > 0
                ? sumBy(restIps, (r) => r.vol24Usd) / sumBy(restIps, (r) => r.trades24h)
                : NaN,
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

  // Volume mix — THIS platform's marketplace vs gacha over the last 30 days. A
  // FLOW composition (all three modes legit; 100% share mode is the money view:
  // "97% gacha / 3% marketplace" and how it shifts). Honest absence, house rules:
  // a source with no series (Phygitals has no marketplace/secondary source) is
  // filtered out here, never rendered as a fabricated zero — same guard the
  // /platforms composition uses.
  //
  // Both series are gated to the shared latest SOURCE-COMPLETE day (same `streams`
  // map → same cutoff) so a Dune-lagged partial trailing day — marketplace in,
  // gacha not yet — can't render a fake 100%-marketplace share on the newest bar.
  // A gacha-only platform contributes no marketplace days, so gacha truncates
  // nothing; the .filter below then drops the empty marketplace series.
  const streams = new Map<string, SeriesPoint[]>([["marketplace", volS], ["gacha", gachaS]]);
  const volumeMix: CompositionSeries[] = [
    { key: "marketplace", label: "Marketplace", color: "var(--color-blue)", points: lastNDays(dropIncompleteTail(volS, streams), 30) },
    { key: "gacha", label: "Gacha", color: "var(--color-yellow)", points: lastNDays(dropIncompleteTail(gachaS, streams), 30) },
  ].filter((s) => s.points.some((p) => Number.isFinite(p.value)));

  return (
    <>
      <NavBar />
      <div className="px-8 pt-6 pb-20 font-sans">
        <PlatformOverviewHeader detail={detail} />

        <div className="space-y-3">
          {/* ZONE 1 — platform levels + the Index Studio scoped to this platform. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[264px_minmax(0,1fr)] lg:items-start">
            <OverviewMetricColumn rows={railRows} />
            <IndexStudio scope={{ entity: "platform", key }} />
          </div>

          {/* Volume mix — marketplace vs gacha for THIS platform, below the studio.
              100% share mode is the money view. A gacha-only platform (Phygitals)
              simply has no marketplace series — no fabricated zero. */}
          {volumeMix.length > 0 && (
            <CompositionChart
              title="Volume mix"
              subtitle="Marketplace vs gacha · last 30 days"
              series={volumeMix}
              unit="usd"
              variant="bars"
              flow
            />
          )}

          {/* ZONE 2 — 14d dailies for THIS platform. Volume and trades are flows
              (bars off zero); holders is a stock → line, headline = latest level.
              Coverage is uneven by design and says so: volume/trades are absent
              for Phygitals (no secondary source), holders is forward-only, and
              Courtyard has no mcap at all. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricBarCard
              label="Volume"
              metric="marketplace"
              data={last14(volS)}
              unit="usd"
              emptyDetail="no secondary-sales source yet"
            />
            <MetricBarCard
              label="Trades"
              metric="trades"
              data={last14(tradesS)}
              unit="count"
              emptyDetail="no secondary-sales source yet"
            />
            <MetricBarCard
              label="Holders"
              metric="holders"
              data={last14(holdersS)}
              unit="count"
              variant="line"
              emptyDetail="forward-only series — no backfill"
            />
          </div>

          {/* ZONE 3 — composition + activity, unchanged. */}
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
  if (!detail) return { title: "Not found · VARIBLE" };
  return {
    title: `${detail.source.name} · VARIBLE`,
    description: `Per-platform analytics for ${detail.source.name} (${detail.chain}) on VARIBLE — volume, IP composition, gacha sales, and recent activity.`,
  };
}
