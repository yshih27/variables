import { unstable_cache } from "next/cache";
import { NavBar } from "@/components/NavBar";
import { Hero } from "@/components/Hero";
import { ChainFilter } from "@/components/ChainFilter";
import { HotIPsPanel } from "@/components/HotIPsPanel";
import { TopSalesPanel } from "@/components/TopSalesPanel";
import { IPTable } from "@/components/IPTable";
import { PlatformTable } from "@/components/PlatformTable";
import { fetchHomepage } from "@/lib/data/fetchHomepage";

const getHomepageData = unstable_cache(
  async () => fetchHomepage(),
  ["homepage:v37"],
  { revalidate: 3600, tags: ["homepage"] },
);

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await getHomepageData();

  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-[1400px] px-8 pt-10 pb-20">
        <Hero stats={data.hero} />
        <ChainFilter chains={["Polygon", "Base", "Solana"]} />
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
