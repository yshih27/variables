import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { IPDetailHero, IPDetailStats } from "@/components/IPDetailHero";
import { IPVolumeChart } from "@/components/IPVolumeChart";
import { SetsTable, GradesTable, TopCardsTable } from "@/components/IPTraitTables";
import { getIPDetail } from "@/lib/data/fetchIP";

export const dynamic = "force-dynamic";

export default async function IPDetailPage({
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
        <IPDetailHero detail={detail} />
        <IPDetailStats detail={detail} />
        <IPVolumeChart
          hourlyVol={detail.hourlyVol}
          name={detail.ip.name}
          total={detail.vol24Usd}
        />
        <SetsTable rows={detail.sets} maxRows={10} seeAllHref={`/ip/${key}/sets`} />
        <GradesTable rows={detail.grades} maxRows={10} seeAllHref={`/ip/${key}/grades`} />
        <TopCardsTable rows={detail.topCards} maxRows={10} seeAllHref={`/ip/${key}/cards`} />
        <div className="mt-20 text-center text-[12px] text-ink-3">
          TCG.market · {detail.ip.name} · 24h breakdown
        </div>
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
    title: `${detail.ip.name} · TCG.market`,
    description: `24h breakdown for ${detail.ip.name} across tracked tokenized-collectibles platforms.`,
  };
}
