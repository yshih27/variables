import { NavBar } from "@/components/NavBar";
import { StatCard, StatCardRow } from "@/components/StatCard";
import { StackedAreaChart } from "@/components/StackedAreaChart";
import { EconomicsLeaderboard } from "@/components/economics/EconomicsLeaderboard";
import { CoverageMatrix } from "@/components/economics/CoverageMatrix";
import { RatioTrend } from "@/components/economics/RatioTrend";
import { PlayerConcentration } from "@/components/economics/PlayerConcentration";
import { HeldChip, heldSentence } from "@/components/economics/HeldChip";
import { buildEconomicsBoard } from "@/lib/data/economics";
import {
  economicsCoverage,
  legScope,
  legVenueScope,
  legCountChip,
} from "@/lib/data/economicsCoverage";
import { buildMarketTicker } from "@/lib/data/contextStrip";
import { formatCompactUsd } from "@/lib/format";
import { economicsHeroModel } from "@/lib/data/economicsHero";

// ISR: every input is an unstable_cache-backed snapshot read, so per-request
// rendering would be pure waste. Same 30 min as every other overview page.
export const revalidate = 1800;

export const metadata = {
  title: "Platform Economics · VARIBLE",
  description:
    "What a gacha platform keeps: pack-pull spend, R3-counted outbound, the payout-to-spend ratio and player concentration across every tracked venue.",
};

export default async function EconomicsPage() {
  const [board, ticker] = await Promise.all([buildEconomicsBoard(), buildMarketTicker()]);

  /**
   * Coverage, derived once and shared by the strip's labels, the ratio zone's
   * chip and the matrix at the foot — so the page cannot state three different
   * scopes for the same leg. No new data: it is a projection of `board`.
   */
  const coverage = economicsCoverage(board);

  const money = (n: number) => (Number.isFinite(n) ? formatCompactUsd(n) : "—");
  const pct = (n: number | null) => (n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(1)}%`);

  // Ratio trend for the KPI: this window's ratio against the prior window's, in
  // PERCENTAGE POINTS. Deliberately not a percent-of-a-percent, which is the
  // classic way to make a 2pp move read as 2%.
  const ratioDeltaPp =
    board.ratioPct30d != null && board.ratioPctPrior30d != null
      ? board.ratioPct30d - board.ratioPctPrior30d
      : null;

  // ── Hero bands: spend per platform, plus the market ratio as an overlay ────
  // One model for the page and /embed/economics-spend (economicsHero.ts), so the
  // embed draws the overlay its readMe promises.
  const { bands, overlay: ratioOverlay } = economicsHeroModel(board.platforms);

  const asOf = board.asOf ? board.asOf.slice(0, 10) : null;
  const held = board.heldReasons;

  return (
    <>
      <NavBar ticker={ticker} />
      <div className="px-8 pt-6 pb-20 font-sans">
        <h1 className="mb-1 text-[20px] font-bold leading-none tracking-[-0.01em]">
          Platform Economics
        </h1>
        <p className="mb-3 max-w-2xl text-[13px] leading-relaxed text-ink-3">
          What a gacha platform takes in, what leaves its wallets, and what that ratio is
          doing — over {board.windowDays} complete days
          {asOf ? `, through ${asOf}` : ""}.{" "}
          <a href="/methodology#economics" className="text-ink-2 underline-offset-2 hover:text-yellow hover:underline">
            How this is measured →
          </a>
        </p>

        <div className="space-y-3">
          {/* ── ZONE 1 — the KPI strip ───────────────────────────────────────
              Market-wide over platforms WITH a payout source. The net card is the
              page's thesis: it is a held receipt, not a number, and it says which
              hold and why. */}
          <StatCardRow cols={4}>
            {/* ⚠️ EVERY LABEL SAYS WHOSE NUMBER IT IS, and says it from the board.
                Spend is market-wide; outbound and the ratio are one venue's today.
                The scopes are computed, so the day a second payout wallet becomes
                countable these labels move on their own — including the ratio's,
                which names a venue only while there is exactly one to name. */}
            <StatCard
              label={`Gacha spend · ${legScope(coverage, "spend")}`}
              metric="gacha"
              value={money(board.spend30d)}
              sub={`${board.windowDays} complete days`}
              accent
            />
            <StatCard
              label={`Outbound · ${legScope(coverage, "outbound")}`}
              metric="grossOutbound"
              value={board.outbound30d == null ? "—" : money(board.outbound30d)}
              sub={
                board.outbound30d == null
                  ? "no publishable payout source"
                  : "R3-counted · players and partners"
              }
            />
            <StatCard
              label={`Payout ÷ spend · ${legVenueScope(coverage, "outbound")}`}
              metric="ratio"
              value={pct(board.ratioPct30d)}
              deltaPct={ratioDeltaPp}
              deltaLabel="pp vs prior 30d"
              sub="above 100% = more left than came in"
            />
            {/* ⚠️ NEVER A NUMBER WHILE HELD. `board.net30d` is null whenever any
                contributor is held, so this branch cannot print a figure it is not
                allowed to — the constraint lives in the data, not in this JSX. */}
            <StatCard
              label="Net"
              metric="held"
              value={board.net30d == null ? "held" : money(board.net30d)}
              sub={
                board.net30d == null ? (
                  <span className="flex flex-col gap-1">
                    <HeldChip reasons={held} />
                    <span>{heldSentence(held) ?? "not yet publishable"}</span>
                  </span>
                ) : (
                  "spend − R3-counted payouts"
                )
              }
            />
          </StatCardRow>

          {/* ── ZONE 2 — the hero canvas ────────────────────────────────────
              One question: where is the pull money coming from, and is the payout
              leg keeping pace. The ratio rides as an overlay rather than a second
              chart (one question per zone). */}
          {bands.length > 0 && (
            <StackedAreaChart
              title="Spend and payout pace"
              readMe="pull spend by platform, with payout ÷ spend over it"
              subtitle={`Daily, last ${board.windowDays} complete days${asOf ? ` · through ${asOf}` : ""}`}
              metric="gacha"
              series={bands}
              unit="usd"
              grainSurface="chart:economics-hero"
              chartId="economics-spend"
              overlay={ratioOverlay}
            />
          )}

          {/* ── ZONE 3 — the side pair (different questions, §7) ─────────────
              "Is the payout leg outrunning spend" and "how few people is the
              spend coming from" are two questions, so they may share a row. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <RatioTrend
              platforms={board.platforms}
              scope={legCountChip(coverage, "outbound")}
              chartId="economics-ratio"
            />
            <PlayerConcentration platforms={board.platforms} chartId="economics-players" asOf={asOf} />
          </div>

          {/* ── ZONE 4 — the leaderboard ────────────────────────────────────── */}
          <EconomicsLeaderboard platforms={board.platforms} />

          {/* ── ZONE 5 — coverage ────────────────────────────────────────────
              Was two Collector Crypt tiles (partners, machines). Both are that
              venue's own features and both already live on
              /platform/collector-crypt; closing a market page with them is what
              made the whole surface read as one venue's breakdown. What belongs
              here instead is the page's own scope, stated. */}
          <CoverageMatrix coverage={coverage} />
        </div>
      </div>
    </>
  );
}
