import { unstable_cache } from "next/cache";
import { NavBar } from "@/components/NavBar";
import { WatchlistView } from "@/components/WatchlistView";
import { fetchHomepage } from "@/lib/data/fetchHomepage";

export const metadata = {
  title: "Watchlist · VARIBLE",
  description: "Your saved categories and platforms — live volume, market cap, and holders.",
};

// ISR like the homepage: the watchlist itself is client-side (localStorage);
// only the row data is server-rendered. Same cache key as the homepage so the
// two pages share one warmed entry.
export const revalidate = 1800;

const getHomepageData = unstable_cache(
  async () => fetchHomepage(),
  ["homepage:v40"],
  { revalidate: 3600, tags: ["homepage"] },
);

export default async function WatchlistPage() {
  const data = await getHomepageData();
  return (
    <>
      <NavBar />
      <div className="px-8 pt-8 pb-20 font-sans">
        <div className="mb-8">
          <h1 className="text-[20px] font-bold leading-none tracking-[-0.01em]">Watchlist</h1>
          <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-ink-3">
            The categories and platforms you follow, with their live stats. Saved in this browser.
          </p>
        </div>
        <WatchlistView ips={data.ips} platforms={data.platforms} />
      </div>
    </>
  );
}
