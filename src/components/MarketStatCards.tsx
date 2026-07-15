import Link from "next/link";
import type { HeroStats, Trend } from "@/lib/types";
import { Sparkline } from "./Sparkline";
import { formatCompactUsd } from "@/lib/format";

/** Full USD with thousands separators, like CoinGecko's headline cards. */
function fullUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

/** Compact USD ($46.0M) for narrow screens where the full figure won't fit. */
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

/** 24h volume split — marketplace resale + gacha pulls + other primary = total.
 *  "otherPrimary" is primary-market revenue not yet attributed to gacha (today
 *  that's Courtyard, whose per-pack gacha data isn't ingested — its inflow is
 *  tracked as a lump sum). */
export type VolBreakdown = {
  marketplace: number;
  gacha: number;
  otherPrimary: number;
  total: number;
};

/**
 * Two CoinGecko-style headline cards: industry Market Cap (with sparkline) and a
 * 24h Volume card that breaks the grand total down into marketplace resale,
 * gacha pulls, and tokenization.
 */
export function MarketStatCards({ hero, vol }: { hero: HeroStats; vol: VolBreakdown }) {
  // mcapPct24h is a fraction; normalize to percent for the Delta badge.
  const mcapDeltaPct = hero.mcapPct24h != null ? hero.mcapPct24h * 100 : null;
  const mcapSpark = hero.mcapSpark ?? [];

  return (
    <section className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card
        href="/ips"
        label="Market Cap"
        value={fullUsd(hero.totalMcapUsd)}
        valueCompact={compactUsd(hero.totalMcapUsd)}
        deltaPct={mcapDeltaPct}
        spark={mcapSpark}
        trend={trendFrom(mcapDeltaPct, mcapSpark)}
      />
      <VolumeCard vol={vol} />
    </section>
  );
}

const VOL_SEGMENTS = [
  { key: "marketplace", label: "Marketplace", color: "var(--color-blue)" },
  { key: "gacha", label: "Gacha", color: "var(--color-yellow)" },
  { key: "otherPrimary", label: "Other primary", color: "var(--color-purple)" },
] as const;

/**
 * 24h Volume card — the grand total headline plus a marketplace / gacha /
 * tokenization split bar and legend. The slices sum to the total.
 */
function VolumeCard({ vol }: { vol: VolBreakdown }) {
  const total = vol.total > 0 ? vol.total : 1;
  const segs = VOL_SEGMENTS.map((s) => ({ ...s, value: vol[s.key] })).filter((s) => s.value > 0);
  return (
    <Link
      href="/platforms"
      className="group flex flex-col justify-between gap-4 rounded-2xl border border-line bg-bg-1 px-6 py-5 transition-[transform,border-color,background-color] duration-200 ease-out hover:border-line-2 hover:bg-bg-2 motion-safe:hover:-translate-y-0.5"
    >
      <div>
        <div className="text-[26px] font-bold leading-none tracking-[-0.01em] tabular transition-colors group-hover:text-yellow">
          <span className="sm:hidden">{compactUsd(vol.total)}</span>
          <span className="hidden sm:inline">{fullUsd(vol.total)}</span>
        </div>
        <div className="mt-2.5 text-[13px] text-ink-3">Total 24h Volume</div>
      </div>
      {segs.length > 0 && (
        <div>
          <div className="flex h-2 overflow-hidden rounded-none bg-bg-3">
            {segs.map((s) => (
              <span
                key={s.key}
                className="h-full"
                style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {segs.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5 text-[12px]">
                <span className="h-2 w-2 shrink-0 rounded-md" style={{ background: s.color }} />
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

function Card({
  href,
  label,
  value,
  valueCompact,
  deltaPct,
  spark,
  trend,
}: {
  href: string;
  label: string;
  value: string;
  valueCompact: string;
  deltaPct: number | null;
  spark: number[];
  trend: Trend;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-4 rounded-2xl border border-line bg-bg-1 px-6 py-5 transition-[transform,border-color,background-color] duration-200 ease-out hover:border-line-2 hover:bg-bg-2 motion-safe:hover:-translate-y-0.5"
    >
      <div className="min-w-0">
        <div className="text-[26px] font-bold leading-none tracking-[-0.01em] tabular transition-colors group-hover:text-yellow">
          <span className="sm:hidden">{valueCompact}</span>
          <span className="hidden sm:inline">{value}</span>
        </div>
        <div className="mt-2.5 flex items-center gap-2 text-[13px]">
          <span className="text-ink-3">{label}</span>
          {deltaPct != null && Number.isFinite(deltaPct) && <Delta pct={deltaPct} />}
        </div>
      </div>
      {spark.length >= 2 && (
        <Sparkline data={spark} trend={trend} width={150} height={48} />
      )}
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
