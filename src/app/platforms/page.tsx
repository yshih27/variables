import { unstable_cache } from "next/cache";
import { NavBar } from "@/components/NavBar";
import { IndexStudio } from "@/components/IndexStudio";
import { OverviewMetricColumn, type OverviewMetricRow } from "@/components/OverviewMetricColumn";
import { MetricBarCard } from "@/components/MetricBarCard";
import { PlatformTable } from "@/components/PlatformTable";
import { fetchHomepage } from "@/lib/data/fetchHomepage";
import { pctChange, readMetricSeriesBulk, type SeriesPoint } from "@/lib/data/metricSnapshots";
import { formatCompactUsd } from "@/lib/format";

const getData = unstable_cache(async () => fetchHomepage(), ["platforms-fulllist:v6"], {
  revalidate: 3600,
  tags: ["homepage"],
});

/** Per-entity daily spine series (keyed by metric) for the whole platform family.
 *  v2 (R5-1): v1 cached an empty `mcap_usd` map from before the spine carried
 *  per-platform market cap. */
const getPlatformSeries = unstable_cache(
  async (metric: string) => Object.fromEntries(await readMetricSeriesBulk("platform", metric)),
  ["platforms-series:v2"],
  { revalidate: 3600, tags: ["homepage"] },
);

/** Sum daily spine series across every platform (and across the given metrics),
 *  bucketed by day, oldest→newest. Mirrors /ips's sumDaily — the same reads feed
 *  the same three cards. Kept UNSLICED so a %Δ can look back past the window. */
function sumDaily(sources: Record<string, SeriesPoint[]>[]): SeriesPoint[] {
  const byTs = new Map<string, number>();
  for (const rec of sources) {
    for (const series of Object.values(rec)) {
      for (const p of series) {
        if (!Number.isFinite(p.value)) continue;
        byTs.set(p.ts, (byTs.get(p.ts) ?? 0) + p.value);
      }
    }
  }
  return [...byTs.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([ts, value]) => ({ ts, value }));
}

// ISR: cached HTML, 30-min background revalidate (data changes every ~6h) — R2-B1.
// All reads are unstable_cache-backed; no cookies/headers/searchParams here.
export const revalidate = 1800;

export const metadata = {
  title: "Platforms Overview · VARIBLE",
  description:
    "Where the trading happens — tokenized-collectible platforms compared on 24h volume, the marketplace/gacha split, and market cap.",
};

/** Concentration bands for the HHI disclosure — the retired PlatformStatBar's
 *  cutoffs (0.25/0.4), NOT CategoryStatBar's (0.2/0.4): four platforms make an
 *  evenly-split HHI of 0.25, so "Moderate" has to start there. */
function hhiLabel(hhi: number): string {
  if (hhi >= 0.4) return "High";
  if (hhi >= 0.25) return "Moderate";
  return "Low";
}

