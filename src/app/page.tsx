import { unstable_cache } from "next/cache";
import { NavBar } from "@/components/NavBar";
import { MarketHeader } from "@/components/MarketHeader";
import { TopSalesPanel } from "@/components/TopSalesPanel";
import { TrendingCards } from "@/components/TrendingCards";
import { IPTable } from "@/components/IPTable";
import { PlatformTable } from "@/components/PlatformTable";
import { fetchHomepage } from "@/lib/data/fetchHomepage";
import { getGachaData } from "@/lib/data/fetchGacha";
import { getTrendingCards } from "@/lib/data/fetchTrending";
import { formatCompactNumber } from "@/lib/format";
import { readMetricSeries, pctChange } from "@/lib/data/metricSnapshots";
import { rebaseSeries, readIndexSeries } from "@/lib/data/indices";

const getHomepageData = unstable_cache(
  async () => fetchHomepage(),
  ["homepage:v42"],
  { revalidate: 3600, tags: ["homepage"] },
);

/** Homepage headline index = the constant-quality PRICE index for the whole market
 *  (readIndexSeries kind:"price") — the SAME series /ips + the IP pages show, so the
 *  two never disagree (X3). Market cap stays the separately-labeled "TOTAL MARKET CAP"
 *  size stat, and vs-benchmarks becomes price-vs-price (apples-to-apples). The price
 *  index is WEEKLY (stratified-median), so the 24h delta is nulled below. */
const getMarketIndexSeries = unstable_cache(
  async () => readIndexSeries("market", "total", { kind: "price", from: "2000-01-01" }).catch(() => []),
  ["homepage-market-index:v3"],
  { revalidate: 1800, tags: ["homepage"] },
);

/** Raw daily closes for the 4 external benchmarks (BTC/ETH/S&P 500/NASDAQ) from the
 *  spine (written by warm-benchmarks). Rebased to the index inception in-page so the
 *  market header's relative-strength column = market return − benchmark return. */
const getBenchmarkCloses = unstable_cache(
  async () => {
    const out: Record<string, { ts: string; value: number }[]> = {};
    for (const s of ["BTC", "ETH", "SP500", "NASDAQ"] as const) {
      out[s] = await readMetricSeries("benchmark", s, "close").catch(() => []);
    }
    return out;
  },
  ["homepage-benchmarks:v1"],
  { revalidate: 3600, tags: ["homepage"] },
);

/** Age of the listings snapshot behind Trending's Float, in words. Module-scope
 *  so the once-per-request `Date.now()` isn't a render-time impurity (X6). */
function floatAgeLabelOf(iso: string | null): string | null {
  if (!iso) return null;
  const h = Math.max(0, (Date.now() - Date.parse(iso)) / 3_600_000);
  if (!Number.isFinite(h)) return null;
  return h < 1 ? "from listings <1h old" : `from listings ~${Math.round(h)}h old`;
}

// ISR: serve cached HTML, revalidate every 30 min in the background. The underlying
// data only changes every ~6h (warmers), so per-request re-rendering was pure waste
// (R2-B1). All reads are unstable_cache-backed; no cookies/headers/searchParams here.
export const revalidate = 1800;

