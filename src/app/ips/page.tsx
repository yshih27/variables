import { unstable_cache } from "next/cache";
import { NavBar } from "@/components/NavBar";
import { CategoryTreemap } from "@/components/CategoryTreemap";
import { IPTable } from "@/components/IPTable";
import { fetchHomepage } from "@/lib/data/fetchHomepage";

const getData = unstable_cache(async () => fetchHomepage(), ["ips-fulllist:v4"], {
  revalidate: 3600,
  tags: ["homepage"],
});

export const dynamic = "force-dynamic";

export const metadata = {
  title: "All IPs · VARIABLE",
  description: "Full list of tokenized-collectible IPs ranked by market cap.",
};

export default async function AllIPsPage() {
  const data = await getData();
  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-[1760px] px-8 pt-10 pb-20 font-sans">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-[12px] text-ink-3">
          <a href="/" className="hover:text-ink-2">Rankings</a>
          <span>›</span>
          <span className="text-ink-2">All IPs</span>
        </div>
        <h1 className="mb-2 text-[32px] font-bold leading-none tracking-[-0.01em]">
          All IPs
        </h1>
        <div className="mb-8 text-[13px] text-ink-3">
          {data.ips.length} IPs / categories ranked by Market Cap.
        </div>
        <CategoryTreemap rows={data.ips} />
        <IPTable rows={data.ips} />
      </div>
    </>
  );
}
