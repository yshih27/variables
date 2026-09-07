import { NavBar } from "@/components/NavBar";
import { StatCard, StatCardRow } from "@/components/StatCard";
import { StackedAreaChart, type AreaSeries } from "@/components/StackedAreaChart";
import { PlatformPartners, type PartnerAttribution } from "@/components/PlatformPartners";
import { PlatformMachines } from "@/components/PlatformMachines";
import { EconomicsLeaderboard } from "@/components/economics/EconomicsLeaderboard";
import { RatioTrend } from "@/components/economics/RatioTrend";
import { PlayerConcentration } from "@/components/economics/PlayerConcentration";
import { HeldChip, heldSentence } from "@/components/economics/HeldChip";
import { buildEconomicsBoard } from "@/lib/data/economics";
import { buildMarketTicker } from "@/lib/data/contextStrip";
import { readPlayerAnalytics } from "@/lib/data/playerAnalytics";
import { formatCompactUsd } from "@/lib/format";
import type { SeriesPoint } from "@/lib/data/metricSnapshots";

// ISR: every input is an unstable_cache-backed snapshot read, so per-request
// rendering would be pure waste. Same 30 min as every other overview page.
export const revalidate = 1800;

export const metadata = {
  title: "Platform Economics · VARIBLE",
  description:
    "What a gacha platform keeps: pack-pull spend, R3-counted outbound, the payout-to-spend ratio and player concentration across every tracked venue.",
};

const BAND_COLORS = [
  "var(--color-yellow)",
  "var(--color-blue)",
  "var(--color-purple)",
  "var(--color-teal)",
  "var(--color-solana)",
];

/** Σ two same-day series into a market ratio series, day by day.
 *  ⚠️ Re-derived from the two LEGS, never averaged from per-platform ratios — a
 *  mean of ratios weights a $200 platform like a $2M one. */
function marketRatioDaily(
  spend: SeriesPoint[][],
  outbound: SeriesPoint[][],
): SeriesPoint[] {
  const sum = (rows: SeriesPoint[][]) => {
    const m = new Map<string, number>();
    for (const r of rows) for (const p of r) if (Number.isFinite(p.value)) m.set(p.ts, (m.get(p.ts) ?? 0) + p.value);
    return m;
  };
  const s = sum(spend);
  const o = sum(outbound);
  return [...o.entries()]
    .flatMap(([ts, ov]) => {
      const sv = s.get(ts);
      // Both legs or no point: a day only one side covered is a gap, not 0%.
      return sv != null && sv > 0 ? [{ ts, value: (ov / sv) * 100 }] : [];
    })
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

export default async function EconomicsPage() {
  const [board, ticker, playersSnap] = await Promise.all([
    buildEconomicsBoard(),
    buildMarketTicker(),
    readPlayerAnalytics(),
  ]);

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
  const bands: AreaSeries[] = board.platforms
    .filter((p) => p.spendDaily.length > 0)
    .map((p, i) => ({
      key: p.key,
      label: p.name,
      color: BAND_COLORS[i % BAND_COLORS.length],
      points: p.spendDaily,
    }));
  const ratioOverlay = marketRatioDaily(
    board.platforms.map((p) => p.spendDaily),
    board.platforms.map((p) => p.outboundDaily),
  );

  const partners =
    (playersSnap as { partners?: Record<string, PartnerAttribution> } | null)?.partners?.[
      "collector-crypt"
    ] ?? null;

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
            <StatCard
              label="Gacha spend"
              metric="gacha"
              value={money(board.spend30d)}
              sub={`${board.windowDays} complete days`}
              accent
            />
            <StatCard
              label="R3-counted outbound"
              metric="grossOutbound"
              value={board.outbound30d == null ? "—" : money(board.outbound30d)}
              sub={board.outbound30d == null ? "no publishable payout source" : "players and partners"}
            />
            <StatCard
              label="Payout ÷ spend"
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
              overlay={
                ratioOverlay.length >= 2
                  ? { label: "payout ÷ spend", color: "var(--color-red)", points: ratioOverlay }
                  : undefined
              }
            />
          )}

          {/* ── ZONE 3 — the side pair (different questions, §7) ─────────────
              "Is the payout leg outrunning spend" and "how few people is the
              spend coming from" are two questions, so they may share a row. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <RatioTrend platforms={board.platforms} />
            <PlayerConcentration platforms={board.platforms} />
          </div>

          {/* ── ZONE 4 — the leaderboard ────────────────────────────────────── */}
          <EconomicsLeaderboard platforms={board.platforms} />

          {/* ── ZONE 5 — tiles ──────────────────────────────────────────────
              Both are Collector Crypt's: it is the one platform whose pulls carry
              an originating partner and a machine code. Each renders nothing of
              its own accord when its data is absent. */}
          <PlatformPartners partners={partners} platformKey="collector-crypt" />
          <PlatformMachines board={playersSnap?.machines} platformKey="collector-crypt" />
        </div>
      </div>
    </>
  );
}
