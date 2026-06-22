import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { PlatformIPsTable } from "@/components/PlatformTables";
import { getPlatformDetail } from "@/lib/data/fetchPlatform";

export const dynamic = "force-dynamic";

export default async function PlatformIPsPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const detail = await getPlatformDetail(key);
  if (!detail) notFound();

  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-[1760px] px-8 pt-10 pb-20">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-[12px] text-ink-3">
          <a href="/" className="hover:text-ink-2">Rankings</a>
          <span>›</span>
          <a href={`/platform/${key}`} className="hover:text-ink-2">{detail.source.name}</a>
          <span>›</span>
          <span className="text-ink-2">All IPs</span>
        </div>
        <h1 className="mb-2 text-[32px] font-bold leading-none tracking-[-0.01em]">
          {detail.source.name} · IPs
        </h1>
        <div className="mb-8 text-[13px] text-ink-3">
          {detail.ips.length} IP{detail.ips.length === 1 ? "" : "s"} active on {detail.source.name} in the last 24h.
        </div>
        <PlatformIPsTable rows={detail.ips} />
      </div>
    </>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const detail = await getPlatformDetail(key);
  if (!detail) return { title: "Not found · TCG.market" };
  return {
    title: `${detail.source.name} IPs · TCG.market`,
    description: `All IPs active on ${detail.source.name} in the last 24h.`,
  };
}
