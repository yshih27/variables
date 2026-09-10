import { notFound } from "next/navigation";
import { StackedAreaChart } from "@/components/StackedAreaChart";
import { CompositionChart } from "@/components/CompositionChart";
import { MetricBarCard } from "@/components/MetricBarCard";
import { buildStatsBoard } from "@/lib/data/statsBoard";
import { buildEconomicsBoard } from "@/lib/data/economics";
import { economicsCoverage, legCountChip } from "@/lib/data/economicsCoverage";
import { getHomeIndexChart } from "@/lib/data/homeIndex";
import { RatioTrend } from "@/components/economics/RatioTrend";
import { PlayerConcentration } from "@/components/economics/PlayerConcentration";
import { MarketIndexChart } from "@/components/MarketIndexChart";
import { economicsHeroModel } from "@/lib/data/economicsHero";
import { EXPORT_HOST } from "@/lib/chart/export";
import { BrandLockup } from "@/components/Brand";
import { EMBED_CHARTS, isEmbedChartId } from "@/lib/chart/embeds";

/**
 * `/embed/[chart]` — one chart, read-only, for an iframe on someone else's page.
 *
 * ⚠️ SAME CACHED READERS AS `/stats`. Both render off `buildStatsBoard`, so an
 * embed cannot show different numbers from the page it was copied from — which is
 * the one failure that would make an embed worse than no embed.
 *
 * ⚠️ NO SHELL, NO NAV, NO ACTIONS. This renders inside someone else's page: the
 * rail, the tape and the export buttons would be noise there, and a nav link out
 * of an iframe is hostile. What it keeps is the receipt — the chart's own honesty
 * note, the as-of date, and the mark linking home.
 *
 * Framing is permitted for THIS route only; see `next.config.ts`.
 */
export const revalidate = 1800;

export async function generateStaticParams() {
  return EMBED_CHARTS.map((chart) => ({ chart }));
}

export async function generateMetadata({ params }: { params: Promise<{ chart: string }> }) {
  const { chart } = await params;
  return { title: `Varible — ${chart}`, robots: { index: false, follow: false } };
}

import { IndexStudio } from "@/components/IndexStudio";
import { readStudioSeed } from "@/lib/studio/seed";

