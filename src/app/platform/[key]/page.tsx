import { notFound } from "next/navigation";
import { MCAP_BASIS, MCAP_BASIS_LABEL } from "@/lib/data/marketcap";
import { NavBar } from "@/components/NavBar";
import { PlatformOverviewHeader } from "@/components/PlatformOverviewHeader";
import { type OverviewMetricRow } from "@/components/OverviewMetricColumn";
import { StatCard, StatCardRow } from "@/components/StatCard";
import { MetricBarCard } from "@/components/MetricBarCard";
import { IndexStudio } from "@/components/IndexStudio";
import { readStudioSeed } from "@/lib/studio/seed";
import { CompositionChart, type CompositionSeries } from "@/components/CompositionChart";
import { IPByPlatform, type PlatformRow } from "@/components/IPByPlatform";
import { PlatformTopCardsTable, RecentSalesTable } from "@/components/PlatformTables";
import { PlatformEconomics, type EconomicsKpis } from "@/components/PlatformEconomics";
import { outboundDisclosureFor } from "@/lib/metrics/outboundDisclosure";
import { PlatformPartners, type PartnerAttribution } from "@/components/PlatformPartners";
import { PlatformPlayers } from "@/components/PlatformPlayers";
import { monthlyPullCoverage, overallPullCoverage } from "@/lib/metrics/pullCoverage";
import { getPlatformDetail, getPlatformActivitySeries, type PlatformIPRow } from "@/lib/data/fetchPlatform";
import {
  pctChange,
  lastNDays,
  dropIncompleteTail,
  latestCompleteDay,
  sumLastCompleteDays,
  type SeriesPoint,
} from "@/lib/data/metricSnapshots";
import { readPlayerAnalytics } from "@/lib/data/playerAnalytics";
import { formatCompactUsd, formatCompactNumber } from "@/lib/format";

// ISR: cached HTML, 30-min background revalidate (data changes every ~6h) — R2-B1.
// Dynamic [key] routes generate on-demand (first hit), then serve cached HTML.
export const revalidate = 1800;

/** Same formatter OverviewMetricColumn uses — a NaN value renders "—" (not
 *  tracked), never a fabricated 0. */
/** "7d $17.9M · avg $2.56M/day", or undefined when there is no 7d gacha figure to
 *  state. Mirrors the removed PlatformGachaPanel's `g7` / `g7 / 7` exactly. */
function gacha7dSub(gachaVol7Usd: number | null): string | undefined {
  if (gachaVol7Usd == null || !Number.isFinite(gachaVol7Usd) || gachaVol7Usd <= 0) return undefined;
  return `7d ${formatCompactUsd(gachaVol7Usd)} · avg ${formatCompactUsd(gachaVol7Usd / 7)}/day`;
}

const kpiValue = (n: number, unit: "usd" | "count") =>
  !Number.isFinite(n) ? "—" : unit === "usd" ? formatCompactUsd(n) : formatCompactNumber(n);

