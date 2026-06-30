import Link from "next/link";
import type { HeroStats, Trend, IPRow } from "@/lib/types";
import { Sparkline } from "./Sparkline";
import { IPIcon } from "./IPIcon";
import { formatCompactUsd, formatCompactNumber, formatInt } from "@/lib/format";

/** 24h volume split — marketplace resale + gacha pulls + other primary = total. */
export type VolBreakdown = {
  marketplace: number;
  gacha: number;
  otherPrimary: number;
  total: number;
};

export type GachaKpi = { pulls: number; avgPullUsd: number };

function fullUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}
function compactUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return formatCompactUsd(n);
}
function trendFrom(deltaPct: number | null, spark: number[]): Trend {
  if (deltaPct != null && Number.isFinite(deltaPct)) {
    if (deltaPct > 0.05) return "up";
    if (deltaPct < -0.05) return "down";
    return "flat";
  }
  if (spark.length >= 2) {
    const d = spark[spark.length - 1] - spark[0];
    return d > 0 ? "up" : d < 0 ? "down" : "flat";
  }
  return "flat";
}
/** Hero `*Pct*` fields are fractions (like mcapPct24h) → percent for the badge. */
const pct = (frac: number | null) => (frac != null && Number.isFinite(frac) ? frac * 100 : null);

/**
 * Homepage KPI grid — the analytics-forward front door. Two feature cards
 * (industry Market Cap with sparkline, 24h Volume with its marketplace / gacha /
 * primary split) over a strip of four signal tiles (gacha rips, holders, trades,
 * the most-traded IP). Every tile is real and links into its deep page.
 */
export function MarketKpiGrid({
  hero,
  vol,
  gacha,
  topIP,
}: {
  hero: HeroStats;
  vol: VolBreakdown;
  gacha: GachaKpi;
  topIP: IPRow | null;
}) {
  const mcapDelta = pct(hero.mcapPct24h);
  const volDelta = pct(hero.vol24Pct);

  return (
    <section className="mb-9">
      {/* Feature cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FeatureCard
          href="/ips"
          label="Market Cap"
          value={fullUsd(hero.totalMcapUsd)}
          valueCompact={compactUsd(hero.totalMcapUsd)}
          deltaPct={mcapDelta}
          spark={hero.mcapSpark ?? []}
          trend={trendFrom(mcapDelta, hero.mcapSpark ?? [])}
        />
        <VolumeCard vol={vol} deltaPct={volDelta} spark={hero.volSpark ?? []} />
      </div>

      {/* Signal strip */}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          href="/gacha"
          label="Gacha rips · 24h"
          value={hero != null && gacha.pulls > 0 ? formatInt(gacha.pulls) : "—"}
          sub={gacha.avgPullUsd > 0 ? `avg pull ${compactUsd(gacha.avgPullUsd)}` : undefined}
          accent
        />
        <StatTile
          href="/ips"
          label="Holders"
          value={Number.isFinite(hero.holders) && hero.holders > 0 ? formatInt(hero.holders) : "—"}
          deltaPct={pct(hero.holdersPct7d)}
          deltaLabel="7d"
        />
        <StatTile
          href="/platforms"
          label="Trades · 24h"
          value={hero.trades24h > 0 ? formatCompactNumber(hero.trades24h) : "—"}
          deltaPct={pct(hero.trades24hPct)}
        />
        <EntityTile topIP={topIP} />
      </div>
    </section>
  );
}

const VOL_SEGMENTS = [
  { key: "marketplace", label: "Marketplace", color: "var(--color-blue)" },
  { key: "gacha", label: "Gacha", color: "var(--color-yellow)" },
  { key: "otherPrimary", label: "Other primary", color: "var(--color-purple)" },
] as const;

