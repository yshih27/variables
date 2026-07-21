import { unstable_cache } from "next/cache";
import { NavBar } from "@/components/NavBar";
import { CategoryStatBar } from "@/components/CategoryStatBar";
import { IndexStudio } from "@/components/IndexStudio";
import { CategoryTreemap } from "@/components/CategoryTreemap";
import { OverviewMetricColumn, type OverviewMetricRow } from "@/components/OverviewMetricColumn";
import { formatCompactUsd, formatCompactNumber, staleAsOfLabel } from "@/lib/format";
import { MetricBarCard } from "@/components/MetricBarCard";
import { IPTable } from "@/components/IPTable";
import { fetchHomepage } from "@/lib/data/fetchHomepage";
import { readMetricSeries, readMetricSeriesBulk, lastNDays, dropIncompleteTail, type SeriesPoint } from "@/lib/data/metricSnapshots";
import { rollupByCategory } from "@/lib/category/rollup";

// BUMP on ANY change to fetchHomepage's payload shape (a stale cache would serve
// the old shape). v9: added hero mcapAsOf for the >36h market-cap stale-guard. v8:
// added hero gachaVol24Usd + gachaVol24Pct + Σ-based vol24Pct. Wraps the same
// fetchHomepage() as homepage:v45 (src/app/page.tsx) — keep the two in lockstep.
const getData = unstable_cache(async () => fetchHomepage(), ["ips-fulllist:v9"], {
  revalidate: 3600,
  tags: ["homepage"],
});

/**
 * Per-entity daily spine series (keyed by metric) for a whole entity_type. The
 * by-category rollup, the composite chart's gating, and the Zone-2 daily bar
 * cards read off these. Serialized to a plain object so unstable_cache can store
 * it; the metric arg is part of the cache key, so one wrapper serves every metric.
 * These are extra spine reads (separate from fetchHomepage) — no cache-key bump.
 */
const getIpSeries = unstable_cache(
  async (metric: string) => Object.fromEntries(await readMetricSeriesBulk("ip", metric)),
  ["ips-ip-series:v1"],
  { revalidate: 3600, tags: ["homepage"] },
);
const getPlatformSeries = unstable_cache(
  async (metric: string) => Object.fromEntries(await readMetricSeriesBulk("platform", metric)),
  ["ips-platform-series:v1"],
  { revalidate: 3600, tags: ["homepage"] },
);
/**
 * MARKET-level series (entity_type="market", key="total") — a single row, not a
 * bulk read. Holders lives here and ONLY here: the spine writes it as a deduped
 * UNION across platforms, and that union cannot be reconstructed downstream —
 * Σ per-platform holders double-counts anyone holding on two platforms. So this
 * card is either the market row or nothing; never a sum.
 */
const getMarketSeries = unstable_cache(
  async (metric: string) => readMetricSeries("market", "total", metric),
  ["ips-market-series:v1"],
  { revalidate: 3600, tags: ["homepage"] },
);

/** Sum daily spine series across every entity (and across the given metrics),
 *  bucketed by day, then keep the last `lastN` days oldest→newest. Powers the
 *  14-day bar cards: e.g. platform volume_usd + gacha_volume_usd = total volume. */
function sumDaily(sources: Record<string, SeriesPoint[]>[], lastN: number): SeriesPoint[] {
  const byTs = new Map<string, number>();
  // Per-source bulk (keyed by record#:entity) for the completeness gate below.
  const bulk = new Map<string, SeriesPoint[]>();
  sources.forEach((rec, i) => {
    for (const [k, series] of Object.entries(rec)) {
      bulk.set(`${i}:${k}`, series);
      for (const p of series) {
        if (!Number.isFinite(p.value)) continue;
        byTs.set(p.ts, (byTs.get(p.ts) ?? 0) + p.value);
      }
    }
  });
  const sorted = [...byTs.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([ts, value]) => ({ ts, value }));
  // Drop a SOURCE-INCOMPLETE trailing day (a Dune-lagged partial: some platforms/IPs
  // in, others still ending yesterday) so the last bar never craters to a fake cliff.
  // lastNDays, not slice(-N): keep the label and the calendar-day plot in step.
  return lastNDays(dropIncompleteTail(sorted, bulk), lastN);
}

// ISR: cached HTML, 30-min background revalidate (data changes every ~6h) — R2-B1.
export const revalidate = 1800;

export const metadata = {
  title: "Market Overview · VARIBLE",
  description:
    "The tokenized trading-card market at a glance — composite index vs benchmarks, 24h volume, cards traded, and market cap by IP.",
};

