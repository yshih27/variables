import { unstable_cache } from "next/cache";
import { NavBar } from "@/components/NavBar";
import { PlatformTable } from "@/components/PlatformTable";
import { fetchHomepage } from "@/lib/data/fetchHomepage";

const getData = unstable_cache(
  async () => fetchHomepage(),
  ["platforms-fulllist:v5"],
  { revalidate: 3600, tags: ["homepage"] },
);

export const dynamic = "force-dynamic";

export const metadata = {
  title: "All Platforms · TCG.market",
  description: "Full list of tokenized-collectible platforms ranked by 24h volume.",
};

export default async function AllPlatformsPage() {
  const data = await getData();
  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-[1400px] px-8 pt-10 pb-20">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-[12px] text-ink-3">
          <a href="/" className="hover:text-ink-2">Rankings</a>
          <span>›</span>
          <span className="text-ink-2">All Platforms</span>
        </div>
        <h1 className="mb-2 text-[32px] font-bold leading-none tracking-[-0.01em]">
          All Platforms
        </h1>
        <div className="mb-8 text-[13px] text-ink-3">
          {data.platforms.length} tracked platforms across all chains.
        </div>
        <PlatformTable rows={data.platforms} />
      </div>
    </>
  );
}
