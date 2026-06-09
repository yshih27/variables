import { unstable_cache } from "next/cache";
import { NavBar, type TickerItem } from "@/components/NavBar";
import { MarketStatCards } from "@/components/MarketStatCards";
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

  // CoinGecko-style top ticker — each stat links to its page.
  const ticker: TickerItem[] = [
    { label: "Market Cap", value: formatCompactUsd(data.hero.totalMcapUsd), href: "/ips" },
    {
      label: "24h Vol",
      value: data.hero.vol24Usd > 0 ? formatCompactUsd(data.hero.vol24Usd) : "—",
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
      <div className="mx-auto max-w-[1760px] px-8 pt-8 pb-20">
        <div className="mb-9">
          <h1 className="text-[30px] font-bold leading-tight tracking-[-0.01em]">
            The market for <span className="text-yellow">phygital</span> collectibles.
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-3">
            Live prices, volume, and holders across tokenized trading-card platforms.
          </p>
        </div>

        <MarketStatCards hero={data.hero} />

        <section className="mb-10 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.7fr]">
          <HotIPsPanel items={data.hotIPs} />
          <TopSalesPanel items={data.topSales} />
        </section>
        <IPTable rows={data.ips} maxRows={10} seeAllHref="/ips" />
        <PlatformTable rows={data.platforms} />
        <div className="mt-20 text-center text-[12px] text-ink-3">
          TCG.market · tracking tokenized phygital collectibles across chains
        </div>
      </div>
    </>
  );
}
