import Link from "next/link";
import type { HeroStats, IPRow } from "@/lib/types";
import { SectionShell } from "./Section";
import { IPIcon } from "./IPIcon";
import { Sparkline } from "./Sparkline";
import { MarketIndexChart } from "./MarketIndexChart";
import { MetricInfo } from "./MetricInfo";
import { tickerOf } from "@/lib/indices/naming";
import type { MetricKey } from "@/lib/metrics/glossary";
import { formatCompactUsd, formatCompactNumber, formatInt, deltaDir, formatDelta } from "@/lib/format";
import { GACHA_ENABLED } from "@/lib/flags";
import { VolumeBar, type VolBreakdown } from "./VolumeBar";

export type { VolBreakdown };
export type GachaKpi = { pulls: number; avgPullUsd: number };

/**
 * MarketHeader (F-R1) — the homepage's single market-summary module. Collapses
 * the old MarketScorecard + two KPI cards + four-stat row into one frame so the
 * market's numbers are stated ONCE, with a clear hierarchy:
 *
 *   • one hero number — total market cap (yellow, biggest);
 *   • its change over explicit windows (24h / 7d / 30d) beside it, plus the
 *     rebased index + "since {inception}" caption below — so the "+9.2% since
 *     May 14" and the "−8.0% 24h" read as two different windows of the SAME
 *     quantity, not a contradiction;
 *   • the 24h volume breakdown bar (marketplace / gacha / other primary);
 *   • a slim strip of secondary signals (holders / trades / gacha / most-traded).
 *
 * The "vs benchmarks" column stays hidden until B1's benchmark deltas populate
 * `index.relStrength` — no rows of "—" on the hero module. Everything derives
 * from one series (the market mcap spine) so the windows never disagree.
 */
export type MarketDelta = { label: string; pct: number | null };
/** Relative-strength row: leads with the windowed spread (`pct`, e.g. 30d) and
 *  carries the since-inception spread (`sincePct`) for the tooltip/secondary. */
export type RelDelta = { label: string; pct: number | null; sincePct?: number | null };

export type MarketIndex = {
  /** Market mcap rebased to 100 at inception; null until the spine has data. */
  value: number | null;
  /** e.g. "since May 14" — the honest index-inception note. */
  inceptionLabel: string | null;
  /** 24h / 7d / 30d change of the market index. */
  deltas: MarketDelta[];
  /** vs BTC / ETH / S&P / NASDAQ — hidden entirely until at least one is real. */
  relStrength: RelDelta[];
  /** Window the benchmark spreads are measured over (R4-1), e.g. "30d". */
  relWindowLabel?: string;
  /** Secondary window for the since-inception spread tooltip, e.g. "since Jan 12". */
  relSinceLabel?: string | null;
  /** Full rebased-to-100 daily index series for the header's middle-band chart
   *  (QA-5); the desktop chart hides when this has <2 points. */
  series?: { ts: string; value: number }[];
};

