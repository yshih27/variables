"use client";

import { useState } from "react";
import type { SeriesPoint } from "@/lib/data/metricSnapshots";
import { MetricInfo } from "./MetricInfo";
import { formatCompactUsd, formatCompactNumber } from "@/lib/format";
import { monotonePath } from "@/lib/chart/path";
import type { MetricKey } from "@/lib/metrics/glossary";

/**
 * MetricBarCard — a compact DefiLlama-style "N-day daily" card for the /ips and
 * /platform overviews. One headline over the daily series, most recent day
 * emphasized, and a hover readout.
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
 * headline is an honest "{window} total", not a rolling-24h figure. A series
 * SHORTER than its window renders what exists plus a "N of 14 days · building"
 * note; only a genuinely empty one falls back to the empty state.
 *
 * ⚠️ This is now a client component. It was deliberately zero-JS, and the hover
 * readout is what changed that: the headline swaps to the hovered day's value,
 * so the plot and the headline share state and an "overlay island" would have
 * had to be the whole card anyway. The label's MetricInfo already forced a
 * client boundary here; this widens it to ~200 lines of markup.
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
  windowDays = 14,
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
  /** How many days the window WANTS. A shorter series says so rather than
   *  silently presenting itself as a full window. */
  windowDays?: number;
  /** Shown in place of the series when `data` is empty. */
  emptyNote?: string;
  /** Optional second line under `emptyNote` — say WHY this one is empty. Was
   *  hardcoded to the holders excuse, which every future empty card inherited. */
  emptyDetail?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const fmt = (n: number) => (unit === "usd" ? formatCompactUsd(n) : formatCompactNumber(n));
  const values = data.map((p) => (Number.isFinite(p.value) ? p.value : 0));
  const hasData = data.length > 0;
  const rangeLabel = hasData ? `${fmtDay(data[0].ts)} – ${fmtDay(data[data.length - 1].ts)}` : null;
  const partial = hasData && data.length < windowDays;

  const total = !hasData
    ? null
    : variant === "line"
      ? values[values.length - 1]
      : values.reduce((a, v) => a + v, 0);
  // Derived from windowLabel — this line used to hardcode "14-day total", so a
  // card passed windowLabel="7D" quietly lied about its own window.
  const totalCaption = variant === "line" ? "latest" : `${windowLabel.toLowerCase()} total`;

  // The hover READOUT: the headline shows the hovered day rather than the window
  // aggregate, so the number you're reading never moves with the cursor.
  const active = hover != null && hover < data.length ? hover : null;
  const headline = active != null ? values[active] : total;
  const caption = active != null ? fmtDay(data[active].ts) : totalCaption;

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
      <div className={`mt-1 text-[11px] ${active != null ? "text-yellow" : "text-ink-3"}`}>
        {hasData ? caption : " "}
      </div>

      {!hasData ? (
        <div className="mt-3 flex h-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-center">
          <span className="text-[12px] text-ink-3">{emptyNote}</span>
          {emptyDetail ? <span className="text-[10.5px] text-ink-4">{emptyDetail}</span> : null}
        </div>
      ) : (
        <Plot
          data={data}
          values={values}
          fmt={fmt}
          variant={variant}
          hover={active}
          onHover={setHover}
        />
      )}

      {hasData ? (
        <div className="mt-2 font-mono text-[10.5px] text-ink-4">
          {rangeLabel}
          {/* A young series states its own youth instead of looking like a full
              window that happens to be short. */}
          {partial ? (
            <span className="text-ink-3">
              {" · "}
              {data.length} of {windowDays} days · building
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The plot + its hover layer. One band per point, laid over whichever series
 * shape is drawn, so bars and the line share identical hit-testing and the same
 * branded tooltip — no per-variant mouse maths.
 *
 * The native `title=` that used to sit on each bar is gone: the grey OS tooltip
 * must never double-stack with a branded one (R6-2), and it couldn't be styled
 * or track the readout anyway.
 */
function Plot({
  data,
  values,
  fmt,
  variant,
  hover,
  onHover,
}: {
  data: SeriesPoint[];
  values: number[];
  fmt: (n: number) => string;
  variant: "bars" | "line";
  hover: number | null;
  onHover: (i: number | null) => void;
}) {
  const n = data.length;
  // Clamp so an edge tooltip doesn't hang off the card.
  const leftPct = hover != null ? Math.min(Math.max(((hover + 0.5) / n) * 100, 14), 86) : 0;

  return (
    <div className="relative mt-3 h-16">
      {variant === "line" ? (
        <LineSeries data={data} values={values} hover={hover} />
      ) : (
        <Bars data={data} values={values} hover={hover} />
      )}

      {/* Hover bands — invisible, full-height, one per point. Full-height so a
          near-zero bar is still reachable; hit area shouldn't track magnitude. */}
      <div className="absolute inset-0 flex gap-[3px]" onMouseLeave={() => onHover(null)}>
        {data.map((p, i) => (
          <div
            key={p.ts}
            className="min-w-0 flex-1 cursor-default"
            onMouseEnter={() => onHover(i)}
          />
        ))}
      </div>

      {hover != null ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-line-2 bg-bg-2/95 px-2 py-1 font-mono text-[10.5px] shadow-[0_8px_24px_rgba(0,0,0,0.55)] backdrop-blur"
          style={{ left: `${leftPct}%` }}
        >
          <span className="text-ink-3">{fmtDay(data[hover].ts)}</span>
          <span className="mx-1.5 text-ink-4">·</span>
          <span className="font-bold text-ink">{fmt(values[hover])}</span>
        </div>
      ) : null}
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
  hover,
}: {
  data: SeriesPoint[];
  values: number[];
  hover: number | null;
}) {
  const posMax = Math.max(0, ...values);
  const negMax = Math.min(0, ...values); // ≤ 0
  const span = posMax - negMax || 1;
  const baseFromBottom = (-negMax / span) * 100;
  const diverging = negMax < 0;

  return (
    <div className="pointer-events-none absolute inset-0 flex items-stretch gap-[3px]">
      {diverging ? (
        <span
          aria-hidden
          className="absolute inset-x-0 z-10 border-t border-dashed border-line-2"
          style={{ bottom: `${baseFromBottom}%` }}
        />
      ) : null}
      {data.map((p, i) => {
        const v = values[i];
        const last = i === data.length - 1;
        const on = hover === i;
        // Floor the drawn height so a zero day still reads as a tick instead of
        // vanishing — the day happened, and a gap would imply missing data.
        const h = Math.max(2.5, (Math.abs(v) / span) * 100);
        const negative = v < 0;
        // Hovered bar takes full lime + the glow, so the highlight reads the same
        // as the newest-bar emphasis rather than inventing a second visual idiom.
        const bg = negative
          ? "var(--color-red)"
          : on || last
            ? "var(--color-yellow)"
            : rampColor(i, data.length);
        return (
          <div key={p.ts} className="relative min-w-0 flex-1">
            <span
              className="absolute inset-x-0 transition-[background,box-shadow,opacity] duration-100"
              style={{
                height: `${h}%`,
                bottom: negative ? `${baseFromBottom - h}%` : `${baseFromBottom}%`,
                background: bg,
                opacity: negative && !(on || last) ? 0.6 : 1,
                boxShadow: on || last ? GLOW : undefined,
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
  hover,
}: {
  data: SeriesPoint[];
  values: number[];
  hover: number | null;
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
      className="pointer-events-none absolute inset-0 h-full w-full"
      role="img"
      aria-label={`Latest ${formatPoint(values, data)}`}
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
      {/* A 2-point series is a bare diagonal; dots make the real readings legible
          as readings. Only drawn when the series is short enough not to speckle. */}
      {data.length <= 4
        ? pts.map(([x, y], i) => (
            <circle
              key={data[i].ts}
              cx={x}
              cy={y}
              r={hover === i ? 3.5 : 2.5}
              fill="var(--color-yellow)"
              vectorEffect="non-scaling-stroke"
            />
          ))
        : null}
      {hover != null && data.length > 4 ? (
        <>
          <line
            x1={X(hover)}
            y1={0}
            x2={X(hover)}
            y2={H}
            stroke="var(--color-line-2)"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={X(hover)}
            cy={Y(values[hover])}
            r={3.5}
            fill="var(--color-yellow)"
            vectorEffect="non-scaling-stroke"
          />
        </>
      ) : null}
    </svg>
  );
}

/** aria-label helper — the raw latest reading, unformatted by unit. */
function formatPoint(values: number[], data: SeriesPoint[]): string {
  if (!values.length) return "no data";
  return `${values[values.length - 1]} on ${fmtDay(data[data.length - 1].ts)}`;
}