export default async function AllPlatformsPage() {
  const [data, mktSeries, gachaSeries, tradesSeries] = await Promise.all([
    getData(),
    getPlatformSeries("volume_usd"),
    getPlatformSeries("gacha_volume_usd"),
    getPlatformSeries("trades"),
  ]);

  // Zone 2 — the same reads as /ips, summed across platforms.
  const mktDaily = sumDaily([mktSeries]);
  const gachaDaily = sumDaily([gachaSeries]);
  const tradesDaily = sumDaily([tradesSeries]);
  const totalDaily = sumDaily([mktSeries, gachaSeries]);
  const last14 = (s: SeriesPoint[]) => s.slice(-14);

  // 24h LEVELS, Σ'd from the rows (each platform carries its own components).
  // `|| 0` / `?? 0` are load-bearing: an untracked platform's marketplace volume
  // is NaN (Phygitals has no secondary source), and one NaN would poison the Σ.
  const vol24 = data.platforms.reduce(
    (a, p) => ({
      marketplace: a.marketplace + (p.vol24Usd || 0),
      gacha: a.gacha + (p.gachaVol24Usd ?? 0),
    }),
    { marketplace: 0, gacha: 0 },
  );
  const total24 = vol24.marketplace + vol24.gacha;

  // Leading platform by TOTAL 24h activity, matching how PlatformTable ranks —
  // two different "top platform" answers on one page would be indefensible.
  const ranked = [...data.platforms].sort(
    (a, b) => (Number.isFinite(b.total24Usd) ? b.total24Usd : 0) - (Number.isFinite(a.total24Usd) ? a.total24Usd : 0),
  );
  const top = ranked[0];
  const topSharePct = top && total24 > 0 ? (top.total24Usd / total24) * 100 : null;
  // Herfindahl over the same 24h-total shares the ranking uses — the retired
  // PlatformStatBar's Concentration stat, now a disclosure under the row it
  // qualifies. `|| 0` absorbs a NaN total24Usd (untracked platform).
  const hhi =
    total24 > 0
      ? data.platforms.reduce((s, p) => s + Math.pow((p.total24Usd || 0) / total24, 2), 0)
      : null;
  const chains = new Set(data.platforms.map((p) => p.chain)).size;

  // ── Zone-1 rail rows ────────────────────────────────────────────────────────
  // ⚠️ EVERY delta on this page is ALREADY PERCENT — hero.vol24Pct and
  // hero.gachaVol24Pct come from dayOverDayPct, and pctChange (metricSnapshots)
  // also returns percent. So NOTHING here is ×100. /ips scales hero.mcapPct24h
  // because marketcap.pctChangeOverHours returns a FRACTION; do not copy that
  // across — it renders 100× high. This is why rows are built per page.
  //
  // The total's %Δ has no hero field, so it's derived from the summed daily
  // spine (same tier as the bar card below it). pctChange returns null rather
  // than inventing a number when there's under 2 days of history.
  const rows: OverviewMetricRow[] = [
    {
      label: "Total 24h Volume",
      metric: "total24h",
      value: total24,
      unit: "usd",
      deltaPct: pctChange(totalDaily, 1),
      window: "24h",
      hero: true,
      detail: [
        { label: "Marketplace", value: formatCompactUsd(vol24.marketplace) },
        { label: "Gacha", value: formatCompactUsd(vol24.gacha) },
      ],
    },
    {
      label: "24h Marketplace Vol",
      metric: "marketplace",
      value: vol24.marketplace,
      unit: "usd",
      deltaPct: data.hero.vol24Pct, // already percent — no ×100
      window: "24h",
    },
    {
      label: "24h Gacha Vol",
      metric: "gacha",
      value: vol24.gacha,
      unit: "usd",
      deltaPct: data.hero.gachaVol24Pct, // already percent — no ×100
      window: "24h",
    },
    {
      // An entity, not a measurement → valueText + stat. `stat` (not a null
      // delta) because a leading platform has no %Δ to be missing.
      label: "Top Platform",
      metric: "share",
      value: NaN,
      unit: "usd",
      deltaPct: null,
      valueText: top?.name ?? "—",
      stat: topSharePct != null ? `${topSharePct.toFixed(1)}% of 24h vol` : undefined,
      hero: false,
      detail:
        hhi != null
          ? [{ label: "Concentration", value: `HHI ${hhi.toFixed(2)} · ${hhiLabel(hhi)}` }]
          : undefined,
    },
    {
      label: "Platforms Tracked",
      metric: "marketShare",
      value: data.platforms.length,
      unit: "count",
      deltaPct: null,
      stat: `across ${chains} chain${chains === 1 ? "" : "s"}`,
    },
  ];

  return (
    <>
      <NavBar />
      <div className="px-8 pt-6 pb-20 font-sans">
        <h1 className="mb-3 text-[20px] font-bold leading-none tracking-[-0.01em]">
          Platforms Overview
        </h1>

        <div className="space-y-3">
          {/* ZONE 1 — family levels + the Index Studio scoped to the platform
              family, so CC vs Beezie vs Courtyard compare out of the box. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[264px_minmax(0,1fr)] lg:items-start">
            <OverviewMetricColumn rows={rows} />
            <IndexStudio scope={{ entity: "platform" }} />
          </div>

          {/* ZONE 2 — 14d dailies, platform-summed. Marketplace and gacha are
              split rather than stacked: they answer different questions and the
              old chart's stacking hid the smaller one. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricBarCard
              label="Marketplace Vol"
              metric="marketplace"
              data={last14(mktDaily)}
              unit="usd"
            />
            <MetricBarCard label="Gacha Vol" metric="gacha" data={last14(gachaDaily)} unit="usd" />
            <MetricBarCard label="Trades" metric="trades" data={last14(tradesDaily)} unit="count" />
          </div>

          {/* ZONE 3 — the full list. */}
          <PlatformTable rows={data.platforms} chainFacets />
        </div>
      </div>
    </>
  );
}