export default async function PlatformDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  // Both cached (unstable_cache) — one memoized call each instead of 5 uncached
  // round-trips per request (R2-B1).
  const [detail, series, playersSnap, studioSeed] = await Promise.all([
    getPlatformDetail(key),
    getPlatformActivitySeries(key),
    // Snapshot read; degrades to null (readSnapshot never throws), so a missing
    // warmer run costs the page nothing and the panel simply doesn't render.
    readPlayerAnalytics(),
    // The studio's precomputed default view for THIS platform — embedded so the
    // chart paints with no client fetch. Null degrades to the old API path.
    readStudioSeed({ entity: "platform", key }),
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
      // The 7d pull volume and its daily average, which left this page with the
      // Gacha panel (round 3, item 9). Same derivation the panel used — the SAME
      // `detail.gachaVol7Usd` and the same ÷7 — so the figures are identical to
      // what it showed rather than a second, subtly different calculation.
      // Honest absence: a platform with no gacha 7d figure gets NO line, never a
      // "$0 · avg $0/day", which would assert we measured a week of nothing.
      sub: gacha7dSub(detail.gachaVol7Usd),
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

  // Zone 2 — last 14 CALENDAR days per metric (lastNDays, not slice(-14): a sparse
  // series' 14 newest POINTS can span 16+ days, disagreeing with the "14D" badge —
  // the same fix /platforms uses). Empty = an honest "building history" card.
  const last14 = (s: SeriesPoint[]) => lastNDays(s, 14);

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
      // Real IP identity — the table renders the catalogue icon (logo/emoji)
      // rather than a 2-letter colour chip wherever we actually have one.
      short: ip.short,
      logo: ip.logo,
      emoji: ip.emoji,
      iconBlendMode: ip.iconBlendMode,
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

  // ── Platform economics (gacha FLOWS) ───────────────────────────────────────
  // Spend (gacha_volume_usd) and buyback payouts (PlatformDetail.buybackDaily)
  // are two independently-fed series, so they get ONE shared cutoff: the newest
  // day BOTH wrote. Without it a Dune-lagged trailing day draws a tall spend bar
  // beside a missing payout bar and reads as a windfall (INV-8, same gate the
  // volume mix above uses).
  //
  // ⚠️ No net figure is derived here and none is passed down. detail.netGachaRevenue
  // exists on the v8 contract and is deliberately left unread: payouts currently
  // exceed spend on both covered platforms, so spend − payouts is not publishable
  // until the filter-symmetry reconciliation lands.
  // TWO outbound series now, and they are NOT interchangeable:
  //   buybackS — `buyback_payout_usd`, R3-COUNTED since the switchover. Feeds the
  //              net line and the buyback rate.
  //   grossS   — `outflow_gross_usd`, every outflow bar the internal list. Feeds
  //              the "Outbound … (gross)" row and the blue bars.
  // Before the switchover `outflow_gross_usd` does not exist AND
  // `buyback_payout_usd` still holds the gross definition — so falling back to it
  // is not a fudge, it is the same quantity under its old name. That fallback is
  // what keeps the outbound bars drawn through the transition; the net stays held
  // regardless, because fetchPlatform gates that on the marker series itself.
  const buybackS = detail.buybackDaily;
  const grossS = detail.outflowGrossDaily.length > 0 ? detail.outflowGrossDaily : buybackS;
  const econStreams = new Map<string, SeriesPoint[]>([
    ["spend", gachaS],
    ["outbound", grossS],
    ["payout", buybackS],
  ]);
  const econCut = latestCompleteDay(econStreams);
  const econGate = (s: SeriesPoint[]) => (econCut ? s.filter((p) => p.ts <= econCut) : s);
  const spendGated = econGate(gachaS);
  const grossGated = econGate(grossS);
  const payoutGated = econGate(buybackS);
  // Windows summed with the canonical helper — NaN when a window isn't fully
  // covered, which the panel renders as "—" rather than a flattering $0.
  const econKpis: EconomicsKpis = {
    spend24h: sumLastCompleteDays(spendGated, 1),
    spend7d: sumLastCompleteDays(spendGated, 7),
    spend30d: sumLastCompleteDays(spendGated, 30),
    buyback24h: sumLastCompleteDays(grossGated, 1),
    buyback7d: sumLastCompleteDays(grossGated, 7),
    buyback30d: sumLastCompleteDays(grossGated, 30),
  };
  // Daily net for the chart line — spend minus R3 payouts, joined on the day and
  // emitted ONLY for days both sides reported. A day only one side covers is left
  // out entirely so the line breaks there rather than asserting a margin.
  const payoutByTs = new Map(payoutGated.map((p) => [p.ts, p.value]));
  const netDaily: SeriesPoint[] = detail.netGachaRevenue
    ? spendGated.flatMap((p) => {
        const payout = payoutByTs.get(p.ts);
        return payout == null || !Number.isFinite(p.value) || !Number.isFinite(payout)
          ? []
          : [{ ts: p.ts, value: p.value - payout }];
      })
    : [];
  // Only where the buyback wallet is known on-chain (CC + Phygitals today). An
  // empty series means unsourced, not zero — every other platform gets nothing.
  const showEconomics = grossGated.length > 0;
  // Whether that outflow may be PUBLISHED, which is a separate question from
  // whether it is sourced. Held for Phygitals: its exclusion list misses the
  // dominant non-player counterparties, so the flow is real but the label would
  // not be. Spend is a different query and still renders. Nothing above changes —
  // the KPIs are still computed, the suppressed ones simply aren't passed on.
  const outboundDisclosure = outboundDisclosureFor(key);

  // Player analytics for THIS platform. A platform the snapshot excluded (no
  // wallet-attributed rows) simply isn't in `platforms`, so this is null and the
  // panel renders nothing — the exclusion is surfaced in the snapshot itself.
  const player = playersSnap?.platforms.find((p) => p.platform === key) ?? null;
  const playersData = player && playersSnap ? { player, generatedAt: playersSnap.generatedAt } : null;

  // ── Pull-capture completeness ───────────────────────────────────────────────
  // Player analytics comes from `gacha_pulls`; `gachaS` is the SAME flow measured
  // independently by the spine. Their ratio per month is how complete our capture
  // is, and it is nowhere near 100% for the early months — the capture switched on
  // partway and ramped. Measured 2026-08-25: CC 50.5% / 74.6% / 81.4% for Jun/Jul/
  // Aug, Phygitals 11.3% / 35.3% / 20.0%. Withhold the under-covered months rather
  // than plot a capture ramp as if it were player behaviour (see pullCoverage.ts).
  const monthCoverage = player ? monthlyPullCoverage(player.monthly, gachaS) : undefined;
  const overallCoverage = player ? overallPullCoverage(player.monthly, gachaS) : null;

  // Partner attribution, read FORWARD-COMPATIBLY. `memo_slug` capture is
  // forward-only (PR #73) and the snapshot carries no partner rollup yet, so
  // this is undefined today and the panel renders nothing. The cast is the whole
  // point: the day the backend attaches `partners`, the board lights up with no
  // frontend change. The shape it must supply is `PartnerAttribution` — the FULL
  // rollup plus its own min-volume floor and the attributed %; the top-3 cut is
  // applied at display time in the component, never here.
  const partners =
    (playersSnap as { partners?: Record<string, PartnerAttribution> } | null)?.partners?.[key] ?? null;

  return (
    <>
      <NavBar />
      <div className="px-8 pt-6 pb-20 font-sans">
        <PlatformOverviewHeader detail={detail} />

        <div className="space-y-3">
          {/* ZONE 1 — platform levels + the Index Studio scoped to this platform. */}
          {/* KPIs as dedicated stat cards, full width, with the studio beneath at
              full width too. The 264px rail put five headline figures in a column
              narrower than the numbers deserve; at card scale they read first and
              the chart gets the whole span. Every row's window, basis and delta
              survives — `sub`/`stat` carry them under the label. */}
          <StatCardRow cols={5}>
            {railRows.map((r) => (
              <StatCard
                key={r.label}
                label={r.label}
                metric={r.metric}
                value={r.valueText ?? kpiValue(r.value, r.unit)}
                // Uniform scale across a 5-up row: a 64px value does not fit a
                // fifth of the width, and the hero is already marked by the lime
                // accent — two signals for one row is one too many anyway.
                size="lg"
                accent={r.hero}
                href={r.valueHref}
                deltaPct={r.deltaPct}
                deltaLabel={r.window}
                sub={[r.sub, r.stat].filter(Boolean).join(" · ") || undefined}
              />
            ))}
          </StatCardRow>
          {/* Studio ‖ the three 14d cards. Different questions, so they may share a
              row (terminal-ux-study §3): the studio is an INTERACTIVE series you
              compose and brush, the cards are an AT-A-GLANCE 14-day read of three
              fixed metrics. Each card keeps its own header, window badge and empty
              -state reason. Stacks below lg, where a 300px column would crush both. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
            <IndexStudio seed={studioSeed} scope={{ entity: "platform", key }} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1">
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
          </div>

          {/* "Where does the money route" — two small panels, side by side from lg.
              Volume mix answers by CHANNEL (packs vs resale vs direct), Top partners
              by STOREFRONT: different questions, so they may share a row (terminal-
              ux-study §3). Partners had a full-width band to itself for a two-column
              table. The grid only forms when BOTH render — `partners == null` is the
              honest absence PlatformPartners returns null for, and a lone half-width
              chart beside a gap reads as something failed to load. */}
          {volumeMix.length > 0 || partners ? (
            <div
              className={`grid grid-cols-1 gap-3 ${volumeMix.length > 0 && partners ? "lg:grid-cols-2 lg:items-start" : ""}`}
            >
              {volumeMix.length > 0 && (
                <CompositionChart
                  title="Volume mix"
                  readMe="where this platform's money flows — packs vs resale vs direct. 100% share mode answers: what is this platform's business?"
                  subtitle="Marketplace vs gacha · last 30 days"
                  series={volumeMix}
                  unit="usd"
                  variant="bars"
                  flow
                />
              )}
              <PlatformPartners partners={partners} platformKey={key} />
            </div>
          ) : null}

          {/* Platform economics — gacha flows (spend vs gross wallet outflow) plus
              net where it is publishable. `detail.netGachaRevenue` is null unless
              the platform is eligible AND its payout days are on the R3 basis, so
              the panel needs no policy of its own: null means draw no net. The
              outbound leg is separately suppressed where its counterparty split is
              known-wrong (Phygitals) — see outboundDisclosureFor. */}
          {showEconomics && (
            <PlatformEconomics
              spendDaily={lastNDays(spendGated, 30)}
              buybackDaily={lastNDays(grossGated, 30)}
              netDaily={lastNDays(netDaily, 30)}
              kpis={econKpis}
              buybackRatePct30d={detail.buybackRatePct30d}
              outboundDisclosure={outboundDisclosure}
              net={detail.netGachaRevenue}
              r3VerifiedPct30d={detail.r3VerifiedPct30d}
            />
          )}


          {/* Player analytics — only for platforms the snapshot covers. */}
          <PlatformPlayers
            data={playersData}
            monthCoverage={monthCoverage}
            overallCoverage={overallCoverage}
          />

          {/* ⚠️ "IP dominance" REMOVED from this page (one question per zone,
              terminal-ux-study §1): it asked "what share does each IP hold here",
              which is exactly what the By IP donut + table below answer, with the
              per-IP numbers attached. The component stays — other pages use it. */}
      {ipRows.length > 0 && (
        <IPByPlatform
          rows={ipRows}
          title="By IP"
          readMe="this platform's 24h activity by IP"
          entityHeader="IP"
          donutTitle="IP share"
          showChain={false}
          hrefBase="/ip/"
        />
      )}
      {/* ⚠️ "Gacha sales" REMOVED from this page (one question per zone): its 24h
          pull volume duplicates the KPI row's "24h Gacha Vol" and its revenue-mix
          split duplicates Volume mix above. Dropping it also takes the 7d pull
          volume and the 7d daily average off this page — they exist nowhere else
          here, and are called out in the commit rather than silently lost. The
          component stays for other surfaces. */}
      {/* ⚠️ DELIBERATELY NOT PAIRED. Top Cards and Recent Sales do answer different
          questions (ranked vs chronological), but both tables carry `min-w-[900px]`
          and side-by-side they do not fit below roughly 1900px: measured at 1280 the
          columns are 602px with 389px and 300px of internal horizontal scroll, while
          stacked at 1150 both overflow zero. Tables are the density anchor
          (terminal-ux-study §4) — crushing one to satisfy a layout pattern inverts
          the point of the doctrine, and pairing is not a goal in itself. Volume mix ‖
          Top partners above is this page's consolidation win. Both stay full-width. */}
      <PlatformTopCardsTable rows={detail.topCards} maxRows={10} seeAllHref={`/platform/${key}/cards`} />
      <RecentSalesTable rows={detail.recentSales} maxRows={12} salesTotal={detail.salesTotal} seeAllHref={`/platform/${key}/sales`} />
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
