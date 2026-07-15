import type { SeriesPoint } from "@/lib/data/metricSnapshots";
import { formatCompactUsd, formatCompactNumber } from "@/lib/format";

/**
 * MetricBarCard — a compact DefiLlama-style "N-day daily bars" card for the /ips
 * overview's middle zone. One headline (the window total) over a row of daily
 * bars, the most recent day accented. Purely presentational + server-rendered
 * (no interactivity beyond a native per-bar tooltip), so it ships zero client JS.
 *
 * The bars are the CHART tier (complete-calendar-day spine buckets); the headline
 * sums them, so it's an honest "{window} total", not a rolling-24h figure. When
 * `data` is empty the card holds its slot with a muted "building history" note
 * rather than faking bars — the holders series is a Phase-2 backend deliverable.
 */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDay(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function MetricBarCard({
  label,
  data,
  unit,
  accent,
  windowLabel = "14D",
  emptyNote = "Building history",
}: {
  label: string;
  /** Daily points, oldest → newest (already sliced to the window). */
  data: SeriesPoint[];
  unit: "usd" | "count";
  /** CSS color for the most-recent bar (older bars dim the same hue). */
  accent: string;
  windowLabel?: string;
  /** Shown in place of bars when `data` is empty. */
  emptyNote?: string;
}) {
  const fmt = (n: number) => (unit === "usd" ? formatCompactUsd(n) : formatCompactNumber(n));
  const total = data.reduce((a, p) => a + (Number.isFinite(p.value) ? p.value : 0), 0);
  const max = Math.max(1, ...data.map((p) => (Number.isFinite(p.value) ? p.value : 0)));
  const hasData = data.length > 0;
  const rangeLabel = hasData ? `${fmtDay(data[0].ts)} – ${fmtDay(data[data.length - 1].ts)}` : null;

  return (
    <div className="flex flex-col rounded-2xl border border-line bg-bg-1 px-5 py-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">{label}</span>
        <span className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em] text-ink-4">
          {windowLabel}
        </span>
      </div>

      <div className="mt-2 text-[24px] font-bold leading-none tracking-[-0.01em] tabular">
        {hasData ? fmt(total) : <span className="text-ink-4">—</span>}
      </div>
      <div className="mt-1 text-[11.5px] text-ink-3">{hasData ? "14-day total" : " "}</div>

      {hasData ? (
        <>
          <div className="mt-3.5 flex h-16 items-end gap-[3px]">
            {data.map((p, i) => {
              const v = Number.isFinite(p.value) ? p.value : 0;
              const last = i === data.length - 1;
              return (
                <div
                  key={p.ts}
                  title={`${fmtDay(p.ts)} · ${fmt(v)}`}
                  className="min-w-0 flex-1 rounded-t-md"
                  style={{
                    height: `${Math.max(3, (v / max) * 100)}%`,
                    background: accent,
                    opacity: last ? 1 : 0.38,
                  }}
                />
              );
            })}
          </div>
          <div className="mt-2 font-mono text-[10.5px] text-ink-4">{rangeLabel}</div>
        </>
      ) : (
        <div className="mt-3.5 flex h-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-center">
          <span className="text-[12px] text-ink-3">{emptyNote}</span>
          <span className="text-[10.5px] text-ink-4">deduped daily series — Phase 2</span>
        </div>
      )}
    </div>
  );
}
