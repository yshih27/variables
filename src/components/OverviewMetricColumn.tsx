import { SectionShell } from "./Section";
import { MetricInfo } from "./MetricInfo";
import { RowLink } from "./RowLink";
import { formatCompactUsd, formatCompactNumber, deltaDir, formatDelta } from "@/lib/format";
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
  /** Glossary key behind the label's tooltip. Omit when the label names an
   *  ENTITY rather than a measurement — "Collector Crypt" has no definition to
   *  pop, and a link and a tooltip trigger on the same word fight each other. */
  metric?: MetricKey;
  value: number;
  unit: Unit;
  /** Change in PERCENT (already ×100), or null when no real delta exists yet.
   *  ⚠️ The caller owns the fraction→percent conversion; see the note above. */
  deltaPct: number | null;
  /** The window the DELTA describes — the muted suffix beside it. Omit only on a
   *  row that carries `stat` instead of a delta. */
  window?: "24h" | "7d";
  hero?: boolean;
  /** Present → the row gets a chevron and expands. Omit when there's no real
   *  sub-data; an empty disclosure is worse than none. */
  detail?: OverviewSubRow[];
  /** Render this instead of the formatted number — for a row whose value is an
   *  ENTITY rather than a measurement ("Top Platform → Collector Crypt"). Set in
   *  sans, not tabular: it isn't a figure. */
  valueText?: string;
  /** Links the valueText to that entity's page — for "Top Platform", where the
   *  clickable thing is the NAMED platform, not the "Top Platform" label. */
  valueHref?: string;
  /** Render this instead of the delta+window pair — for a row that has no delta
   *  because it ISN'T a time series (a share, a count of tracked platforms).
   *  ⚠️ Distinct from `deltaPct: null`, which means "a delta belongs here but
   *  isn't available yet" and correctly renders "—". Don't use `stat` to paper
   *  over a missing delta. */
  stat?: string;
  /** Muted qualifier beside the label — the chain a platform settles on. Not a
   *  measurement; it just says which thing this row names. */
  sublabel?: string;
  /** Muted suffix AFTER the delta (a share of the total). Unlike `stat`, this
   *  COEXISTS with the delta rather than replacing it — a leaderboard row needs
   *  both "how it moved" and "how big a slice it is". */
  sub?: string;
  /** Links the row's label to that entity's page. The label becomes the only
   *  clickable thing in the row; see RowLink for why that boundary matters. */
  href?: string;
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

function MetricRow({
  label,
  metric,
  value,
  unit,
  deltaPct,
  window,
  hero,
  detail,
  valueText,
  valueHref,
  stat,
  sublabel,
  sub,
  href,
}: OverviewMetricRow) {
  const name = href ? (
    <RowLink href={href}>{label}</RowLink>
  ) : metric ? (
    <MetricInfo metric={metric}>{label}</MetricInfo>
  ) : (
    <span>{label}</span>
  );
  const head = (
    <>
      <div className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-3">
        {name}
        {sublabel ? <span className="text-ink-4">· {sublabel}</span> : null}
        {detail ? <Chevron /> : null}
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span
          className={`font-bold leading-none tracking-[-0.01em] ${valueText ? "" : "tabular"} ${
            hero ? "text-[28px] text-yellow" : "text-[21px]"
          }`}
        >
          {/* NaN (no data yet) and a real 0 both fail this guard — both are
              honestly "—" here rather than a confident zero. */}
          {valueText != null ? (
            valueHref ? (
              <RowLink href={valueHref}>{valueText}</RowLink>
            ) : (
              valueText
            )
          ) : value > 0 ? (
            fmt(value, unit)
          ) : (
            "—"
          )}
        </span>
        <span className="flex items-center gap-1">
          {stat ? (
            <span className="text-[11px] text-ink-3">{stat}</span>
          ) : (
            <>
              {deltaPct != null && Number.isFinite(deltaPct) ? (
                <Delta pct={deltaPct} />
              ) : (
                <span className="font-mono text-[12.5px] text-ink-4">—</span>
              )}
              <span className="text-[10.5px] text-ink-4">{window}</span>
            </>
          )}
          {sub ? <span className="text-[10.5px] text-ink-4">· {sub}</span> : null}
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
  // Dead-banded so a tiny move degrades to a neutral dot AND drops its sign —
  // formatDelta prints "0.0%" (not "−0.0%") inside the band. One convention.
  const dir = deltaDir(pct);
  const cls = dir === "up" ? "text-green" : dir === "down" ? "text-red" : "text-ink-3";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "·";
  return (
    <span className={`flex items-center gap-1 text-[12.5px] font-semibold tabular ${cls}`}>
      <span className="text-[9px]">{arrow}</span>
      {formatDelta(pct)}
    </span>
  );
}
