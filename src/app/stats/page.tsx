import { NavBar } from "@/components/NavBar";
import { StatCard, StatCardRow } from "@/components/StatCard";
import { StackedAreaChart } from "@/components/StackedAreaChart";
import { CompositionChart } from "@/components/CompositionChart";
import { MetricBarCard } from "@/components/MetricBarCard";
import { IndexStudio } from "@/components/IndexStudio";
import { CiteBlock } from "@/components/CiteBlock";
import { Section } from "@/components/Section";
import { buildStatsBoard } from "@/lib/data/statsBoard";
import { buildMarketTicker } from "@/lib/data/contextStrip";
import { readStudioSeed } from "@/lib/studio/seed";
import { PRICE_INDEX_HOLD, HOLD_REASON_TEXT } from "@/lib/indices/hold";
import { readIndexMeta } from "@/lib/data/indices";
import { formatCompactUsd, formatCompactNumber } from "@/lib/format";

// ISR: every input is an unstable_cache-backed snapshot read.
export const revalidate = 1800;

export const metadata = {
  title: "Market Stats · VARIBLE",
  description:
    "The tokenized trading-card market in public, citable numbers: volume by venue, resale vs gacha, holders and cards tracked — each with its window, its as-of date and a permalink.",
};

export default async function StatsPage() {
  const [board, ticker, seed] = await Promise.all([
    buildStatsBoard(),
    buildMarketTicker(),
    readStudioSeed(),
  ]);

  const asOf = board.asOf ? board.asOf.slice(0, 10) : null;
  const money = (n: number) => (Number.isFinite(n) ? formatCompactUsd(n) : "—");
  const count = (n: number) => (Number.isFinite(n) ? formatCompactNumber(n) : "—");
  const win = `${board.windowDays} days`;
  // Zone 3 held state: the manual switch OR the builder's automatic selection-
  // premium hold, explained with the same sentence every other surface uses.
  const idxMeta = await readIndexMeta("market", "total").catch(() => null);
  const holdReason = PRICE_INDEX_HOLD.active ? ("manual" as const) : (idxMeta?.heldReason ?? null);

  return (
    <>
      <NavBar ticker={ticker} />
      <div className="px-8 pt-6 pb-20 font-sans">
        <h1 className="mb-1 text-[20px] font-bold leading-none tracking-[-0.01em]">Market Stats</h1>
        <p className="mb-3 max-w-2xl text-[13px] leading-relaxed text-ink-3">
          The tokenized trading-card market in numbers built to be quoted — every chart
          exports, every figure carries its window and its as-of date
          {asOf ? `, currently ${asOf}` : ""}.{" "}
          <a href="/methodology" className="text-ink-2 underline-offset-2 hover:text-yellow hover:underline">
            How this is measured →
          </a>
        </p>

        <div className="space-y-3">
          {/* ── The headline figures, each citable ─────────────────────────── */}
          <StatCardRow cols={4}>
            <StatCard label="Gacha volume" metric="gacha" value={money(board.kpis.gacha30d)} sub="30 complete days" accent />
            <StatCard label="Marketplace resale" metric="marketplace" value={money(board.kpis.resale30d)} sub="30 complete days" />
            <StatCard label="Holders" metric="holders" value={count(board.kpis.holders)} sub="deduped across platforms" />
            <StatCard label="Cards tracked" metric="cardsTraded" value={count(board.kpis.cardsTracked)} sub="tokenized and indexed" />
          </StatCardRow>

          {/* ── 1 · Volume by venue ────────────────────────────────────────── */}
          {board.venueBands.length > 0 && (
            <div id="volume-by-venue" className="scroll-mt-20">
              <StackedAreaChart
                title="Market volume by venue"
                readMe="daily turnover per venue — marketplace resale plus gacha"
                subtitle={`Last ${win} · complete days only${asOf ? ` · through ${asOf}` : ""}`}
                metric="total24h"
                series={board.venueBands}
                unit="usd"
                chartId="market-volume"
              />
              <CiteBlock
                figure={money(board.kpis.gacha30d + board.kpis.resale30d)}
                label="Total tokenized trading-card market turnover"
                window="30 complete days"
                asOf={asOf}
                anchor="volume-by-venue"
              />
            </div>
          )}

          {/* ── 2 · Resale vs gacha ────────────────────────────────────────
              ⚠️ TWO FAMILIES, NEVER ONE BLENDED "VOLUME". Gacha is the large
              majority of daily turnover; a single line labelled volume is a gacha
              chart wearing a market label. */}
          {board.resaleVsGacha.length > 0 && (
            <div id="resale-vs-gacha" className="scroll-mt-20">
              <CompositionChart
                title="Resale vs gacha"
                readMe="what the market's turnover actually is — gacha dwarfs resale"
                subtitle={`Last ${win}${asOf ? ` · through ${asOf}` : ""}`}
                metric="total24h"
                series={board.resaleVsGacha}
                unit="usd"
                variant="area"
                flow
                chartId="resale-vs-gacha"
              />
              <CiteBlock
                figure={money(board.kpis.gacha30d)}
                label="Gacha pull volume"
                window="30 complete days"
                asOf={asOf}
                anchor="resale-vs-gacha"
              />
            </div>
          )}

          {/* ── 3 · The index vs benchmarks ────────────────────────────────
              The studio draws the monthly resale-comparables index with its
              bootstrap band; readIndexSeries applies both the manual hold and the
              automatic selection-premium hold, so when either is on this zone
              shows the benchmarks and says why the index line is absent — rather
              than omitting the zone, which would hide that we HAVE an index. */}
          <div id="index" className="scroll-mt-20">
            {holdReason && (
              <Section title="The Varible Index" readMe={HOLD_REASON_TEXT[holdReason].label} flush>
                <p className="px-4 pb-4 text-[12.5px] leading-relaxed text-ink-3 sm:px-5">
                  {HOLD_REASON_TEXT[holdReason].title}{" "}
                  <a href="/methodology#index-bias" className="text-ink-2 underline-offset-2 hover:text-yellow hover:underline">
                    Method →
                  </a>
                </p>
              </Section>
            )}
            <div className={holdReason ? "mt-3" : undefined}>
              <IndexStudio seed={seed} />
            </div>
          </div>

          {/* ── 4 · Holders ────────────────────────────────────────────────── */}
          <div id="holders" className="scroll-mt-20 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MetricBarCard
              label="Holders"
              metric="holders"
              data={board.holdersDaily}
              unit="count"
              variant="line"
              surface="cards:stats"
              embedId="holders"
              emptyDetail="deduped daily union — first write pending"
            />
            <MetricBarCard
              label="Cards tracked"
              metric="cardsTraded"
              data={board.holdersDaily.length ? [] : []}
              unit="count"
              emptyNote="Point-in-time only"
              emptyDetail="cards tracked is a stock with no daily series yet — see the KPI above"
              surface="cards:stats"
            />
          </div>
          <CiteBlock
            figure={count(board.kpis.holders)}
            label="Unique wallets holding a tracked collectible"
            window="latest reading"
            asOf={asOf}
            anchor="holders"
          />
        </div>
      </div>
    </>
  );
}
