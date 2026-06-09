import Link from "next/link";
import type { HeroStats, Trend } from "@/lib/types";
import { Sparkline } from "./Sparkline";

/** Full USD with thousands separators, like CoinGecko's headline cards. */
function fullUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `$${Math.round(n).toLocaleString()}`;
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

/**
 * Two CoinGecko-style headline cards (industry Market Cap + 24h Trading Volume),
 * each with a sparkline and a clickable target.
 */
export function MarketStatCards({ hero }: { hero: HeroStats }) {
  // Normalize deltas to percent: mcapPct24h is a fraction; vol24Pct is already %.
  const mcapDeltaPct = hero.mcapPct24h != null ? hero.mcapPct24h * 100 : null;
  const mcapSpark = hero.mcapSpark ?? [];
  const volSpark = hero.volSpark ?? [];

  return (
    <section className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card
        href="/ips"
        label="Market Cap"
        value={fullUsd(hero.totalMcapUsd)}
        deltaPct={mcapDeltaPct}
        spark={mcapSpark}
        trend={trendFrom(mcapDeltaPct, mcapSpark)}
      />
      <Card
        href="/platforms"
        label="24h Trading Volume"
        value={fullUsd(hero.vol24Usd)}
        deltaPct={hero.vol24Pct}
        spark={volSpark}
        trend={trendFrom(hero.vol24Pct, volSpark)}
      />
    </section>
  );
}

function Card({
  href,
  label,
  value,
  deltaPct,
  spark,
  trend,
}: {
  href: string;
  label: string;
  value: string;
  deltaPct: number | null;
  spark: number[];
  trend: Trend;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-4 rounded-2xl border border-line bg-bg-1 px-6 py-5 transition-colors hover:border-line-2"
    >
      <div className="min-w-0">
        <div className="truncate text-[26px] font-bold leading-none tracking-[-0.01em] tabular transition-colors group-hover:text-yellow">
          {value}
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
