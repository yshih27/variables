import Link from "next/link";
import { NavBar, type TickerItem } from "@/components/NavBar";
import { GachaHitsTicker } from "@/components/GachaHitsTicker";
import { mapBigHits } from "@/lib/data/gachaHits";
import { GachaPackMatrix } from "@/components/GachaPackMatrix";
import { getGachaPayload } from "@/lib/data/fetchGacha";
import { formatCompactUsd, formatInt } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Gacha · VARIABLE",
  description:
    "Compare gacha mechanics across tokenized-collectibles platforms — pull volumes, pack prices, biggest hits, and expected value.",
};

export default async function GachaPage() {
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
