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
        <a href={`/ip/${key}`} className="mb-1.5 inline-block text-[12px] text-ink-3 transition-colors hover:text-yellow">
          ← {detail.ip.name}
        </a>
        <h1 className="mb-1.5 text-[20px] font-bold leading-none tracking-[-0.01em]">
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
