import { unstable_cache } from "next/cache";
import { NavBar, type TickerItem } from "@/components/NavBar";
import { MarketKpiGrid } from "@/components/MarketKpiGrid";
import { HotIPsPanel } from "@/components/HotIPsPanel";
import { TopSalesPanel } from "@/components/TopSalesPanel";
import { IPTable } from "@/components/IPTable";
import { PlatformTable } from "@/components/PlatformTable";
import { fetchHomepage } from "@/lib/data/fetchHomepage";
import { getGachaData } from "@/lib/data/fetchGacha";
import { formatCompactUsd, formatCompactNumber, formatInt } from "@/lib/format";

const getHomepageData = unstable_cache(
  async () => fetchHomepage(),
  ["homepage:v40"],
  { revalidate: 3600, tags: ["homepage"] },
);

export const dynamic = "force-dynamic";

export default async function Home() {
  const [data, gacha] = await Promise.all([getHomepageData(), getGachaData()]);
  const gachaRips = gacha.hero.totalPulls24h;

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

  // Most-traded IP (24h) for the KPI grid's signal tile.
  let topIP: (typeof data.ips)[number] | null = null;
  for (const ip of data.ips) {
    if (Number.isFinite(ip.vol24Usd) && ip.vol24Usd > 0 && (!topIP || ip.vol24Usd > topIP.vol24Usd)) topIP = ip;
  }
  const gachaKpi = { pulls: gacha.hero.totalPulls24h, avgPullUsd: gacha.hero.avgPullUsd };

  // CoinGecko-style top ticker — each stat links to its page.
  const ticker: TickerItem[] = [
    { label: "Market Cap", value: formatCompactUsd(data.hero.totalMcapUsd), href: "/ips" },
    {
      label: "24h Vol",
      value: volBreakdown.total > 0 ? formatCompactUsd(volBreakdown.total) : "—",
      href: "/platforms",
    },
    { label: "Platforms", value: String(data.hero.platformsTracked), href: "/platforms" },
    { label: "Collectibles", value: formatCompactNumber(data.hero.totalCards), href: "/ips" },
    {
      label: "Gacha Rips",
      value: gachaRips > 0 ? formatInt(gachaRips) : "—",
      href: "/gacha",
    },
  ];

  return (
    <>
      <NavBar ticker={ticker} />
      <div className="mx-auto max-w-[1760px] px-8 pt-8 pb-20 font-sans">
        <div className="mb-9">
          <h1 className="text-[30px] font-bold leading-[1.1] tracking-[-0.02em] md:text-[34px]">
            The market for <span className="text-yellow">phygital</span> collectibles.
          </h1>
          <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-ink-3">
            Live prices, volume, and holders across tokenized trading-card platforms.
          </p>
        </div>

        <MarketKpiGrid hero={data.hero} vol={volBreakdown} gacha={gachaKpi} topIP={topIP} />

        <section className="mb-10 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <HotIPsPanel items={data.hotIPs} />
          <TopSalesPanel items={data.topSales} />
        </section>
        <IPTable rows={data.ips} maxRows={10} seeAllHref="/ips" />
        <PlatformTable rows={data.platforms} />
        <div className="mt-20 text-center text-[12px] text-ink-3">
          VARIABLE · tracking tokenized phygital collectibles across chains
        </div>
      </div>
    </>
  );
}
