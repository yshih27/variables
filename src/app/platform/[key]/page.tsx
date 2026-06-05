import { notFound } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import {
  PlatformDetailHero,
  PlatformDetailStats,
} from "@/components/PlatformDetailHero";
import { IPVolumeChart } from "@/components/IPVolumeChart";
import {
  PlatformIPsTable,
  PlatformTopCardsTable,
  RecentSalesTable,
} from "@/components/PlatformTables";
import { getPlatformDetail } from "@/lib/data/fetchPlatform";

export const dynamic = "force-dynamic";

export default async function PlatformDetailPage({
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
      <div className="mx-auto max-w-[1400px] px-8 pt-10 pb-20">
        <PlatformDetailHero detail={detail} />
        <PlatformDetailStats detail={detail} />
        <IPVolumeChart hourlyVol={detail.hourlyVol} name={detail.source.name} />
        <PlatformIPsTable
          rows={detail.ips}
          maxRows={10}
          seeAllHref={`/platform/${key}/ips`}
        />
        <PlatformTopCardsTable
          rows={detail.topCards}
          maxRows={10}
          seeAllHref={`/platform/${key}/cards`}
        />
        <RecentSalesTable
          rows={detail.recentSales}
          maxRows={10}
          seeAllHref={`/platform/${key}/sales`}
        />
        <div className="mt-20 text-center text-[12px] text-ink-3">
          TCG.market · {detail.source.name} · 24h breakdown
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
  const detail = await getPlatformDetail(key);
  if (!detail) return { title: "Not found · TCG.market" };
  return {
    title: `${detail.source.name} · TCG.market`,
    description: `24h breakdown for ${detail.source.name} (${detail.chain}) on TCG.market.`,
  };
}
