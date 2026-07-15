import { SectionShell } from "./Section";
import { MetricInfo } from "./MetricInfo";
import { formatCompactUsd, formatCompactNumber } from "@/lib/format";
import type { MetricKey } from "@/lib/metrics/glossary";

/**
 * OverviewMetricColumn — the LEFT rail of an Overview page's top zone: the
 * headline levels stacked beside the chart. Shared by /ips (market-wide) and
 * /platform/[key] (one platform), so it is PRESENTATIONAL ONLY: the caller
 * builds the rows.
 *
 * That split is deliberate. Delta units are not uniform across this codebase —
 * `history.pctChange` and `metricSnapshots.pctChange` return PERCENT while
 * `marketcap.pctChangeOverHours` returns a FRACTION — and which producer feeds a
 * row is a per-page fact. Getting it wrong renders 100× off (this pass inherited
 * exactly that bug). So each page normalizes its own sources to percent at the
 * point where it knows them, and this component just draws what it's given.
 *
 * Each label is its own tooltip trigger (dotted underline → the glossary
 * popover) rather than carrying an ⓘ dot — six ⓘ in a narrow column read as
 * noise. Rows with real sub-data expand DefiLlama-style via a native <details>,
 * so the disclosure costs zero client JS and works keyboard-first; rows without
 * it simply have no chevron. Only `MetricInfo` (a leaf client component) hydrates.
 *
 * Nothing here fabricates: a non-finite or non-positive value renders "—", and a
 * null delta renders "—" rather than a confident 0.0%.
 */
type Unit = "usd" | "count";
/** One line of expanded detail — pre-formatted by the caller. */
export type OverviewSubRow = { label: string; value: string };

export type OverviewMetricRow = {
  label: string;
  /** Glossary key behind the label's tooltip. */
  metric: MetricKey;
  value: number;
  unit: Unit;
  /** Change in PERCENT (already ×100), or null when no real delta exists yet.
   *  ⚠️ The caller owns the fraction→percent conversion; see the note above. */
  deltaPct: number | null;
  /** The window the DELTA describes — the muted suffix beside it. */
  window: "24h" | "7d";
  hero?: boolean;
  /** Present → the row gets a chevron and expands. Omit when there's no real
   *  sub-data; an empty disclosure is worse than none. */
  detail?: OverviewSubRow[];
};

const fmt = (n: number, unit: Unit) =>
  unit === "usd" ? formatCompactUsd(n) : formatCompactNumber(n);

export function OverviewMetricColumn({ rows }: { rows: OverviewMetricRow[] }) {
  return (
    <SectionShell className="flex h-full flex-col divide-y divide-line">
      {rows.map((r) => (
        <MetricRow key={r.label} {...r} />
      ))}
    </SectionShell>
  );
}

function MetricRow({ label, metric, value, unit, deltaPct, window, hero, detail }: OverviewMetricRow) {
  const head = (
    <>
      <div className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-3">
        <MetricInfo metric={metric}>{label}</MetricInfo>
        {detail ? <Chevron /> : null}
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span
          className={`font-bold leading-none tracking-[-0.01em] tabular ${
            hero ? "text-[28px] text-yellow" : "text-[21px]"
          }`}
        >
          {/* NaN (no data yet) and a real 0 both fail this guard — both are
              honestly "—" here rather than a confident zero. */}
          {value > 0 ? fmt(value, unit) : "—"}
        </span>
        <span className="flex items-center gap-1">
          {deltaPct != null && Number.isFinite(deltaPct) ? (
            <Delta pct={deltaPct} />
          ) : (
            <span className="font-mono text-[12.5px] text-ink-4">—</span>
          )}
          <span className="text-[10.5px] text-ink-4">{window}</span>
        </span>
      </div>
    </>
  );

  if (!detail) return <div className="flex flex-1 flex-col justify-center px-4 py-3">{head}</div>;

  return (
    <details className="group flex flex-1 flex-col justify-center px-4 py-3">
      {/* list-none + the webkit marker reset kill the native triangle; our own
          chevron sits beside the label instead. MetricInfo stops propagation on
          click, so hitting the label opens the tooltip without toggling the row. */}
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {head}
      </summary>
      <dl className="mt-2.5 flex flex-col gap-1 border-l border-line-2 pl-2.5">
        {detail.map((d) => (
          <div key={d.label} className="flex items-baseline justify-between gap-2">
            <dt className="text-[10.5px] text-ink-4">{d.label}</dt>
            <dd className="tabular text-[12px] font-semibold text-ink-2">{d.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** Collapsed → points right; open → points down (rotated by the parent's group-open). */
function Chevron() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      className="text-ink-4 transition-transform group-open:rotate-90"
      aria-hidden
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function Delta({ pct }: { pct: number }) {
  // ±0.05% dead-band: below that a "+0.0%" with an arrow implies a move that
  // isn't there, so it degrades to a neutral dot.
  const up = pct > 0.05;
  const down = pct < -0.05;
  const cls = up ? "text-green" : down ? "text-red" : "text-ink-3";
  const arrow = up ? "▲" : down ? "▼" : "·";
  return (
    <span className={`flex items-center gap-1 text-[12.5px] font-semibold tabular ${cls}`}>
      <span className="text-[9px]">{arrow}</span>
      {pct > 0 ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}
