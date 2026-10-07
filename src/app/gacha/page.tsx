import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { GachaHitsTicker } from "@/components/GachaHitsTicker";
import { mapBigHits } from "@/lib/data/gachaHits";
import { GachaPackMatrix } from "@/components/GachaPackMatrix";
import { getGachaPayload } from "@/lib/data/fetchGacha";
import { formatCompactUsd, formatInt } from "@/lib/format";
import { GACHA_ENABLED } from "@/lib/flags";
import { ReadMe } from "@/components/Section";
import { StatCard, StatCardRow } from "@/components/StatCard";
import { venuesOf } from "@/lib/gacha/venueView";
import { PLATFORM_SOURCES } from "@/lib/data/sources";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 3" (UTC) — a date the payload carries, never the render clock. */
function dayUtc(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// ISR: gacha data lands on ~6h warmers, so cached HTML with hourly background
// revalidate is plenty fresh and spares a full re-fetch per request (F8-3).
export const revalidate = 3600;

export const metadata = {
  title: "Packs, machines, claws and boxes · VARIBLE",
  description:
    "Every tokenized-collectibles venue's packs, machines, claws and boxes side by side: what a pull costs, what pulls have paid back, stated odds, and what is in each pool, with the basis of every figure.",
};

export default async function GachaPage() {
  // Gated (default): render a clean placeholder INSTEAD of the live ticker + pack
  // matrix. This is the surface that actually protects optics — /gacha stays
  // reachable by direct URL, so the nav-link hide alone wouldn't be enough. The
  // real components stay imported (used below) so relaunch is one flag flip.
  if (!GACHA_ENABLED) {
    return (
      <>
        <NavBar />
        <div className="mx-auto max-w-[1760px] px-8 pt-10 pb-24 font-sans">
          <div className="flex min-h-[52vh] flex-col items-center justify-center text-center">
            <h1 className="text-[40px] font-bold leading-[1.05] tracking-[-0.02em] md:text-[44px]">
              Gacha analytics — <span className="text-yellow">coming soon</span>.
            </h1>
            <p className="mt-4 max-w-md text-[14px] leading-relaxed text-ink-3">
              Pull odds, expected value, and realized returns across every platform, in one place.
            </p>
          </div>
        </div>
      </>
    );
  }

  const data = await getGachaPayload();
  // The hits window is chosen against the payload's OWN time (when the hits were
  // read), never the render clock: the page is cached for an hour, and ages are
  // computed in the browser (Ago) so they cannot freeze inside that HTML.
  const hitsAsOf = data.hitsAsOf ?? data.generatedAt ?? null;
  const bigHits = mapBigHits(data.bigHits ?? [], hitsAsOf ? Date.parse(hitsAsOf) : 0);
  const { hero } = data;
  const venues = venuesOf(data.venues, data.packs ?? []);
  // The pull behind the "Biggest pull" figure — the same hit, so the value and
  // the name beneath it cannot describe two different pulls.
  const topHit = hero.biggestHitUsd ? (data.bigHits ?? []).find((h) => h.valueUsd === hero.biggestHitUsd) ?? null : null;
  const topHitVenue = topHit ? PLATFORM_SOURCES.find((p) => p.key === topHit.platform)?.name ?? topHit.platform : null;
  // The pack behind "best typical return". ⚠️ MEASURED Oct 7: the payload's
  // `bestEvPackId` carries the pack's NAME ("PKMN 50"), not its id — so it is
  // resolved by id, else by name on the stated venue, and the card links to it.
  const bestPack = hero.bestEvPackId
    ? (data.packs ?? []).find((p) => p.id === hero.bestEvPackId) ??
      (data.packs ?? []).find((p) => p.name === hero.bestEvPackId && (!hero.bestEvPlatform || p.platformName === hero.bestEvPlatform)) ??
      null
    : null;

  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-[1760px] px-4 pt-8 pb-24 font-sans sm:px-8">
        <header className="mb-6">
          <h1 className="text-[30px] font-bold leading-[1.1] tracking-[-0.02em] md:text-[36px]">
            Packs, machines, claws and boxes, <span className="text-yellow">compared</span>.
          </h1>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-3">
            What a pull costs on each venue, what pulls have paid back, and what is in each pool. Every figure
            carries its basis: the venue&apos;s own claim, or measured on-chain with its sample size.
          </p>
          <ReadMe className="mt-2">every venue&apos;s pulls side by side, each figure with its basis</ReadMe>
        </header>

        {/* The figures that used to ride the NavBar ticker (which the shell no
            longer draws), each linking to what it summarises. A withheld figure
            is never headlined: the row shows the next one instead. */}
        <StatCardRow cols={4}>
          <StatCard
            label="Pull spend · 24h"
            value={hero.totalVol24Usd > 0 ? formatCompactUsd(hero.totalVol24Usd) : "—"}
            sub={
              hero.platformsWithData
                ? `${hero.platformsWithData} venue${hero.platformsWithData === 1 ? "" : "s"} with data${hero.topPlatformName ? ` · most: ${hero.topPlatformName}` : ""}`
                : "no venue reported pulls in the last 24h"
            }
            href="/platforms"
          />
          <StatCard
            label="Pulls · 24h"
            value={hero.totalPulls24h > 0 ? formatInt(hero.totalPulls24h) : "—"}
            sub={hero.avgPullUsd > 0 ? `${formatCompactUsd(hero.avgPullUsd)} average pull` : "no pulls counted"}
            href="#matrix"
          />
          <StatCard
            label="Biggest pull"
            value={hero.biggestHitUsd ? formatCompactUsd(hero.biggestHitUsd) : "—"}
            sub={topHit ? `${topHit.name.replace(/^\d{4}\s+/, "")} · ${topHitVenue} · pulled ${dayUtc(topHit.at)}` : "no realized pull in the feed"}
            href="#hits"
          />
          {hero.bestEvMultiple != null && bestPack ? (
            <StatCard
              label="Best typical return"
              value={`${hero.bestEvMultiple.toFixed(2)}×`}
              sub={`${bestPack.platformName} · ${bestPack.name} · median × buyback${bestPack.realizedValueBasis ? `, in ${bestPack.realizedValueBasis}` : ""}${bestPack.realizedN ? ` · n ${bestPack.realizedN}` : ""}`}
              href={`#pack=${encodeURIComponent(bestPack.id)}`}
            />
          ) : (
            // Withheld (or no measured pack): the next figure, not a dash.
            <StatCard
              label="Venues compared"
              value={formatInt(venues.filter((v) => v.covered).length)}
              sub={`${formatInt((data.packs ?? []).filter((p) => !p.notDirectlyComparable && p.priceUsd > 0).length)} priced products in the matrix`}
              href="#matrix"
            />
          )}
        </StatCardRow>

        <div id="hits" className="scroll-mt-24">
          <GachaHitsTicker hits={bigHits.hits} windowLabel={bigHits.windowLabel} source={data.hitsSource ?? null} asOf={hitsAsOf} />
        </div>

        <GachaPackMatrix packs={data.packs ?? []} prizes={data.prizes ?? []} venues={venues} />

        <div className="mt-16 flex justify-end border-t border-line/60 pt-6 text-[12px] text-ink-3">
          <Link href="/methodology" className="hover:text-yellow">
            How we measure →
          </Link>
        </div>
      </div>
    </>
  );
}
