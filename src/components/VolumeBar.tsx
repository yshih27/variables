import Link from "next/link";
import { MetricInfo } from "./MetricInfo";
import type { MetricKey } from "@/lib/metrics/glossary";
import { formatCompactUsd, deltaDir, formatDelta } from "@/lib/format";

/** 24h volume split — marketplace resale + gacha pulls + other primary = total. */
export type VolBreakdown = {
  marketplace: number;
  gacha: number;
  otherPrimary: number;
  total: number;
};

const VOL_SEGMENTS = [
  { key: "marketplace", label: "Marketplace", color: "var(--color-blue)", info: "marketplace" },
  { key: "gacha", label: "Gacha", color: "var(--color-yellow)", info: "gacha" },
  { key: "otherPrimary", label: "Direct sales", color: "var(--color-purple)", info: "directSales" },
] as const;

/**
 * The 24h-volume breakdown bar: one segmented bar (marketplace / gacha / direct
 * sales) with a per-segment legend carrying each lane's value, its 24h %Δ, and a
 * glossary ⓘ. Extracted from MarketHeader so the homepage hero and the
 * /platforms fold render the SAME bar rather than two that can drift (launch
 * polish, item 5).
 *
 * Segments with a value ≤ 0 drop out (e.g. no direct-sales lane → a clean
 * two-part marketplace/gacha bar). Only marketplace and gacha carry a delta;
 * direct sales has no day-over-day producer yet and stays value-only. The whole
 * bar is NOT one <Link> — the segment labels host ⓘ buttons, which can't nest
 * inside an anchor — so the "platforms →" affordance is its own explicit link.
 */
export function VolumeBar({
  vol,
  marketplacePct,
  gachaPct,
  href = "/platforms",
  hrefLabel = "platforms →",
  topBorder = true,
}: {
  vol: VolBreakdown;
  /** ALREADY percent (hero.vol24Pct, marketplace-only Σ-based). Not a fraction. */
  marketplacePct: number | null;
  /** ALREADY percent (hero.gachaVol24Pct, gacha-only Σ-based). Not a fraction. */
  gachaPct: number | null;
  /** Corner affordance target; null hides it (e.g. on /platforms, where linking
   *  to /platforms would be a no-op). */
  href?: string | null;
  hrefLabel?: string;
  /** The top hairline that separates it from the row above when stacked inside a
   *  card (the homepage hero). Off for standalone use so it doesn't double the
   *  card's own top edge. */
  topBorder?: boolean;
}) {
  const total = vol.total > 0 ? vol.total : 1;
  const segs = VOL_SEGMENTS.map((s) => ({ ...s, value: vol[s.key] })).filter((s) => s.value > 0);
  // Per-segment 24h %Δ lives on the breakdown, not the total: a marketplace-only
  // delta can't honestly sit beside the grand total. "Direct sales" has no delta yet.
  const segPct: Record<string, number | null> = {
    marketplace: marketplacePct,
    gacha: gachaPct,
    otherPrimary: null,
  };
  return (
    <div className={`px-6 py-5 ${topBorder ? "border-t border-line" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-1">
          <Label>24h volume</Label>
          <MetricInfo metric="volume24h" />
        </div>
        <div className="flex items-baseline gap-2.5">
          <span className="text-[20px] font-bold leading-none tabular">
            {vol.total > 0 ? formatCompactUsd(vol.total) : "—"}
          </span>
          {href && (
            <Link href={href} className="text-[12px] text-ink-3 transition-colors hover:text-yellow">
              {hrefLabel}
            </Link>
          )}
        </div>
      </div>
      {segs.length > 0 && (
        <div className="mt-3.5">
          <div className="flex h-2 overflow-hidden rounded-none bg-bg-3">
            {segs.map((s) => (
              <span key={s.key} className="h-full" style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            {segs.map((s) => {
              const d = segPct[s.key];
              return (
                <span key={s.key} className="flex items-center gap-1.5 text-[12px]">
                  <span className="h-2 w-2 shrink-0 rounded-md" style={{ background: s.color }} />
                  <span className="text-ink-3">{s.label}</span>
                  <span className="font-mono font-semibold tabular text-ink-2">{formatCompactUsd(s.value)}</span>
                  {d != null && Number.isFinite(d) && <Delta pct={d} />}
                  <MetricInfo metric={s.info} />
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
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
