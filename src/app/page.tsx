import { unstable_cache } from "next/cache";
import { NavBar } from "@/components/NavBar";
import { MarketHeader } from "@/components/MarketHeader";
import { TopSalesPanel } from "@/components/TopSalesPanel";
import { IPTable } from "@/components/IPTable";
import { PlatformTable } from "@/components/PlatformTable";
import { fetchHomepage } from "@/lib/data/fetchHomepage";
import { getGachaData } from "@/lib/data/fetchGacha";
import { formatCompactNumber } from "@/lib/format";
import { readMetricSeries, pctChange } from "@/lib/data/metricSnapshots";
import { rebaseSeries, sanitizeStockSeries } from "@/lib/data/indices";

const getHomepageData = unstable_cache(
  async () => fetchHomepage(),
  ["homepage:v40"],
  { revalidate: 3600, tags: ["homepage"] },
);

/** Internal market index = market `mcap_usd` from the spine, sanitized (drop $0
 *  failed-scan readings + a leading orphan seed point) so the rebase anchors to the
 *  true continuous inception rather than a stray pre-history point. */
const getMarketIndexSeries = unstable_cache(
  async () => sanitizeStockSeries(await readMetricSeries("market", "total", "mcap_usd").catch(() => [])),
  ["homepage-market-index:v2"],
  { revalidate: 3600, tags: ["homepage"] },
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

export const dynamic = "force-dynamic";

export default async function Home() {
  const [data, gacha, marketIdx, benchCloses] = await Promise.all([
    getHomepageData(),
    getGachaData(),
    getMarketIndexSeries(),
    getBenchmarkCloses(),
  ]);

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

  // Relative strength = market index return − benchmark return over the SAME window
  // (index inception → latest). Rebase each benchmark to the index inception so both
  // legs share one axis, then subtract. A row is "—" only if its benchmark is missing.
  const fromTs = marketIdx[0]?.ts ?? null;
  const marketRet = indexValue != null && Number.isFinite(indexValue) ? indexValue - 100 : null;
  const relStrength = (
    [
      ["vs BTC", "BTC"],
      ["vs ETH", "ETH"],
      ["vs S&P 500", "SP500"],
      ["vs NASDAQ", "NASDAQ"],
    ] as const
  ).map(([label, sym]) => {
    const rb = fromTs ? rebaseSeries(benchCloses[sym] ?? [], fromTs, 100) : [];
    const benchRet = rb.length ? rb[rb.length - 1].value - 100 : null;
    return { label, pct: marketRet != null && benchRet != null ? marketRet - benchRet : null };
  });

  const marketIndex = {
    value: indexValue,
    inceptionLabel,
    deltas: [
      { label: "24h", pct: pctChange(marketIdx, 1) },
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
          <IPTable rows={data.ips} maxRows={5} seeAllHref="/ips" teaser />
          <PlatformTable rows={data.platforms} maxRows={4} seeAllHref="/platforms" />
        </div>

        <div className="mt-20 text-center text-[12px] text-ink-3">
          VARIABLE · tracking tokenized phygital collectibles across chains
        </div>
      </div>
    </>
  );
}
