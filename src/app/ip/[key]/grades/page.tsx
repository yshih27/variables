import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { GradesTable } from "@/components/IPTraitTables";
import { getIPDetail } from "@/lib/data/fetchIP";

export const dynamic = "force-dynamic";

export default async function IPGradesPage({
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
      <div className="mx-auto max-w-[1400px] px-8 pt-10 pb-20">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-[12px] text-ink-3">
          <a href="/" className="hover:text-ink-2">Rankings</a>
          <span>›</span>
          <a href={`/ip/${key}`} className="hover:text-ink-2">{detail.ip.name}</a>
          <span>›</span>
          <span className="text-ink-2">All Grades</span>
        </div>
        <h1 className="mb-2 text-[32px] font-bold leading-none tracking-[-0.01em]">
          {detail.ip.name} · Grades
        </h1>
        <div className="mb-8 text-[13px] text-ink-3">
          {detail.grades.length} graded buckets traded in the last 24h.
        </div>
        <GradesTable rows={detail.grades} />
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
  if (!detail) return { title: "Not found · TCG.market" };
  return {
    title: `${detail.ip.name} Grades · TCG.market`,
    description: `Grade distribution for ${detail.ip.name} in the last 24h.`,
  };
}