export function MarketHeader({
  hero,
  index,
  vol,
  gacha,
  topIP,
}: {
  hero: HeroStats;
  index: MarketIndex;
  vol: VolBreakdown;
  gacha: GachaKpi;
  topIP: IPRow | null;
}) {
  const sinceInception = index.value != null ? index.value - 100 : null;
  // QA-7 — only ever show change / benchmark rows that have a real value; a lone
  // "30d —" (index younger than 30d) reads as broken, so it's filtered out.
  const changeDeltas = index.deltas.filter((d) => d.pct != null && Number.isFinite(d.pct));
  const relDeltas = index.relStrength.filter((d) => d.pct != null && Number.isFinite(d.pct));
  const hasRel = relDeltas.length > 0;
  const hasChart = !!index.series && index.series.length >= 2;
  // Change / benchmark clusters hug the right as tight, content-width columns; on
  // wide (lg) screens the market-index chart (QA-5) fills the middle so the hero
  // shrinks to content. Below lg the chart hides and the hero fills the row.
  const mdCols = hasRel ? "md:grid-cols-[minmax(0,1fr)_auto_auto]" : "md:grid-cols-[minmax(0,1fr)_auto]";
  const lgCols = hasChart
    ? hasRel
      ? "lg:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
      : "lg:grid-cols-[auto_minmax(0,1fr)_auto]"
    : hasRel
      ? "lg:grid-cols-[minmax(0,1fr)_auto_auto]"
      : "lg:grid-cols-[minmax(0,1fr)_auto]";

  return (
    // The headerless variant of the shared Section frame (D1) — the hero number
    // is its own title.
    <SectionShell className="mb-9">
      {/* Row 1 — hero market cap, the index chart, its change, and vs-benchmarks. */}
      <div className={`grid grid-cols-1 gap-x-8 gap-y-6 px-6 py-6 ${mdCols} ${lgCols}`}>
        <div className="min-w-0">
          <Label info="marketCap">Total market cap</Label>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-[40px] font-bold leading-none tracking-[-0.02em] tabular text-yellow">
              {formatCompactUsd(hero.totalMcapUsd)}
            </span>
            {/* Sparkline is a stand-in below lg; the full chart takes over at lg. */}
            {hero.mcapSpark && hero.mcapSpark.length >= 2 && (
              <span className="lg:hidden">
                <Sparkline
                  data={hero.mcapSpark}
                  trend={changeDeltas[0]?.pct != null ? (changeDeltas[0].pct > 0 ? "up" : changeDeltas[0].pct < 0 ? "down" : "flat") : "flat"}
                  width={130}
                  height={38}
                />
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-ink-3">
            {index.value != null && Number.isFinite(index.value) ? (
              <>
                <span className="inline-flex items-center gap-1">
                  {tickerOf("market", "total")}{" "}
                  <span className="tabular font-semibold text-ink-2">{index.value.toFixed(1)}</span>
                  <MetricInfo metric="variableIndex" />
                </span>
                {sinceInception != null && Number.isFinite(sinceInception) && (
                  <>
                    <Delta pct={sinceInception} />
                    {index.inceptionLabel && <span className="text-ink-4">{index.inceptionLabel}</span>}
                  </>
                )}
              </>
            ) : (
              <span className="text-ink-4">rebased index building</span>
            )}
          </div>
        </div>

        {/* Market-index chart — fills the middle band on wide screens only. */}
        {hasChart && (
          <div className="hidden min-w-0 lg:flex lg:flex-col lg:justify-center">
            <MarketIndexChart points={index.series!} />
          </div>
        )}

        {changeDeltas.length > 0 && (
          <div className="md:border-l md:border-line md:pl-8">
            <Label>Change</Label>
            <div className="mt-3 flex flex-col gap-2.5">
              {changeDeltas.map((d) => (
                <DeltaRow key={d.label} label={d.label} pct={d.pct} />
              ))}
            </div>
          </div>
        )}

        {hasRel && (
          <div className="md:border-l md:border-line md:pl-8">
            <div className="flex items-baseline gap-1.5">
              <Label info="vsBenchmarks">vs benchmarks</Label>
              {index.relWindowLabel && (
                <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-ink-4">
                  {index.relWindowLabel}
                </span>
              )}
            </div>
            <div className="mt-3 flex flex-col gap-2.5">
              {relDeltas.map((d) => (
                <RelRow key={d.label} rel={d} sinceLabel={index.relSinceLabel ?? null} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Row 2 — 24h volume, split by source (per-segment 24h %Δ). */}
      <VolumeBar vol={vol} marketplacePct={hero.vol24Pct} gachaPct={hero.gachaVol24Pct} />

      {/* Row 3 — slim secondary-signal strip; every cell links into its page. */}
      <div className="grid grid-cols-2 border-t border-line md:grid-cols-4">
        {/* Gacha section gated → keep the market signal as a plain stat, but drop the
            link into the gated /gacha surface (href undefined → no anchor). */}
        <StatCell
          href={GACHA_ENABLED ? "/gacha" : undefined}
          label="Gacha rips · 24h"
          value={gacha.pulls > 0 ? formatInt(gacha.pulls) : "—"}
          sub={gacha.avgPullUsd > 0 ? `avg ${formatCompactUsd(gacha.avgPullUsd)}` : undefined}
          accent
        />
        <StatCell
          href="/platforms"
          label="Holders"
          value={Number.isFinite(hero.holders) && hero.holders > 0 ? formatInt(hero.holders) : "—"}
          deltaPct={pct(hero.holdersPct7d)}
          deltaLabel="7d"
        />
        <StatCell
          href="/platforms"
          label="Trades · 24h"
          value={hero.trades24h > 0 ? formatCompactNumber(hero.trades24h) : "—"}
          deltaPct={pct(hero.trades24hPct)}
        />
        <EntityCell topIP={topIP} />
      </div>
    </SectionShell>
  );
}

/** Hero `*Pct*` fields are fractions (like mcapPct24h) → percent for the badge. */
const pct = (frac: number | null) => (frac != null && Number.isFinite(frac) ? frac * 100 : null);

function StatCell({
  href,
  label,
  value,
  deltaPct,
  deltaLabel,
  sub,
  accent,
}: {
  /** Omit to render a plain stat (no navigation) — used for the gated gacha cell. */
  href?: string;
  label: string;
  value: string;
  deltaPct?: number | null;
  deltaLabel?: string;
  sub?: string;
  accent?: boolean;
}) {
  const inner = (
    <>
      <Label>{label}</Label>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span
          className={`text-[19px] font-bold leading-none tabular transition-colors group-hover:text-yellow ${accent ? "text-yellow" : ""}`}
        >
          {value}
        </span>
        {deltaPct != null && Number.isFinite(deltaPct) && (
          <span className="flex items-center gap-1">
            <Delta pct={deltaPct} />
            {deltaLabel && <span className="text-[11px] text-ink-4">{deltaLabel}</span>}
          </span>
        )}
        {sub && <span className="text-[11.5px] text-ink-3">{sub}</span>}
      </div>
    </>
  );
  // No href → a plain stat, not a link: same figure, no navigation into the gated
  // surface, no hover affordance. Keeps the 4-up strip balanced.
  if (!href) {
    return (
      <div className="flex flex-col gap-2 border-line px-5 py-4 odd:border-r md:[&:not(:last-child)]:border-r">
        {inner}
      </div>
    );
  }
  return (
    <Link
      href={href}
      className="group relative flex flex-col gap-2 border-line px-5 py-4 transition-colors odd:border-r hover:bg-bg-2 md:[&:not(:last-child)]:border-r"
    >
      {/* Corner ↗ so the card reads as "navigates," not a chart toggle (Q7). */}
      <span aria-hidden className="absolute right-3 top-3 text-[11px] leading-none text-ink-4 transition-colors group-hover:text-yellow">
        ↗
      </span>
      {inner}
    </Link>
  );
}

function EntityCell({ topIP }: { topIP: IPRow | null }) {
  if (!topIP) {
    return (
      <div className="flex flex-col gap-2 px-5 py-4">
        <Label>Most traded · 24h</Label>
        <span className="text-[19px] font-bold leading-none text-ink-3">—</span>
      </div>
    );
  }
  return (
    <Link href={`/ip/${topIP.key}`} className="group relative flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-bg-2">
      {/* Corner ↗ so the card reads as "navigates," not a chart toggle (Q7). */}
      <span aria-hidden className="absolute right-3 top-3 text-[11px] leading-none text-ink-4 transition-colors group-hover:text-yellow">
        ↗
      </span>
      <Label>Most traded · 24h</Label>
      <div className="flex items-center gap-2.5">
        <IPIcon
          name={topIP.name}
          short={topIP.short}
          color={topIP.color}
          logo={topIP.logo}
          iconBlendMode={topIP.iconBlendMode}
          emoji={topIP.emoji}
          size={24}
        />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-bold leading-tight transition-colors group-hover:text-yellow">
            {topIP.name}
          </div>
          <div className="mt-0.5 font-mono text-[11.5px] tabular text-ink-2">
            {topIP.vol24Usd > 0 ? formatCompactUsd(topIP.vol24Usd) : "—"}
          </div>
        </div>
      </div>
    </Link>
  );
}

function Label({ children, info }: { children: React.ReactNode; info?: MetricKey }) {
  return (
    <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">
      {children}
      {info && <MetricInfo metric={info} />}
    </div>
  );
}

/** Benchmark spread row — leads with the windowed value; the since-inception
 *  spread rides a title tooltip so the huge 6-month number is available but
 *  doesn't dominate (R4-1). */
function RelRow({ rel, sinceLabel }: { rel: RelDelta; sinceLabel: string | null }) {
  const since =
    rel.sincePct != null && Number.isFinite(rel.sincePct)
      ? `${rel.sincePct > 0 ? "+" : ""}${rel.sincePct.toFixed(1)}% ${sinceLabel ?? "since inception"}`
      : null;
  return (
    <div className="flex items-center justify-between gap-4 text-[13px]" title={since ?? undefined}>
      <span className="text-ink-3">{rel.label}</span>
      {rel.pct == null || !Number.isFinite(rel.pct) ? (
        <span className="font-mono text-ink-4">—</span>
      ) : (
        <Delta pct={rel.pct} />
      )}
    </div>
  );
}

function DeltaRow({ label, pct }: { label: string; pct: number | null }) {
  return (
    <div className="flex items-center justify-between gap-4 text-[13px]">
      <span className="text-ink-3">{label}</span>
      {pct == null || !Number.isFinite(pct) ? (
        <span className="font-mono text-ink-4">—</span>
      ) : (
        <Delta pct={pct} />
      )}
    </div>
  );
}

function Delta({ pct }: { pct: number }) {
  const dir = deltaDir(pct);
  const cls = dir === "up" ? "text-green" : dir === "down" ? "text-red" : "text-ink-3";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "·";
  return (
    <span className={`flex items-center gap-1 text-[13px] font-semibold tabular ${cls}`}>
      <span className="text-[10px]">{arrow}</span>
      {formatDelta(pct)}
    </span>
  );
}
