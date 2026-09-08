import { notFound } from "next/navigation";
import { StackedAreaChart } from "@/components/StackedAreaChart";
import { CompositionChart } from "@/components/CompositionChart";
import { MetricBarCard } from "@/components/MetricBarCard";
import { buildStatsBoard } from "@/lib/data/statsBoard";
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
  const board = await buildStatsBoard();
  const asOf = board.asOf ? board.asOf.slice(0, 10) : null;

  return (
    <div className="flex min-h-screen flex-col bg-bg px-3 py-3 font-sans">
      <div className="min-h-0 flex-1">
        {chart === "market-volume" && board.venueBands.length > 0 && (
          <StackedAreaChart
            title="Market volume by venue"
            readMe="daily turnover per venue — marketplace resale plus gacha"
            subtitle={`Last ${board.windowDays} days · complete days only${asOf ? ` · through ${asOf}` : ""}`}
            metric="total24h"
            series={board.venueBands}
            unit="usd"
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
          />
        )}
      </div>

      {/* The receipt. An embed that travels without its source is a screenshot. */}
      <a
        href={`https://${EXPORT_HOST}/stats`}
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
