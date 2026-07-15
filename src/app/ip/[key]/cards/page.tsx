import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { TopCardsTable } from "@/components/IPTraitTables";
import { getIPDetail } from "@/lib/data/fetchIP";

export const dynamic = "force-dynamic";

export default async function IPCardsPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const detail = await getIPDetail(key);
  if (!detail) notFound();

  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-[1760px] px-8 pt-10 pb-20 font-sans">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-[12px] text-ink-3">
          <a href="/" className="hover:text-ink-2">Rankings</a>
          <span>›</span>
          <a href={`/ip/${key}`} className="hover:text-ink-2">{detail.ip.name}</a>
          <span>›</span>
          <span className="text-ink-2">All Cards</span>
        </div>
        <h1 className="mb-2 text-[32px] font-bold leading-none tracking-[-0.01em]">
          {detail.ip.name} · Top Cards
        </h1>
        <div className="mb-8 text-[13px] text-ink-3">
          {detail.topCards.length} cards traded in the last 24h, ranked by volume.
        </div>
        <TopCardsTable rows={detail.topCards} />
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
  const detail = await getIPDetail(key);
  if (!detail) return { title: "Not found · VARIBLE" };
  return {
    title: `${detail.ip.name} Cards · VARIBLE`,
    description: `Top traded cards for ${detail.ip.name} in the last 24h.`,
  };
}
