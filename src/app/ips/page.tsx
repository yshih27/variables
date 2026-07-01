import { unstable_cache } from "next/cache";
import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { CategoryStatBar } from "@/components/CategoryStatBar";
import { CategoryTrendChart } from "@/components/CategoryTrendChart";
import { CategoryTreemap } from "@/components/CategoryTreemap";
import { IPTable } from "@/components/IPTable";
import { fetchHomepage } from "@/lib/data/fetchHomepage";
import { readMetricSeriesBulk } from "@/lib/data/metricSnapshots";
import { rollupByCategory } from "@/lib/category/rollup";
import { buildPriceComparison, PRICE_RANGES } from "@/lib/data/perfCompare";

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

// Distinct palette for the rebased comparison lines — IP brand colors collide
// (Pokémon + One Piece are both blue), so give each line its own hue.
const PERF_PALETTE = ["#5fa3ff", "#f5c451", "#2bd6a0", "#a18cff", "#ff6b9d"];

export default async function AllIPsPage() {
  const [data, volSeries] = await Promise.all([getData(), getIpSeries("volume_usd")]);

  const categories = rollupByCategory(data.ips, volSeries);

  // Top IPs by market cap → their constant-quality PRICE index, overlaid against
  // BTC/ETH/S&P/NASDAQ (QA-6). Falls back to nothing if no IP has a price series.
  const perfEntities = [...data.ips]
    .filter((ip) => ip.key !== "other" && Number.isFinite(ip.mcapUsd) && ip.mcapUsd >= 1000 && ip.cards >= 5)
    .sort((a, b) => b.mcapUsd - a.mcapUsd)
    .slice(0, 5)
    .map((ip, i) => ({ entity: "ip" as const, key: ip.key, label: ip.name, color: PERF_PALETTE[i % PERF_PALETTE.length] }));
  const perfTrend = await buildPriceComparison(perfEntities);
  const perfHasInternal = perfTrend.datasets.some((d) => !d.benchmark);

  return (
    <>
      <NavBar />
      <div className="px-8 pt-10 pb-20 font-sans">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-[12px] text-ink-3">
          <Link href="/" className="hover:text-ink-2">Rankings</Link>
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
        <div className="space-y-6">
          {perfHasInternal && (
            <CategoryTrendChart
              views={[{ key: "price", label: "Price", data: perfTrend }]}
              title="Performance by IP"
              defaultMode="rebased"
              allowRebase={false}
              basis="price"
              ranges={PRICE_RANGES}
              defaultRange="90D"
            />
          )}
          <CategoryTreemap rows={data.ips} />
          <IPTable rows={data.ips} />
        </div>
      </div>
    </>
  );
}
