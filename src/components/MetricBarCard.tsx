import type { SeriesPoint } from "@/lib/data/metricSnapshots";
import { MetricInfo } from "./MetricInfo";
import { formatCompactUsd, formatCompactNumber } from "@/lib/format";
import { monotonePath } from "@/lib/chart/path";
import type { MetricKey } from "@/lib/metrics/glossary";

/**
 * MetricBarCard — a compact DefiLlama-style "N-day daily" card for the /ips
 * overview's middle zone. One headline over the daily series, most recent day
 * emphasized. Server-rendered; only the label's tooltip (MetricInfo) hydrates.
 *
 * The brand boards drive the look: de-emphasized marks step down the dimmed-lime
 * ramp on the near-black ground while the newest burns full lime with a soft
 * glow — the boards' "emphasized bar", applied here as an AGE ramp so the card
 * reads left-to-right as history → now.
 *
 * TWO variants, because a flow and a stock are not the same shape of truth:
 *   bars — a FLOW (volume, cards traded). Bars off a zero baseline; the headline
 *          is the window TOTAL, because flows add up. Signed flows diverge:
 *          negatives drop below the baseline in red.
 *   line — a STOCK (holders). A level, not an accumulation — summing 14 daily
 *          holder counts would be meaningless, so the headline is the LATEST
 *          reading and the series draws as a line.
 *
 * The series is the CHART tier (complete-calendar-day spine buckets), so the
 * headline is an honest "{window} total", not a rolling-24h figure. When `data`
 * is empty the card holds its slot with a muted note rather than faking bars.
 */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDay(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Age ramp: oldest at the dimmest rung, newest-but-one at the brighter. */
function rampColor(i: number, n: number): string {
  const t = n <= 1 ? 1 : i / (n - 1);
  return `color-mix(in oklab, var(--color-lime-dimmer), var(--color-lime-dim) ${(t * 100).toFixed(1)}%)`;
}

/** The boards' emphasis: a soft bloom, not a halo. */
const GLOW = "0 0 10px 0 color-mix(in oklab, var(--color-yellow) 55%, transparent)";

export function MetricBarCard({
  label,
  data,
  unit,
  variant = "bars",
  metric,
  windowLabel = "14D",
  emptyNote = "Building history",
  emptyDetail,
}: {
  label: string;
  /** Daily points, oldest → newest (already sliced to the window). */
  data: SeriesPoint[];
  unit: "usd" | "count";
  /** flow → "bars" (default); stock → "line". See the note above. */
  variant?: "bars" | "line";
  /** Glossary key behind the label's tooltip. */
  metric?: MetricKey;
  windowLabel?: string;
  /** Shown in place of the series when `data` is empty. */
  emptyNote?: string;
  /** Optional second line under `emptyNote` — say WHY this one is empty. Was
   *  hardcoded to the holders excuse, which every future empty card inherited. */
  emptyDetail?: string;
}) {
  const fmt = (n: number) => (unit === "usd" ? formatCompactUsd(n) : formatCompactNumber(n));
  const values = data.map((p) => (Number.isFinite(p.value) ? p.value : 0));
  const hasData = data.length > 0;
  const rangeLabel = hasData ? `${fmtDay(data[0].ts)} – ${fmtDay(data[data.length - 1].ts)}` : null;

  const headline = !hasData
    ? null
    : variant === "line"
      ? values[values.length - 1]
      : values.reduce((a, v) => a + v, 0);
  // Derived from windowLabel — this line used to hardcode "14-day total", so a
  // card passed windowLabel="7D" quietly lied about its own window.
  const caption = variant === "line" ? "latest" : `${windowLabel.toLowerCase()} total`;

  return (
    <div className="flex flex-col rounded-2xl border border-line bg-bg-1 px-4 py-3.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-3">
          {metric ? <MetricInfo metric={metric}>{label}</MetricInfo> : label}
        </span>
        <span className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em] text-ink-4">
          {windowLabel}
        </span>
      </div>

      <div className="mt-2 text-[23px] font-bold leading-none tracking-[-0.01em] tabular">
        {headline != null ? fmt(headline) : <span className="text-ink-4">—</span>}
      </div>
      {/* nbsp holds the row height when empty so the three cards stay aligned. */}
      <div className="mt-1 text-[11px] text-ink-3">{hasData ? caption : " "}</div>

      {!hasData ? (
        <div className="mt-3 flex h-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-center">
          <span className="text-[12px] text-ink-3">{emptyNote}</span>
          {emptyDetail ? <span className="text-[10.5px] text-ink-4">{emptyDetail}</span> : null}
        </div>
      ) : variant === "line" ? (
        <LineSeries data={data} values={values} fmt={fmt} />
      ) : (
        <Bars data={data} values={values} fmt={fmt} />
      )}

      {hasData ? <div className="mt-2 font-mono text-[10.5px] text-ink-4">{rangeLabel}</div> : null}
    </div>
  );
}

