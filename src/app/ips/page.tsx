import { unstable_cache } from "next/cache";
import { NavBar } from "@/components/NavBar";
import { CategoryStatBar } from "@/components/CategoryStatBar";
import { CategoryTrendChart } from "@/components/CategoryTrendChart";
import { CategoryTreemap } from "@/components/CategoryTreemap";
import { OverviewMetricColumn } from "@/components/OverviewMetricColumn";
import { MetricBarCard } from "@/components/MetricBarCard";
import { IPTable } from "@/components/IPTable";
import { fetchHomepage } from "@/lib/data/fetchHomepage";
import { readMetricSeriesBulk, type SeriesPoint } from "@/lib/data/metricSnapshots";
import { rollupByCategory } from "@/lib/category/rollup";
import { buildPriceComparison, PRICE_RANGES } from "@/lib/data/perfCompare";

// BUMP on ANY change to fetchHomepage's payload shape (a stale cache would serve
// the old shape). v8: added hero gachaVol24Usd + gachaVol24Pct + Σ-based vol24Pct.
// Wraps the same fetchHomepage() as homepage:v44 (src/app/page.tsx) — keep the two
// versions moving in lockstep.
const getData = unstable_cache(async () => fetchHomepage(), ["ips-fulllist:v8"], {
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

/** Sum daily spine series across every entity (and across the given metrics),
 *  bucketed by day, then keep the last `lastN` days oldest→newest. Powers the
 *  14-day bar cards: e.g. platform volume_usd + gacha_volume_usd = total volume. */
function sumDaily(sources: Record<string, SeriesPoint[]>[], lastN: number): SeriesPoint[] {
  const byTs = new Map<string, number>();
  for (const rec of sources) {
    for (const series of Object.values(rec)) {
      for (const p of series) {
        if (!Number.isFinite(p.value)) continue;
        byTs.set(p.ts, (byTs.get(p.ts) ?? 0) + p.value);
      }
    }
  }
  const sorted = [...byTs.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sorted.slice(-lastN).map(([ts, value]) => ({ ts, value }));
}

// ISR: cached HTML, 30-min background revalidate (data changes every ~6h) — R2-B1.
export const revalidate = 1800;

export const metadata = {
  title: "Market Overview · VARIABLE",
  description:
    "The tokenized trading-card market at a glance — composite index vs benchmarks, 24h volume, cards traded, and market cap by IP.",
};

// Keep only these two benchmarks on the overview chart (buildPriceComparison
// appends all five). Both share the weekly axis the dropped three do, so filtering
// them out leaves no stray x-labels — the composite index + BTC + S&P read clean.
const KEEP_BENCHMARKS = new Set(["BTC", "S&P 500"]);

export default async function AllIPsPage() {
  const [data, volSeries, cardsSeries, platVol, platGacha] = await Promise.all([
    getData(),
    getIpSeries("volume_usd"),
    getIpSeries("cards_traded"),
    getPlatformSeries("volume_usd"),
    getPlatformSeries("gacha_volume_usd"),
  ]);

  const categories = rollupByCategory(data.ips, volSeries);

  // Zone 1 (right) — the composite collectibles PRICE index (V-MKT, the same
  // series the homepage plots) vs BTC + S&P 500, rebased to 100. Gate on the
  // composite being present, not on any per-IP series.
  const marketTrend = await buildPriceComparison([
    { entity: "market", key: "total", label: "Collectibles Index", color: "#f3ff42" },
  ]);
  const compositeTrend = {
    ...marketTrend,
    datasets: marketTrend.datasets.filter((d) => !d.benchmark || KEEP_BENCHMARKS.has(d.group)),
  };
  const hasComposite = compositeTrend.datasets.some((d) => !d.benchmark);

  // Zone 1 (left) — 24h volume LEVELS split by source, lifted from the homepage
  // reduce (each platform row carries the components). Deltas are Phase 2 → "—".
  const vol24 = data.platforms.reduce(
    (a, p) => ({
      marketplace: a.marketplace + (p.vol24Usd || 0),
      gacha: a.gacha + (p.gachaVol24Usd ?? 0),
    }),
    { marketplace: 0, gacha: 0 },
  );

  // Zone 2 — three 14-day daily bar series (holders is a Phase-2 deduped series).
  const totalVol14 = sumDaily([platVol, platGacha], 14);
  const cardsTraded14 = sumDaily([cardsSeries], 14);

  return (
    <>
      <NavBar />
      <div className="px-8 pt-8 pb-20 font-sans">
        <h1 className="mb-4 text-[20px] font-bold leading-none tracking-[-0.01em]">Market Overview</h1>

        <CategoryStatBar rows={data.ips} categories={categories} />

        <div className="space-y-4">
          {/* ZONE 1 — left metric column + composite index chart. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-stretch">
            <OverviewMetricColumn
              mcapUsd={data.hero.totalMcapUsd}
              mcapPct24h={data.hero.mcapPct24h}
              marketplaceVol={vol24.marketplace}
              gachaVol={vol24.gacha}
            />
            {hasComposite ? (
              <CategoryTrendChart
                views={[{ key: "price", label: "Price", data: compositeTrend }]}
                title="Collectibles index vs benchmarks"
                defaultMode="rebased"
                allowRebase={false}
                basis="price"
                ranges={PRICE_RANGES}
                defaultRange="90D"
              />
            ) : (
              <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-line bg-bg-1 text-[13px] text-ink-3">
                Composite index building
              </div>
            )}
          </div>

          {/* ZONE 2 — three 14-day daily bar cards. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MetricBarCard label="Total Volume" data={totalVol14} unit="usd" accent="var(--color-blue)" />
            <MetricBarCard label="Cards Traded" data={cardsTraded14} unit="count" accent="var(--color-purple)" />
            <MetricBarCard label="Holders" data={[]} unit="count" accent="var(--color-green)" />
          </div>

          {/* ZONE 3 — market-cap treemap (unchanged) + full IP list. */}
          <CategoryTreemap rows={data.ips} />
          <IPTable rows={data.ips} />
        </div>
      </div>
    </>
  );
}