export default async function EmbedPage({ params }: { params: Promise<{ chart: string }> }) {
  const { chart } = await params;
  // Belt-and-braces: the proxy already rewrote an unknown id to a real 404.
  if (!isEmbedChartId(chart)) notFound();
  if (chart === "studio") {
    // The studio reads its series from its seed and the chart bundle; the stats
    // board is not needed for it. Its state (series, window, grain) rides the hash.
    const seed = await readStudioSeed();
    return (
      <div className="flex min-h-screen flex-col bg-bg px-3 py-3 font-sans">
        <div className="min-h-0 flex-1">
          <IndexStudio seed={seed} />
        </div>
        <a
          href="https://varible.rarible.com/ips"
          className="mt-2 self-end font-mono text-[11px] text-ink-4 hover:text-ink-2"
        >
          varible.rarible.com · Index Studio
        </a>
      </div>
    );
  }
  /**
   * ⚠️ THE ECONOMICS EMBEDS READ `buildEconomicsBoard()`, THE PAGE'S OWN CACHED
   * BOARD — not a second derivation. Same rule the stats embeds follow: an embed
   * that computes its own numbers can disagree with the page it was copied from,
   * which is the one failure that makes an embed worse than no embed.
   *
   * ⚠️ NO `chartId` IS PASSED DOWN. An embed does not offer its own embed button,
   * and ChartActions drops it when the id is absent.
   */
  if (chart === "economics-spend" || chart === "economics-ratio" || chart === "economics-players") {
    const eco = await buildEconomicsBoard();
    const ecoAsOf = eco.asOf ? eco.asOf.slice(0, 10) : null;
    return (
      <EmbedFrame asOf={ecoAsOf} href={`https://${EXPORT_HOST}/economics`}>
        {chart === "economics-spend" && <EconomicsSpend board={eco} />}
        {chart === "economics-ratio" && (
          <RatioTrend
            platforms={eco.platforms}
            scope={legCountChip(economicsCoverage(eco), "outbound")}
            actions={false}
          />
        )}
        {chart === "economics-players" && <PlayerConcentration platforms={eco.platforms} asOf={ecoAsOf} actions={false} />}
      </EmbedFrame>
    );
  }

  if (chart === "home-index") {
    const idx = await getHomeIndexChart();
    return (
      <EmbedFrame asOf={idx.asOf ? idx.asOf.slice(0, 10) : null} href={`https://${EXPORT_HOST}/`}>
        <div className="flex h-full flex-col justify-center">
          <div className="text-[13px] font-bold leading-none tracking-[-0.01em] text-ink">
            The Varible Index
          </div>
          {/* actions=false: the export band belongs to the page, not to an iframe
              sitting on someone else's site. */}
          <div className="mt-2">
            <MarketIndexChart points={idx.points} anchor={idx.anchor} actions={false} />
          </div>
          {/* THE RECEIPT — the reason this chart may not travel bare. */}
          {idx.receipt && (
            <p className="mt-1 font-mono text-[10px] leading-snug text-ink-4">{idx.receipt}</p>
          )}
        </div>
      </EmbedFrame>
    );
  }

  const board = await buildStatsBoard();
  const asOf = board.asOf ? board.asOf.slice(0, 10) : null;

  return (
    <EmbedFrame asOf={asOf} href={`https://${EXPORT_HOST}/stats`}>
      <>
        {chart === "market-volume" && board.venueBands.length > 0 && (
          <StackedAreaChart
            title="Market volume by venue"
            readMe="daily turnover per venue — marketplace resale plus gacha"
            subtitle={`Last ${board.windowDays} days · complete days only${asOf ? ` · through ${asOf}` : ""}`}
            metric="total24h"
            series={board.venueBands}
            unit="usd"
            actions={false}
          />
        )}
        {chart === "resale-vs-gacha" && board.resaleVsGacha.length > 0 && (
          <CompositionChart
            title="Resale vs gacha"
            readMe="what the market's turnover actually is — gacha dwarfs resale"
            subtitle={`Last ${board.windowDays} days${asOf ? ` · through ${asOf}` : ""}`}
            metric="total24h"
            series={board.resaleVsGacha}
            unit="usd"
            variant="area"
            flow
            actions={false}
          />
        )}
        {chart === "holders" && (
          <MetricBarCard
            label="Holders"
            metric="holders"
            data={board.holdersDaily}
            unit="count"
            variant="line"
            emptyDetail="deduped daily union — first write pending"
            actions={false}
          />
        )}
      </>
    </EmbedFrame>
  );
}

/**
 * The shell every embed shares: the chart, then the receipt strip.
 *
 * ⚠️ THE STRIP IS NOT DECORATION. An embed that travels without a link back to
 * its source and the date it was true is a screenshot, and a screenshot of a
 * number is how a stale figure outlives the correction.
 */
function EmbedFrame({
  children,
  asOf,
  href,
}: {
  children: React.ReactNode;
  asOf: string | null;
  href: string;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-bg px-3 py-3 font-sans">
      <div className="min-h-0 flex-1">{children}</div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 flex shrink-0 items-center justify-between gap-3 font-mono text-[10px] text-ink-4 transition-colors hover:text-ink-3"
      >
        <BrandLockup className="h-[13px] w-auto" />
        <span>
          {EXPORT_HOST}
          {asOf ? ` · as of ${asOf}` : ""}
        </span>
      </a>
    </div>
  );
}

/** The /economics hero — the page's own model (economicsHero.ts), overlay included. */
function EconomicsSpend({ board }: { board: Awaited<ReturnType<typeof buildEconomicsBoard>> }) {
  const { bands, overlay } = economicsHeroModel(board.platforms);
  if (bands.length === 0) return null;
  const asOf = board.asOf ? board.asOf.slice(0, 10) : null;
  return (
    <StackedAreaChart
      title="Spend and payout pace"
      readMe="pull spend by platform, with payout ÷ spend over it"
      subtitle={`Daily, last ${board.windowDays} complete days${asOf ? ` · through ${asOf}` : ""}`}
      metric="gacha"
      series={bands}
      unit="usd"
      overlay={overlay}
      actions={false}
    />
  );
}
