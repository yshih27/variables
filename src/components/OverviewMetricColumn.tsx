import { SectionShell } from "./Section";
import { formatCompactUsd } from "@/lib/format";

/**
 * OverviewMetricColumn — the LEFT rail of the /ips overview's top zone: the
 * market's headline levels stacked beside the composite index chart. Market Cap
 * is the hero (yellow) and carries its real 24h %Δ; the two 24h volume LEVELS are
 * real now but their deltas are a Phase-2 backend deliverable, so they render an
 * honest "—" rather than a fabricated change. Stretches to the chart's height on
 * wide screens (parent grid is items-stretch).
 */
type MetricRowData = {
  label: string;
  value: number;
  /** 24h change in PERCENT (already ×100), or null when no real delta exists yet. */
  deltaPct: number | null;
  hero?: boolean;
};

export function OverviewMetricColumn({
  mcapUsd,
  mcapPct24h,
  marketplaceVol,
  gachaVol,
}: {
  mcapUsd: number;
  /** Fraction (e.g. 0.05 = +5%), or null. */
  mcapPct24h: number | null;
  marketplaceVol: number;
  gachaVol: number;
}) {
  const rows: MetricRowData[] = [
    {
      label: "Market Cap",
      value: mcapUsd,
      deltaPct: mcapPct24h != null && Number.isFinite(mcapPct24h) ? mcapPct24h * 100 : null,
      hero: true,
    },
    { label: "24h Marketplace Vol", value: marketplaceVol, deltaPct: null },
    { label: "24h Gacha Vol", value: gachaVol, deltaPct: null },
  ];

  return (
    <SectionShell className="flex h-full flex-col divide-y divide-line">
      {rows.map((r) => (
        <MetricRow key={r.label} {...r} />
      ))}
    </SectionShell>
  );
}

function MetricRow({ label, value, deltaPct, hero }: MetricRowData) {
  return (
    <div className="flex flex-1 flex-col justify-center px-5 py-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">{label}</div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span
          className={`font-bold leading-none tracking-[-0.01em] tabular ${
            hero ? "text-[30px] text-yellow" : "text-[22px]"
          }`}
        >
          {value > 0 ? formatCompactUsd(value) : "—"}
        </span>
        <span className="flex items-center gap-1">
          {deltaPct != null && Number.isFinite(deltaPct) ? <Delta pct={deltaPct} /> : <span className="font-mono text-[13px] text-ink-4">—</span>}
          <span className="text-[11px] text-ink-4">24h</span>
        </span>
      </div>
    </div>
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
      {pct > 0 ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}
