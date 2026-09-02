import { unstable_cache } from "next/cache";
import { NavBar } from "@/components/NavBar";
import { type OverviewMetricRow } from "@/components/OverviewMetricColumn";
import { MetricBarCard } from "@/components/MetricBarCard";
import { PlatformStatBar } from "@/components/PlatformStatBar";
import { PlatformTable } from "@/components/PlatformTable";
import { SectionShell } from "@/components/Section";
import { StatCard, StatCardRow } from "@/components/StatCard";
import { VolumeBar } from "@/components/VolumeBar";
import { fetchHomepage } from "@/lib/data/fetchHomepage";
import { bulkDayOverDayPctComplete, dropIncompleteTail, DELTA_MIN_BASE_USD, lastNDays, type SeriesPoint } from "@/lib/data/metricSnapshots";
import { totalActivity24, sharePct24, concentrationHHI24 } from "@/lib/platform/share";
import { getPlatformSeries, totalDaily, platformVolumeBands } from "@/lib/data/platformSeries";
import { StackedAreaChart } from "@/components/StackedAreaChart";
import { formatCompactUsd, formatCompactNumber } from "@/lib/format";

/** HHI concentration bands — matches PlatformStatBar's cutoffs (0.25/0.4) so the
 *  card detail and the ribbon can't disagree on whether the market is "High". */
function hhiLabel(hhi: number): string {
  if (hhi >= 0.4) return "High";
  if (hhi >= 0.25) return "Moderate";
  return "Low";
}

/** Show at most this many cards; the rest live in the full table below. */
const MAX_CARDS = 4;

/** Same formatter OverviewMetricColumn uses — a NaN value renders "—" (not
 *  tracked), never a fabricated 0. */
const kpiValue = (n: number, unit: "usd" | "count") =>
  !Number.isFinite(n) ? "—" : unit === "usd" ? formatCompactUsd(n) : formatCompactNumber(n);

const getData = unstable_cache(async () => fetchHomepage(), ["platforms-fulllist:v6"], {
  revalidate: 3600,
  tags: ["homepage"],
});

/** Per-entity daily spine series (keyed by metric) for the whole platform family.
 *  v2 (R5-1): v1 cached an empty `mcap_usd` map from before the spine carried
 *  per-platform market cap. */

// ISR: cached HTML, 30-min background revalidate (data changes every ~6h) — R2-B1.
// All reads are unstable_cache-backed; no cookies/headers/searchParams here.
export const revalidate = 1800;

export const metadata = {
  title: "Platforms Overview · VARIBLE",
  description:
    "Where the trading happens — tokenized-collectible platforms compared on 24h volume, the marketplace/gacha split, and market cap.",
};

