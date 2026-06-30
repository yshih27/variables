import { unstable_cache } from "next/cache";
import { NavBar } from "@/components/NavBar";
import { CategoryStatBar } from "@/components/CategoryStatBar";
import { CategoryTrendChart } from "@/components/CategoryTrendChart";
import { CategoryBreakdown } from "@/components/CategoryBreakdown";
import { CategoryTreemap } from "@/components/CategoryTreemap";
import { IPTable } from "@/components/IPTable";
import { fetchHomepage } from "@/lib/data/fetchHomepage";
import { readMetricSeriesBulk } from "@/lib/data/metricSnapshots";
import { rollupByCategory, buildCategoryTrend } from "@/lib/category/rollup";

const getData = unstable_cache(async () => fetchHomepage(), ["ips-fulllist:v4"], {
  revalidate: 3600,
  tags: ["homepage"],
});

/**
 * Per-IP daily spine series (keyed by metric) — the by-category trend graph and
 * the category sparklines/momentum read off these. `volume_usd` is backfilled
 * (real history today); `mcap_usd` is forward-only and greys in over time.
 * Serialized to a plain object so unstable_cache can store it; the metric arg is
 * part of the cache key.
 */
const getIpSeries = unstable_cache(
  async (metric: string) => Object.fromEntries(await readMetricSeriesBulk("ip", metric)),
  ["ips-ip-series:v1"],
  { revalidate: 3600, tags: ["homepage"] },
);

export const dynamic = "force-dynamic";

export const metadata = {
  title: "All IPs · VARIABLE",
  description: "Full list of tokenized-collectible IPs ranked by market cap.",
};

export default async function AllIPsPage() {
  const [data, volSeries, mcapSeries] = await Promise.all([
    getData(),
    getIpSeries("volume_usd"),
    getIpSeries("mcap_usd"),
  ]);

  const categories = rollupByCategory(data.ips, volSeries);
  const trendViews = [
    { key: "mcap", label: "Market cap", data: buildCategoryTrend(data.ips, mcapSeries, "hold") },
    { key: "volume", label: "24h volume", data: buildCategoryTrend(data.ips, volSeries, "zero") },
  ];

  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-[1760px] px-8 pt-10 pb-20 font-sans">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-[12px] text-ink-3">
          <a href="/" className="hover:text-ink-2">Rankings</a>
          <span>›</span>
          <span className="text-ink-2">Categories</span>
        </div>
        <h1 className="mb-2 text-[32px] font-bold leading-none tracking-[-0.01em]">
          Categories
        </h1>
        <div className="mb-8 text-[13px] text-ink-3">
          How the tokenized-TCG market is composed, and where it&apos;s rotating.
        </div>
        <CategoryStatBar rows={data.ips} categories={categories} />
        <CategoryTrendChart views={trendViews} defaultKey="mcap" />
        <CategoryBreakdown categories={categories} />
        <CategoryTreemap rows={data.ips} />
        <IPTable rows={data.ips} />
      </div>
    </>
  );
}
