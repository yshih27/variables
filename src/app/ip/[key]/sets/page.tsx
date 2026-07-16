import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { SetsTable } from "@/components/IPTraitTables";
import { getIPDetail } from "@/lib/data/fetchIP";

export const dynamic = "force-dynamic";

export default async function IPSetsPage({
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
          {detail.ip.name} · Sets
        </h1>
        <div className="mb-8 text-[13px] text-ink-3">
          {detail.sets.length} sets traded in the last 24h.
        </div>
        <SetsTable rows={detail.sets} />
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
    title: `${detail.ip.name} Sets · VARIBLE`,
    description: `All sets traded for ${detail.ip.name} in the last 24h.`,
  };
}