export default async function AllIPsPage() {
  const [data, volSeries, cardsSeries, platVol, platGacha, holdersSeries] = await Promise.all([
    getData(),
    getIpSeries("volume_usd"),
    getIpSeries("cards_traded"),
    getPlatformSeries("volume_usd"),
    getPlatformSeries("gacha_volume_usd"),
    getMarketSeries("holders"),
  ]);

  const categories = rollupByCategory(data.ips, volSeries);

  // Zone 1 (left) — 24h volume LEVELS split by source, lifted from the homepage
  // reduce (each platform row carries the components). Their 24h %Δ now come from
  // the Σ-based hero fields (vol24Pct = marketplace-only, gachaVol24Pct = gacha).
  const vol24 = data.platforms.reduce(
    (a, p) => ({
      marketplace: a.marketplace + (p.vol24Usd || 0),
      gacha: a.gacha + (p.gachaVol24Usd ?? 0),
    }),
    { marketplace: 0, gacha: 0 },
  );

  // Zone 2 — three 14-day daily series. Volume and cards traded are Σ across
  // entities; holders is NOT summed — it is read straight off the market row,
  // which the spine writes as a deduped union (see getMarketSeries). The series
  // is young (it began accumulating mid-July), so the card renders the points
  // that exist plus its own "N of 14 days · building" note.
  const totalVol14 = sumDaily([platVol, platGacha], 14);
  const cardsTraded14 = sumDaily([cardsSeries], 14);
  const holders14 = lastNDays(holdersSeries, 14);

  // Distinct cards traded in the 24h window. There is no hero-level field for
  // this (hero.totalCards is Σ TRACKED collection size, a different metric), so
  // it's summed off the rows — guarded the same way IPTable's Cards cell is, so
  // an mcap-only IP with no trades contributes 0 rather than its catalog size.
  const cardsTraded24h = data.ips.reduce((s, r) => s + (r.trades24h > 0 ? r.cards : 0), 0);
  // The Cards Traded row's expanded "14d total" — same series as its bar card.
  const cardsTraded14dTotal = cardsTraded14.reduce(
    (s, p) => s + (Number.isFinite(p.value) ? p.value : 0),
    0,
  );

  // ── Zone-1 rail rows ────────────────────────────────────────────────────────
  // Built HERE, not inside OverviewMetricColumn, because delta units are a
  // property of the producer and the producers differ per page.
  //
  // ⚠️ hero.mcapPct24h is a FRACTION (marketcap.pctChangeOverHours) while
  // hero.vol24Pct / hero.gachaVol24Pct are ALREADY PERCENT (dayOverDayPct).
  // Do NOT "normalize" that asymmetry away without changing the producers —
  // scaling the wrong one renders 100× off.
  //
  // holdersPct7d and trades24hPct are hardcoded null in fetchHomepage, so those
  // rows honestly show "—" until the backend lands them. Cards Traded has no
  // delta field at all.
  const catSplit = categories.filter((c) => Number.isFinite(c.mcapUsd) && c.mcapUsd > 0);
  const pct = (frac: number | null | undefined) =>
    frac != null && Number.isFinite(frac) ? frac * 100 : null;
  // Overview stale-guard (item 7): "as of <Mon DD>" beside the market-cap value
  // when its source is >36h old — the same gap AF-1 exposed, closed on /ips too.
  const mcapAsOf = staleAsOfLabel(data.hero.mcapAsOf);

  const overviewRows: OverviewMetricRow[] = [
    {
      label: "Market Cap",
      metric: "marketCap",
      value: data.hero.totalMcapUsd,
      unit: "usd",
      deltaPct: pct(data.hero.mcapPct24h), // FRACTION → percent
      window: "24h",
      hero: true,
      // Muted "as of <Mon DD>" beside the value when the source is stale (>36h).
      sub: mcapAsOf ?? undefined,
      detail: catSplit.length
        ? catSplit.map((c) => ({ label: c.group, value: formatCompactUsd(c.mcapUsd) }))
        : undefined,
    },
    {
      label: "24h Marketplace Vol",
      metric: "marketplace",
      value: vol24.marketplace,
      unit: "usd",
      deltaPct: data.hero.vol24Pct, // already percent — no ×100
      window: "24h",
      // vol7Usd is NaN until every platform has 7 complete days → no chevron.
      detail:
        Number.isFinite(data.hero.vol7Usd) && data.hero.vol7Usd > 0
          ? [{ label: "7d volume", value: formatCompactUsd(data.hero.vol7Usd) }]
          : undefined,
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
      label: "Holders",
      metric: "holders",
      value: data.hero.holders,
      unit: "count",
      deltaPct: pct(data.hero.holdersPct7d),
      window: "7d",
      // No sub-split: holders is a deduped market-wide union, so a per-platform
      // breakdown would double-count anyone holding on two platforms.
    },
    {
      label: "24h Trades",
      metric: "trades",
      value: data.hero.trades24h,
      unit: "count",
      deltaPct: pct(data.hero.trades24hPct),
      window: "24h",
    },
    {
      label: "24h Cards Traded",
      metric: "cardsTraded",
      value: cardsTraded24h,
      unit: "count",
      deltaPct: null, // no producer exists for this one
      window: "24h",
      detail:
        cardsTraded14dTotal > 0
          ? [{ label: "14d total", value: formatCompactNumber(cardsTraded14dTotal) }]
          : undefined,
    },
  ];

  return (
    <>
      <NavBar />
      {/* Density: this is the selling-point page, so the fold is tuned to carry
          the rail + chart + all three bar cards. Gaps are one rung tighter than
          the app default (3 vs 4) and the zones share the same rhythm. */}
      <div className="px-8 pt-6 pb-20 font-sans">
        <h1 className="mb-3 text-[20px] font-bold leading-none tracking-[-0.01em]">Market Overview</h1>

        <CategoryStatBar rows={data.ips} categories={categories} />

        <div className="space-y-3">
          {/* ZONE 1 — left metric column + interactive Index Studio chart. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[264px_minmax(0,1fr)] lg:items-start">
            <OverviewMetricColumn rows={overviewRows} />
            <IndexStudio />
          </div>

          {/* ZONE 2 — three 14-day daily cards. Volume and cards traded are flows
              (bars off zero); holders is a stock, so it draws as a line and its
              headline is the latest level, not a nonsensical 14-day sum. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricBarCard label="Total Volume" metric="total24h" data={totalVol14} unit="usd" />
            <MetricBarCard label="Cards Traded" metric="cardsTraded" data={cardsTraded14} unit="count" />
            <MetricBarCard
              label="Holders"
              metric="holders"
              data={holders14}
              unit="count"
              variant="line"
              emptyDetail="deduped daily union — first write pending"
            />
          </div>

          {/* ZONE 3 — market-cap treemap (unchanged) + full IP list. */}
          <CategoryTreemap rows={data.ips} />
          <IPTable rows={data.ips} />
        </div>
      </div>
    </>
  );
}
