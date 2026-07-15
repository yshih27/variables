import { unstable_cache } from "next/cache";
import { NavBar } from "@/components/NavBar";
import { CategoryStatBar } from "@/components/CategoryStatBar";
import { IndexStudio } from "@/components/IndexStudio";
import { CategoryTreemap } from "@/components/CategoryTreemap";
import { OverviewMetricColumn } from "@/components/OverviewMetricColumn";
import { MetricBarCard } from "@/components/MetricBarCard";
import { IPTable } from "@/components/IPTable";
import { fetchHomepage } from "@/lib/data/fetchHomepage";
import { readMetricSeriesBulk, type SeriesPoint } from "@/lib/data/metricSnapshots";
import { rollupByCategory } from "@/lib/category/rollup";

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
  title: "Market Overview · VARIBLE",
  description:
    "The tokenized trading-card market at a glance — composite index vs benchmarks, 24h volume, cards traded, and market cap by IP.",
};

export default async function AllIPsPage() {
  const [data, volSeries, cardsSeries, platVol, platGacha] = await Promise.all([
    getData(),
    getIpSeries("volume_usd"),
    getIpSeries("cards_traded"),
    getPlatformSeries("volume_usd"),
    getPlatformSeries("gacha_volume_usd"),
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

  // Zone 2 — three 14-day daily bar series (holders is a Phase-2 deduped series).
  const totalVol14 = sumDaily([platVol, platGacha], 14);
  const cardsTraded14 = sumDaily([cardsSeries], 14);

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
            <OverviewMetricColumn
              mcapUsd={data.hero.totalMcapUsd}
              mcapPct24h={data.hero.mcapPct24h}
              marketplaceVol={vol24.marketplace}
              gachaVol={vol24.gacha}
              marketplacePct24h={data.hero.vol24Pct}
              gachaPct24h={data.hero.gachaVol24Pct}
              holders={data.hero.holders}
              holdersPct7d={data.hero.holdersPct7d}
              trades24h={data.hero.trades24h}
              trades24hPct={data.hero.trades24hPct}
              cardsTraded24h={cardsTraded24h}
              vol7Usd={data.hero.vol7Usd}
              cardsTraded14d={cardsTraded14dTotal}
              mcapByCategory={categories}
            />
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
              data={[]}
              unit="count"
              variant="line"
              emptyDetail="deduped daily series — Phase 2"
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
