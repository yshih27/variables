import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { GachaBigHitsRail } from "@/components/GachaBigHitsRail";
import { GachaBudgetCompare } from "@/components/GachaBudgetCompare";
import { GachaHouseTake } from "@/components/GachaHouseTake";
import { GachaPlatformDeepDive } from "@/components/GachaPlatformDeepDive";
import { FreshnessChips } from "@/components/FreshnessChip";
import { getGachaData } from "@/lib/data/fetchGacha";
import { formatCompactUsd, formatInt } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Gacha · TCG.market",
  description:
    "Compare gacha mechanics across tokenized-collectibles platforms — pull volumes, pack prices, biggest hits, and expected value.",
};

type GachaData = Awaited<ReturnType<typeof getGachaData>>;

export default async function GachaPage() {
  const data = await getGachaData();

  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-[1400px] px-8 pt-10 pb-24">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-[12px] text-ink-3">
          <a href="/" className="hover:text-ink-2">Rankings</a>
          <span>›</span>
          <span className="text-ink-2">Gacha</span>
        </div>

        <GachaHero data={data} />

        <GachaBigHitsRail hits={data.bigHits ?? []} />

        <GachaBudgetCompare tiers={data.spendTiers ?? []} />

        <GachaHouseTake rows={data.platforms ?? []} />

        <GachaPlatformDeepDive rows={data.platforms ?? []} />

        <div className="mt-16 flex items-center justify-between border-t border-line/60 pt-6 text-[12px] text-ink-3">
          <span>On-chain pull data · refreshed from Dune</span>
          <Link href="/methodology" className="hover:text-yellow">
            How we measure →
          </Link>
        </div>
      </div>
    </>
  );
}

function GachaHero({ data }: { data: GachaData }) {
  const { hero } = data;
  return (
    <header className="mb-10">
      <div className="mb-7 flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-end">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-3">
            Pull Mechanics
          </span>
          <h1 className="text-[44px] font-bold leading-[1.05] tracking-[-0.02em]">
            Find your best <span className="text-yellow">gacha</span> bet.
          </h1>
        </div>
        <FreshnessChips sources={["gacha-dune"]} />
      </div>

      <div className="grid grid-cols-2 gap-x-10 gap-y-7 md:grid-cols-4">
        <HeroCell
          label="Pull Volume 24h"
          value={hero.totalVol24Usd > 0 ? formatCompactUsd(hero.totalVol24Usd) : "—"}
          sub={`across ${hero.platformsWithData} active platform${hero.platformsWithData === 1 ? "" : "s"}`}
          yellow
        />
        <HeroCell
          label="Pulls 24h"
          value={hero.totalPulls24h > 0 ? formatInt(hero.totalPulls24h) : "—"}
          sub={hero.avgPullUsd > 0 ? `avg ${formatCompactUsd(hero.avgPullUsd)} / pull` : undefined}
        />
        <HeroCell
          label="Biggest Hit 7d"
          value={hero.biggestHitUsd ? formatCompactUsd(hero.biggestHitUsd) : "—"}
          sub={hero.biggestHitUsd ? "FMV pulled" : undefined}
          yellow={!!hero.biggestHitUsd}
        />
        <HeroCell
          label="Best-EV Pack"
          value={hero.bestEvPackId ?? "—"}
          sub="realized EV — next"
          dim
        />
      </div>
    </header>
  );
}

function HeroCell({
  label,
  value,
  sub,
  yellow,
  dim,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  yellow?: boolean;
  dim?: boolean;
}) {
  const valueColor = yellow ? "text-yellow" : dim ? "text-ink-3" : "text-ink";
  return (
    <div className="flex flex-col gap-2 px-1 py-1">
      <span className="text-[11px] uppercase tracking-[0.06em] text-ink-3">{label}</span>
      <span className={`text-[28px] font-semibold tracking-[-0.01em] tabular ${valueColor}`}>
        {value}
      </span>
      {sub && (
        <span className={`text-[12px] ${dim ? "text-ink-4" : "text-ink-2"}`}>{sub}</span>
      )}
    </div>
  );
}
