import { unstable_cache } from "next/cache";
import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { PlatformStatBar } from "@/components/PlatformStatBar";
import { CategoryTrendChart } from "@/components/CategoryTrendChart";
import { PlatformTable } from "@/components/PlatformTable";
import { fetchHomepage } from "@/lib/data/fetchHomepage";
import { readMetricSeriesBulk } from "@/lib/data/metricSnapshots";
import { buildPlatformTrend } from "@/lib/platform/rollup";

const getData = unstable_cache(async () => fetchHomepage(), ["platforms-fulllist:v5"], {
  revalidate: 3600,
  tags: ["homepage"],
});

/** Per-platform daily spine series (keyed by metric), for the by-platform trend. */
const getPlatformSeries = unstable_cache(
  async (metric: string) => Object.fromEntries(await readMetricSeriesBulk("platform", metric)),
  ["platforms-series:v1"],
  { revalidate: 3600, tags: ["homepage"] },
);

export const dynamic = "force-dynamic";

export const metadata = {
  title: "All Platforms · VARIABLE",
  description: "Tokenized-collectible platforms ranked by 24h volume, with volume and gacha trends by platform.",
};

export default async function AllPlatformsPage() {
  const [data, mktSeries, mcapSeries] = await Promise.all([
    getData(),
    getPlatformSeries("volume_usd"),
    getPlatformSeries("mcap_usd"),
  ]);

  // Marketplace (secondary resale) + market cap only — both reconciled/reliable.
  // The spine's `gacha_volume_usd` runs ~60× below the live gacha 24h figures
  // (and spiky), so it's not trustworthy to chart yet; the StatBar + table show
  // the accurate live gacha numbers. Re-add a gacha trend once the backend
  // reconciles that series the way `volume_usd` was reconciled in PR #17.
  const trendViews = [
    { key: "marketplace", label: "Marketplace", data: buildPlatformTrend(mktSeries, "zero") },
    { key: "mcap", label: "Market cap", data: buildPlatformTrend(mcapSeries, "hold") },
  ];

  return (
    <>
      <NavBar />
      <div className="px-8 pt-10 pb-20 font-sans">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-[12px] text-ink-3">
          <Link href="/" className="hover:text-ink-2">Rankings</Link>
          <span>›</span>
          <span className="text-ink-2">Platforms</span>
        </div>
        <h1 className="mb-2 text-[32px] font-bold leading-none tracking-[-0.01em]">
          Platforms
        </h1>
        <div className="mb-8 text-[13px] text-ink-3">
          Where the trading happens — {data.platforms.length} tokenized-collectible marketplaces across chains.
        </div>
        <PlatformStatBar rows={data.platforms} />
        <div className="space-y-6">
          <CategoryTrendChart views={trendViews} defaultKey="marketplace" entityLabel="platform" />
          <PlatformTable rows={data.platforms} />
        </div>
      </div>
    </>
  );
}
