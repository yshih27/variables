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
      <div className="mx-auto max-w-[1760px] px-8 pt-10 pb-20 font-sans">
        <a href={`/platform/${key}`} className="mb-1.5 inline-block text-[12px] text-ink-3 transition-colors hover:text-yellow">
          ← {detail.source.name}
        </a>
        <h1 className="mb-1.5 text-[20px] font-bold leading-none tracking-[-0.01em]">
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
  if (!detail) return { title: "Not found · VARIBLE" };
  return {
    title: `${detail.source.name} Cards · VARIBLE`,
    description: `Top traded cards on ${detail.source.name} in the last 24h.`,
  };
}