export default async function Home() {
  const [data, gacha, marketIdx, benchCloses, trending24] = await Promise.all([
    getHomepageData(),
    getGachaData(),
    getMarketIndexSeries(),
    getBenchmarkCloses(),
    getTrendingCards({ limit: 8 }),
  ]);

  // X6 — a thin 24h window on 1-of-1 slabs ties whole tables at "2 trades", so
  // the ranking reads arbitrary. When ties dominate, rank on the 7d window
  // instead (CC-only coverage, but a real ordering) and say so in the panel.
  const tieHeavy =
    trending24.rows.length >= 4 && new Set(trending24.rows.map((r) => r.trades)).size <= 2;
  const trending7 = tieHeavy ? await getTrendingCards({ window: "7d", limit: 8 }) : null;
  const useWeekly = !!trending7 && trending7.rows.length >= trending24.rows.length;
  const trending = useWeekly ? trending7! : trending24;
  const trendingWindow = useWeekly ? "7d" : "24h";
  const floatAgeLabel = floatAgeLabelOf(trending.floatAsOf);

  // Market index rebased to 100 at inception. All change windows read off this
  // one series so the header never shows two disagreeing numbers for the market;
  // relStrength (vs BTC/ETH/S&P/NASDAQ) is computed below from the B1 benchmarks.
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const idxBase = marketIdx.find((p) => Number.isFinite(p.value) && p.value > 0)?.value ?? null;
  const indexValue =
    idxBase && marketIdx.length ? (marketIdx[marketIdx.length - 1].value / idxBase) * 100 : null;
  const inceptionTs = marketIdx[0]?.ts ? new Date(marketIdx[0].ts) : null;
  const inceptionLabel = inceptionTs
    ? `since ${MON[inceptionTs.getUTCMonth()]} ${inceptionTs.getUTCDate()}`
    : null;

  // Relative strength = market index return − benchmark return over the SAME window.
  // R4-1: LEAD with the 30d spread (relatable) and carry the since-inception spread
  // as a secondary line — a 6-month pp-spread (e.g. +168% vs BTC) is real but reads
  // broken unlabeled. Both legs measured over one window so the subtraction is fair;
  // a row is "—" only when its benchmark is missing for that window.
  const fromTs = marketIdx[0]?.ts ?? null;
  const marketRet = indexValue != null && Number.isFinite(indexValue) ? indexValue - 100 : null;
  const market30 = pctChange(marketIdx, 30);
  const relStrength = (
    [
      ["vs BTC", "BTC"],
      ["vs ETH", "ETH"],
      ["vs S&P 500", "SP500"],
      ["vs NASDAQ", "NASDAQ"],
    ] as const
  ).map(([label, sym]) => {
    const closes = benchCloses[sym] ?? [];
    // Since-inception spread (rebase both to the inception day, subtract returns).
    const rb = fromTs ? rebaseSeries(closes, fromTs, 100) : [];
    const benchRet = rb.length ? rb[rb.length - 1].value - 100 : null;
    const sincePct = marketRet != null && benchRet != null ? marketRet - benchRet : null;
    // 30d spread (both returns over the trailing 30d).
    const bench30 = pctChange(closes, 30);
    const pct = market30 != null && bench30 != null ? market30 - bench30 : null;
    return { label, pct, sincePct };
  });

  const marketIndex = {
    value: indexValue,
    inceptionLabel,
    // Benchmark column now leads with 30d; the header labels the window + tooltips
    // the since-inception figure. Inception day is shared with the index caption.
    relWindowLabel: "30d",
    relSinceLabel: inceptionLabel, // e.g. "since Jan 12"
    deltas: [
      // Price index is weekly → no 24h resolution; null renders "—" rather than
      // mislabeling a weekly move as a 24h change (X3).
      { label: "24h", pct: null },
      { label: "7d", pct: pctChange(marketIdx, 7) },
      { label: "30d", pct: pctChange(marketIdx, 30) },
    ],
    relStrength,
    // Rebased-to-100 daily series for the header's middle-band index chart (QA-5).
    series: fromTs ? rebaseSeries(marketIdx, fromTs, 100) : [],
  };

  // 24h volume split — each platform row carries the components, so the homepage
  // total = marketplace resale + gacha pulls + tokenization (other primary).
  const vAcc = data.platforms.reduce(
    (a, p) => ({
      marketplace: a.marketplace + (p.vol24Usd || 0),
      gacha: a.gacha + (p.gachaVol24Usd ?? 0),
      primary: a.primary + (p.primaryUsd ?? 0),
      total: a.total + (p.total24Usd || 0),
    }),
    { marketplace: 0, gacha: 0, primary: 0, total: 0 },
  );
  const volBreakdown = {
    marketplace: vAcc.marketplace,
    gacha: vAcc.gacha,
    otherPrimary: Math.max(0, vAcc.primary - vAcc.gacha),
    total: vAcc.total,
  };

  // Most-traded IP (24h) for the header's signal strip.
  let topIP: (typeof data.ips)[number] | null = null;
  for (const ip of data.ips) {
    if (Number.isFinite(ip.vol24Usd) && ip.vol24Usd > 0 && (!topIP || ip.vol24Usd > topIP.vol24Usd)) topIP = ip;
  }
  const gachaKpi = { pulls: gacha.hero.totalPulls24h, avgPullUsd: gacha.hero.avgPullUsd };

  return (
    <>
      <NavBar />
      <div className="px-8 pt-8 pb-20 font-sans">
        <div className="mb-9">
          <h1 className="text-[30px] font-bold leading-[1.1] tracking-[-0.02em] md:text-[34px]">
            The market for <span className="text-yellow">phygital</span> collectibles.
          </h1>
          <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-ink-3">
            Live prices, volume, and holders across{" "}
            <span className="tabular text-ink-2">{data.hero.platformsTracked}</span> tokenized trading-card
            platforms and <span className="tabular text-ink-2">{formatCompactNumber(data.hero.totalCards)}</span>{" "}
            collectibles.
          </p>
        </div>

        <MarketHeader
          hero={data.hero}
          index={marketIndex}
          vol={volBreakdown}
          gacha={gachaKpi}
          topIP={topIP}
        />

        <div className="space-y-6">
          <TopSalesPanel items={data.topSales} />
          <TrendingCards cards={trending.rows} windowLabel={trendingWindow} floatAgeLabel={floatAgeLabel} />
          <IPTable rows={data.ips} maxRows={5} seeAllHref="/ips" teaser />
          <PlatformTable rows={data.platforms} maxRows={4} seeAllHref="/platforms" teaser />
        </div>

      </div>
    </>
  );
}