function VolumeCard({ vol, deltaPct, spark }: { vol: VolBreakdown; deltaPct: number | null; spark: number[] }) {
  const total = vol.total > 0 ? vol.total : 1;
  const segs = VOL_SEGMENTS.map((s) => ({ ...s, value: vol[s.key] })).filter((s) => s.value > 0);
  return (
    <Link href="/platforms" className={CARD_CLS}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[26px] font-bold leading-none tracking-[-0.01em] tabular transition-colors group-hover:text-yellow">
            <span className="sm:hidden">{compactUsd(vol.total)}</span>
            <span className="hidden sm:inline">{fullUsd(vol.total)}</span>
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-[13px]">
            <span className="text-ink-3">24h Volume</span>
            {deltaPct != null && <Delta pct={deltaPct} />}
          </div>
        </div>
        {spark.length >= 2 && <Sparkline data={spark} trend={trendFrom(deltaPct, spark)} width={120} height={40} />}
      </div>
      {segs.length > 0 && (
        <div className="mt-4">
          <div className="flex h-2 overflow-hidden rounded-full bg-bg-3">
            {segs.map((s) => (
              <span key={s.key} className="h-full" style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {segs.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5 text-[12px]">
                <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: s.color }} />
                <span className="text-ink-3">{s.label}</span>
                <span className="font-mono font-semibold tabular text-ink-2">{compactUsd(s.value)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Link>
  );
}

const CARD_CLS =
  "group flex flex-col justify-between rounded-2xl border border-line bg-bg-1 px-6 py-5 transition-[transform,border-color,background-color] duration-200 ease-out hover:border-line-2 hover:bg-bg-2 motion-safe:hover:-translate-y-0.5";
const TILE_CLS =
  "group flex flex-col justify-between gap-3 rounded-2xl border border-line bg-bg-1 px-5 py-4 transition-[transform,border-color,background-color] duration-200 ease-out hover:border-line-2 hover:bg-bg-2 motion-safe:hover:-translate-y-0.5";

function FeatureCard({
  href, label, value, valueCompact, deltaPct, spark, trend,
}: {
  href: string; label: string; value: string; valueCompact: string;
  deltaPct: number | null; spark: number[]; trend: Trend;
}) {
  return (
    <Link href={href} className={`${CARD_CLS} !flex-row items-center justify-between`}>
      <div className="min-w-0">
        <div className="text-[26px] font-bold leading-none tracking-[-0.01em] tabular transition-colors group-hover:text-yellow">
          <span className="sm:hidden">{valueCompact}</span>
          <span className="hidden sm:inline">{value}</span>
        </div>
        <div className="mt-2.5 flex items-center gap-2 text-[13px]">
          <span className="text-ink-3">{label}</span>
          {deltaPct != null && <Delta pct={deltaPct} />}
        </div>
      </div>
      {spark.length >= 2 && <Sparkline data={spark} trend={trend} width={150} height={48} />}
    </Link>
  );
}

function StatTile({
  href, label, value, deltaPct, deltaLabel, sub, accent,
}: {
  href: string; label: string; value: string;
  deltaPct?: number | null; deltaLabel?: string; sub?: string; accent?: boolean;
}) {
  return (
    <Link href={href} className={TILE_CLS}>
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">{label}</div>
      <div>
        <div className={`text-[22px] font-bold leading-none tabular transition-colors group-hover:text-yellow ${accent ? "text-yellow" : ""}`}>
          {value}
        </div>
        <div className="mt-2 flex items-center gap-2 text-[12px]">
          {deltaPct != null && Number.isFinite(deltaPct) && (
            <span className="flex items-center gap-1">
              <Delta pct={deltaPct} />
              {deltaLabel && <span className="text-ink-4">{deltaLabel}</span>}
            </span>
          )}
          {sub && <span className="text-ink-3">{sub}</span>}
        </div>
      </div>
    </Link>
  );
}

function EntityTile({ topIP }: { topIP: IPRow | null }) {
  if (!topIP) {
    return (
      <div className={`${TILE_CLS} cursor-default`}>
        <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Most traded · 24h</div>
        <div className="text-[15px] font-bold text-ink-3">—</div>
      </div>
    );
  }
  return (
    <Link href={`/ip/${topIP.key}`} className={TILE_CLS}>
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Most traded · 24h</div>
      <div className="flex items-center gap-2.5">
        <IPIcon name={topIP.name} short={topIP.short} color={topIP.color} logo={topIP.logo} iconBlendMode={topIP.iconBlendMode} emoji={topIP.emoji} size={26} />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold leading-tight transition-colors group-hover:text-yellow">{topIP.name}</div>
          <div className="mt-0.5 font-mono text-[12px] tabular text-ink-2">{compactUsd(topIP.vol24Usd)}</div>
        </div>
      </div>
    </Link>
  );
}

function Delta({ pct }: { pct: number }) {
  const up = pct > 0.05;
  const down = pct < -0.05;
  const cls = up ? "text-green" : down ? "text-red" : "text-ink-3";
  const arrow = up ? "▲" : down ? "▼" : "·";
  return (
    <span className={`flex items-center gap-1 text-[13px] font-semibold tabular ${cls}`}>
      <span className="text-[10px]">{arrow}</span>
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}
