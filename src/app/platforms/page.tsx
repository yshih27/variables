import { unstable_cache } from "next/cache";
import { NavBar } from "@/components/NavBar";
import { PlatformStatBar } from "@/components/PlatformStatBar";
import { CategoryTrendChart } from "@/components/CategoryTrendChart";
import { PlatformTable } from "@/components/PlatformTable";
import { fetchHomepage } from "@/lib/data/fetchHomepage";
import { readMetricSeriesBulk } from "@/lib/data/metricSnapshots";
import { buildPlatformTrend, buildVolumeSplitTrend } from "@/lib/platform/rollup";

const getData = unstable_cache(async () => fetchHomepage(), ["platforms-fulllist:v6"], {
  revalidate: 3600,
  tags: ["homepage"],
});

/** Per-platform daily spine series (keyed by metric), for the by-platform trend.
 *  v2 (R5-1): v1 cached an empty `mcap_usd` map from before the spine carried
 *  per-platform market cap, which left the "Market cap" trend view blank. */
const getPlatformSeries = unstable_cache(
  async (metric: string) => Object.fromEntries(await readMetricSeriesBulk("platform", metric)),
  ["platforms-series:v2"],
  { revalidate: 3600, tags: ["homepage"] },
);

// ISR: cached HTML, 30-min background revalidate (data changes every ~6h) — R2-B1.
// All reads are unstable_cache-backed; no cookies/headers/searchParams here.
export const revalidate = 1800;

export const metadata = {
  title: "All Platforms · VARIBLE",
  description: "Tokenized-collectible platforms ranked by 24h volume, with volume and gacha trends by platform.",
};

export default async function AllPlatformsPage() {
  const [data, mktSeries, gachaSeries, mcapSeries] = await Promise.all([
    getData(),
    getPlatformSeries("volume_usd"),
    getPlatformSeries("gacha_volume_usd"),
    getPlatformSeries("mcap_usd"),
  ]);

  // Primary metric = Volume | Market cap (R2-F3). Volume decomposes by TYPE into
  // Marketplace (secondary resale) + Gacha (primary) rather than mixing a volume
  // sub-type against a stock metric in one toggle. Market cap stays per-platform.
  const trendViews = [
    { key: "volume", label: "Volume", data: buildVolumeSplitTrend(mktSeries, gachaSeries) },
    { key: "mcap", label: "Market cap", data: buildPlatformTrend(mcapSeries, "hold") },
  ];

  return (
    <>
      <NavBar />
      <div className="px-8 pt-10 pb-20 font-sans">
        <h1 className="mb-2 text-[32px] font-bold leading-none tracking-[-0.01em]">
          Platforms
        </h1>
        <div className="mb-8 text-[13px] text-ink-3">
          Where the trading happens — {data.platforms.length} tokenized-collectible marketplaces across chains.
        </div>
        <PlatformStatBar rows={data.platforms} />
        <div className="space-y-6">
          <CategoryTrendChart views={trendViews} defaultKey="volume" entityLabel="platform" />
          <PlatformTable rows={data.platforms} chainFacets />
        </div>
      </div>
    </>
  );
}