export default async function AllPlatformsPage() {
  const [data, mktSeries, gachaSeries] = await Promise.all([
    getData(),
    getPlatformSeries("volume_usd"),
    getPlatformSeries("gacha_volume_usd"),
  ]);

  // Last 14 CALENDAR days, not last 14 POINTS: a sparse series' 14 newest points
  // can span 16+ days, which made the "14D" card's range label read "Jul 1 – Jul
  // 16" while the plot (calendar-day slots) only drew 14. Slice by day so the
  // label and the plot agree.
  const last14 = (s: SeriesPoint[]) => lastNDays(s, 14);

  // Rank by TOTAL 24h activity — the same order, and the same Σ, that
  // PlatformTable sorts and divides by, so the leaderboard, the ribbon's
  // DOMINANCE and the table's Share column can't disagree inside one fold.
  const total24 = totalActivity24(data.platforms);
  const ranked = [...data.platforms].sort(
    (a, b) => (b.total24Usd > 0 ? b.total24Usd : 0) - (a.total24Usd > 0 ? a.total24Usd : 0),
  );

  // Marketplace/gacha decomposition, Σ'd across platforms. `|| 0` / `?? 0` are
  // load-bearing: Phygitals' marketplace vol is NaN (no secondary source) and one
  // NaN poisons the Σ.
  const vol24 = data.platforms.reduce(
    (a, p) => ({
      marketplace: a.marketplace + (p.vol24Usd || 0),
      gacha: a.gacha + (p.gachaVol24Usd ?? 0),
      primary: a.primary + (p.primaryUsd ?? 0),
    }),
    { marketplace: 0, gacha: 0, primary: 0 },
  );
  // Full 24h split for the segmented VolumeBar — same shape and math as the
  // homepage hero: marketplace resale + gacha pulls + direct sales (primary −
  // gacha) = total24 (= Σ total24Usd = Σ(marketplace + primary)), so the segments
  // fill the bar exactly. Direct sales drops out when all primary is gacha
  // (Courtyard's tokenization is classified as gacha), leaving a clean
  // marketplace/gacha bar.
  const volBreakdown = {
    marketplace: vol24.marketplace,
    gacha: vol24.gacha,
    otherPrimary: Math.max(0, vol24.primary - vol24.gacha),
    total: total24,
  };
  // The total's 24h Δ over SOURCE-COMPLETE days only. Keying the bulk by
  // (platform, stream) means a Dune-lagged gacha day (CC/Phygitals gacha not yet in
  // while their marketplace + Courtyard/Beezie gacha are) is skipped, not compared to
  // a full prior day — which printed the fake "total −79.5%". Marketplace streams are
  // complete daily, so the honest total tracks their move.
  const totalBulk = new Map<string, SeriesPoint[]>();
  for (const [k, s] of Object.entries(mktSeries)) totalBulk.set(`${k}:mkt`, s);
  for (const [k, s] of Object.entries(gachaSeries)) totalBulk.set(`${k}:gacha`, s);
  const total24Pct = bulkDayOverDayPctComplete(totalBulk, DELTA_MIN_BASE_USD);

  const top = ranked[0];
  const topShare = top ? sharePct24(top, total24) : null;
  const hhi = concentrationHHI24(data.platforms, total24);
  const chains = new Set(data.platforms.map((p) => p.chain)).size;

  // ── Zone 1: SUMMARY KPIs ────────────────────────────────────────────────────
  // Fixed five cards that scale O(1), not one-per-platform: the market's shape
  // (total, its marketplace/gacha split, who leads, how concentrated) reads at a
  // glance and doesn't grow a card every time a platform is added — the full
  // per-platform leaderboard is the table below.
  //
  // ⚠️ hero.vol24Pct / gachaVol24Pct are ALREADY PERCENT (dayOverDayPct), and
  // pctChange (metricSnapshots) also returns percent — nothing here is ×100.
  // /ips scales hero.mcapPct24h because THAT producer returns a fraction; do not
  // copy that across.
  //
  // ⚠️ Top Platform's share and the Concentration HHI both come from
  // totalActivity24 / sharePct24 / concentrationHHI24 — the SAME functions
  // PlatformStatBar (the ribbon) uses — so the cards and ribbon can't disagree.
  const rows: OverviewMetricRow[] = [
    {
      label: "Total 24h Volume",
      metric: "total24h",
      value: total24,
      unit: "usd",
      deltaPct: total24Pct,
      window: "24h",
      hero: true,
    },
    {
      label: "24h Marketplace Vol",
      metric: "marketplace",
      value: vol24.marketplace,
      unit: "usd",
      deltaPct: data.hero.vol24Pct,
      window: "24h",
    },
    {
      label: "24h Gacha Vol",
      metric: "gacha",
      value: vol24.gacha,
      unit: "usd",
      deltaPct: data.hero.gachaVol24Pct,
      window: "24h",
    },
    {
      // An ENTITY, not a measurement → valueText + stat. `stat` (not deltaPct:
      // null) because a leader has no %Δ to be "missing". The NAME links to the
      // platform; the "Top Platform" label doesn't name the destination.
      label: "Top Platform",
      metric: "share",
      value: NaN,
      unit: "usd",
      deltaPct: null,
      valueText: top?.name ?? "—",
      valueHref: top ? `/platform/${top.key}` : undefined,
      stat: topShare != null ? `${topShare.toFixed(1)}% of 24h vol` : undefined,
    },
    {
      label: "Platforms Tracked",
      value: data.platforms.length,
      unit: "count",
      deltaPct: null,
      stat: `across ${chains} chain${chains === 1 ? "" : "s"}`,
      detail:
        hhi != null
          ? [{ label: "Concentration", value: `HHI ${hhi.toFixed(2)} · ${hhiLabel(hhi)}` }]
          : undefined,
    },
  ];

  // ── Zone 2: top-N 14d cards (U5) ────────────────────────────────────────────
  // The top MAX_CARDS platforms by 24h vol, each showing its own marketplace +
  // gacha daily total. The rest are one click away in the table, flagged by the
  // "+N more" affordance rather than growing an unbounded card grid.
  const cardPlatforms = ranked.slice(0, MAX_CARDS);
  const moreInTable = ranked.length - cardPlatforms.length;
  const cards = cardPlatforms.map((p) => {
    const mkt = mktSeries[p.key];
    const gacha = gachaSeries[p.key];
    // "Gacha only" is read off the DATA, not hardcoded to Phygitals: no
    // marketplace series means we have no secondary source for this platform.
    const gachaOnly = !(mkt?.length ?? 0) && (gacha?.length ?? 0) > 0;
    // Drop the trailing day if this platform wrote only SOME of its streams (e.g. CC
    // marketplace in, gacha Dune-lagged) — else the last bar craters to a fake cliff.
    const streams = new Map<string, SeriesPoint[]>([["mkt", mkt ?? []], ["gacha", gacha ?? []]]);
    return {
      key: p.key,
      name: p.name,
      data: last14(dropIncompleteTail(totalDaily(mkt, gacha), streams)),
      note: gachaOnly ? "gacha only" : undefined,
    };
  });

  // The hero — per-platform TOTAL volume (marketplace + gacha), in leaderboard
  // order (biggest at the bottom of the stack). The same totalDaily the 14d cards
  // use, so a day here reconciles with the card below it. This is the page's ONLY
  // volume chart (one question per zone): the share and cumulative reads live in
  // the chart's own mode switcher, and any window in the arc is one brush away —
  // never a second stacked chart.
  const HERO_DAYS = 120;
  const volumeHero = platformVolumeBands(ranked, mktSeries, gachaSeries, HERO_DAYS);

  return (
    <>
      <NavBar />
      <div className="px-8 pt-6 pb-20 font-sans">
        <h1 className="mb-3 text-[20px] font-bold leading-none tracking-[-0.01em]">
          Platforms Overview
        </h1>

        <div className="space-y-3">
          {/* ZONE 1 — the market's headline KPIs as dedicated stat cards, full
              width (the /platform/[key] treatment): with the hero canvas holding
              the whole chart question, the 264px rail-beside-a-studio column had
              nothing to sit beside, and at card scale the numbers read first.
              Every row's window, basis and delta survives — `sub`/`stat`/`detail`
              carry them under the label. */}
          <StatCardRow cols={5}>
            {rows.map((r) => (
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
                sub={
                  [r.sub, r.stat, ...(r.detail ?? []).map((d) => `${d.label} ${d.value}`)]
                    .filter(Boolean)
                    .join(" · ") || undefined
                }
              />
            ))}
          </StatCardRow>

          {/* 24h volume split (homepage VolumeBar pattern) — the marketplace /
              gacha / direct-sales decomposition of the fold's headline total,
              read as one segmented bar with per-segment 24h deltas before the
              leaderboard breaks it down platform-by-platform. */}
          <SectionShell>
            <VolumeBar
              vol={volBreakdown}
              marketplacePct={data.hero.vol24Pct}
              gachaPct={data.hero.gachaVol24Pct}
              topBorder={false}
              href={null}
            />
          </SectionShell>

            {/* THE ONE VOLUME CANVAS, third. Numbers first, chart second — the
              terminal skeleton the study found unanimous (rwa.xyz, Blockworks,
              DefiLlama all open on a KPI strip and put the canvas under it). The
              KPI row states WHERE THINGS STAND, the volume bar splits today's
              total by source, and this answers HOW IT GOT HERE, per venue. */}
          {volumeHero.length > 0 && (
            <StackedAreaChart
              title="Volume by platform"
              readMe="who is winning turnover"
              subtitle={`Marketplace + gacha, per platform · last ${HERO_DAYS} days · complete days only`}
              metric="total24h"
              series={volumeHero}
              unit="usd"
              />
          )}
          {/* Breadth + concentration — the questions a sorted list doesn't answer.
              Below the canvas now: it qualifies the shape above rather than
              introducing it. */}
          <PlatformStatBar rows={data.platforms} />

          {/* ZONE 2 — the top-4 platforms' 14d cards, in leaderboard order, so
              the KPI summary reads straight down into the leaders. Any beyond
              the top 4 are one click away in the table. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((c) => (
              <MetricBarCard
                key={c.key}
                label={c.name}
                metric="total24h"
                data={c.data}
                unit="usd"
                note={c.note}
              />
            ))}
          </div>
          {moreInTable > 0 && (
            <a
              href="#platforms-table"
              className="block text-[12px] text-ink-3 transition-colors hover:text-yellow"
            >
              + {moreInTable} more platform{moreInTable === 1 ? "" : "s"} in the table below →
            </a>
          )}

          {/* ZONE 3 — the full leaderboard. scroll-mt clears the sticky nav when
              the "+N more" affordance jumps here. */}
          <div id="platforms-table" className="scroll-mt-24">
            <PlatformTable rows={data.platforms} chainFacets />
          </div>
        </div>
      </div>
    </>
  );
}
