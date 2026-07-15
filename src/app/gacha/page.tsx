import Link from "next/link";
import { NavBar, type TickerItem } from "@/components/NavBar";
import { GachaHitsTicker } from "@/components/GachaHitsTicker";
import { mapBigHits } from "@/lib/data/gachaHits";
import { GachaPackMatrix } from "@/components/GachaPackMatrix";
import { getGachaPayload } from "@/lib/data/fetchGacha";
import { formatCompactUsd, formatInt } from "@/lib/format";
import { GACHA_ENABLED } from "@/lib/flags";

// ISR: gacha data lands on ~6h warmers, so cached HTML with hourly background
// revalidate is plenty fresh and spares a full re-fetch per request (F8-3).
export const revalidate = 3600;

export const metadata = {
  title: "Gacha · VARIABLE",
  description:
    "Compare gacha mechanics across tokenized-collectibles platforms — pull volumes, pack prices, biggest hits, and expected value.",
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
  // nowMs passed through so the hits band's "ago" + 24h window match between
  // server and client renders (no hydration drift).
  const bigHits = mapBigHits(data.bigHits ?? [], Date.now());
  const { hero } = data;

  // The hero numbers ride the condensing NavBar ticker (homepage pattern) —
  // visible at the top, collapsing away on scroll-down.
  const ticker: TickerItem[] = [];
  if (hero.totalVol24Usd > 0)
    ticker.push({ label: "Pull Vol 24h", value: formatCompactUsd(hero.totalVol24Usd), href: "/gacha" });
  if (hero.totalPulls24h > 0)
    ticker.push({ label: "Pulls 24h", value: formatInt(hero.totalPulls24h), href: "/gacha" });
  if (hero.biggestHitUsd)
    ticker.push({ label: "Biggest Hit 7d", value: formatCompactUsd(hero.biggestHitUsd), href: "/gacha" });
  if (hero.bestEvMultiple != null)
    ticker.push({ label: "Best Typical Return", value: `${hero.bestEvMultiple.toFixed(2)}×`, href: "/gacha" });

  return (
    <>
      <NavBar ticker={ticker} />
      <div className="mx-auto max-w-[1760px] px-8 pt-10 pb-24 font-sans">
        <h1 className="mb-2 text-[44px] font-bold leading-[1.05] tracking-[-0.02em]">
          Find your best gacha <span className="text-yellow">crack</span>.
        </h1>

        <GachaHitsTicker hits={bigHits.hits} windowLabel={bigHits.windowLabel} />

        <GachaPackMatrix packs={data.packs ?? []} prizes={data.prizes ?? []} />

        <div className="mt-16 flex justify-end border-t border-line/60 pt-6 text-[12px] text-ink-3">
          <Link href="/methodology" className="hover:text-yellow">
            How we measure →
          </Link>
        </div>
      </div>
    </>
  );
}