/**
 * Daily bars off a zero baseline. Diverging falls out of the same maths rather
 * than a second code path: with every value ≥ 0 the baseline sits flush at the
 * bottom and this is an ordinary column chart; a single negative lifts the
 * baseline and the negatives hang beneath it in red. One path, so the signed
 * case can't rot while the common case keeps working.
 */
function Bars({
  data,
  values,
  fmt,
}: {
  data: SeriesPoint[];
  values: number[];
  fmt: (n: number) => string;
}) {
  const posMax = Math.max(0, ...values);
  const negMax = Math.min(0, ...values); // ≤ 0
  const span = posMax - negMax || 1;
  const baseFromBottom = (-negMax / span) * 100;
  const diverging = negMax < 0;

  return (
    <div className="relative mt-3 flex h-16 items-stretch gap-[3px]">
      {diverging ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-line-2"
          style={{ bottom: `${baseFromBottom}%` }}
        />
      ) : null}
      {data.map((p, i) => {
        const v = values[i];
        const last = i === data.length - 1;
        // Floor the drawn height so a zero day still reads as a tick instead of
        // vanishing — the day happened, and a gap would imply missing data.
        const h = Math.max(2.5, (Math.abs(v) / span) * 100);
        const negative = v < 0;
        return (
          <div key={p.ts} className="relative min-w-0 flex-1" title={`${fmtDay(p.ts)} · ${fmt(v)}`}>
            <span
              className="absolute inset-x-0"
              style={{
                height: `${h}%`,
                bottom: negative ? `${baseFromBottom - h}%` : `${baseFromBottom}%`,
                background: negative
                  ? "var(--color-red)"
                  : last
                    ? "var(--color-yellow)"
                    : rampColor(i, data.length),
                opacity: negative && !last ? 0.6 : 1,
                boxShadow: last ? GLOW : undefined,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * A stock series: line + soft area, newest point marked and glowing. Uses the
 * shared monotone path so the curve can't overshoot between daily samples.
 */
function LineSeries({
  data,
  values,
  fmt,
}: {
  data: SeriesPoint[];
  values: number[];
  fmt: (n: number) => string;
}) {
  const W = 200;
  const H = 64;
  const PAD = 5;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const X = (i: number) => (data.length <= 1 ? W / 2 : (i / (data.length - 1)) * W);
  // A dead-flat series would otherwise pin to the top edge; center it instead.
  const Y = (v: number) => (max === min ? H / 2 : H - PAD - ((v - min) / span) * (H - PAD * 2));

  const pts = values.map((v, i) => [X(i), Y(v)] as [number, number]);
  const line = monotonePath(pts);
  const area = `${line} L${W} ${H} L0 ${H} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="mt-3 h-16 w-full"
      role="img"
      aria-label={`Latest ${fmt(values[values.length - 1])}`}
    >
      <defs>
        <linearGradient id="mbc-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-yellow)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--color-yellow)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#mbc-area)" />
      {/* non-scaling-stroke: preserveAspectRatio="none" would otherwise stretch
          the stroke horizontally with the box. */}
      <path
        d={line}
        fill="none"
        stroke="var(--color-yellow)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
