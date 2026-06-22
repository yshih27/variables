import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { PlatformTopCardsTable } from "@/components/PlatformTables";
import { getPlatformDetail } from "@/lib/data/fetchPlatform";

export const dynamic = "force-dynamic";

export default async function PlatformCardsPage({
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
          <span className="text-ink-2">All Cards</span>
        </div>
        <h1 className="mb-2 text-[32px] font-bold leading-none tracking-[-0.01em]">
          {detail.source.name} · Top Cards
        </h1>
        <div className="mb-8 text-[13px] text-ink-3">
          {detail.topCards.length} card{detail.topCards.length === 1 ? "" : "s"} traded on {detail.source.name} in the last 24h, ranked by volume.
        </div>
        <PlatformTopCardsTable rows={detail.topCards} />
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
    title: `${detail.source.name} Cards · TCG.market`,
    description: `Top traded cards on ${detail.source.name} in the last 24h.`,
  };
}
