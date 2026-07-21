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

/** Whole days since epoch (UTC) — the spine's buckets are calendar days. */
function dayIndex(ts: string): number {
  return Math.floor(Date.parse(ts) / 86_400_000);
}

/** One day of the window: the reading that fell on it, or null for a day this
 *  series doesn't cover. `dataIndex` is the point's position within the real
 *  series, which is what the age ramp and the newest-bar emphasis key off. */
type Slot = { ts: string; value: number; dataIndex: number } | null;

/**
 * Lay the series into `windowDays` TRUE day slots.
 *
 * ⚠️ The plot draws SLOTS, never `data` directly. Every point used to get an
 * equal share of the width, so holders' three readings spread across the whole
 * card and read as 14 days of motion under a "14D" badge — three days of history
 * drawn as a fortnight of trend. Now a young series occupies only the days it
 * has and hugs the right edge, and an interior gap stays a gap instead of
 * closing up.
 *
 * The axis ends on the series' NEWEST day, not on today. The spine lags real
 * time by a day or two and each metric lags differently (holders is current;
 * volume is a day or two back), so anchoring to today would slide every card's
 * bars off the right edge by that lag and — worse — push the oldest points of a
 * FULL 14-point series off the left end of its own axis.
 */
function toSlots(data: SeriesPoint[], windowDays: number): Slot[] {
  const slots: Slot[] = new Array(Math.max(1, windowDays)).fill(null);
  if (!data.length) return slots;
  const end = dayIndex(data[data.length - 1].ts);
  data.forEach((p, dataIndex) => {
    const k = slots.length - 1 - (end - dayIndex(p.ts));
    if (k >= 0 && k < slots.length) {
      slots[k] = { ts: p.ts, value: Number.isFinite(p.value) ? p.value : 0, dataIndex };
    }
  });
  return slots;
}

/** Age ramp: oldest at the dimmest rung, newest-but-one at the brighter. */
function rampColor(i: number, n: number): string {
  const t = n <= 1 ? 1 : i / (n - 1);
  return `color-mix(in oklab, var(--color-lime-dimmer), var(--color-lime-dim) ${(t * 100).toFixed(1)}%)`;
}

/** The boards' emphasis: a soft bloom, not a halo. */
const GLOW = "0 0 10px 0 color-mix(in oklab, var(--color-yellow) 55%, transparent)";

/** Floor for the line variant's y-domain, as a fraction of the latest VALUE.
 *  2% is the smallest move worth drawing as a shape; anything under it is noise
 *  and should read flat. See the note in LineSeries. */
const MIN_SPAN_PCT = 0.02;

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
  note,
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
  /** A standing qualifier on what this card COUNTS, pinned to the range line —
   *  e.g. "gacha only" for a platform whose secondary market we can't see. Unlike
   *  `emptyDetail` it shows alongside real data: the series is honest, but its
   *  scope needs saying. */
  note?: string;
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

  // Day slots across the whole window — the plot's real geometry. `hover` indexes
  // SLOTS, so an empty day can't resolve to a reading.
  const slots = toSlots(data, windowDays);
  const active = hover != null ? slots[hover] : null;
  const headline = active ? active.value : total;
  const caption = active ? fmtDay(active.ts) : totalCaption;

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
          slots={slots}
          dataLength={data.length}
          fmt={fmt}
          variant={variant}
          hover={hover}
          onHover={setHover}
        />
      )}

      {hasData ? (
        <div className="mt-2 font-mono text-[10.5px] text-ink-4">
          {rangeLabel}
          {note ? <span className="text-ink-3">{` · ${note}`}</span> : null}
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
  slots,
  dataLength,
  fmt,
  variant,
  hover,
  onHover,
}: {
  slots: Slot[];
  dataLength: number;
  fmt: (n: number) => string;
  variant: "bars" | "line";
  hover: number | null;
  onHover: (i: number | null) => void;
}) {
  const n = slots.length;
  const active = hover != null ? slots[hover] : null;
  // Clamp so an edge tooltip doesn't hang off the card.
  const leftPct = hover != null ? Math.min(Math.max(((hover + 0.5) / n) * 100, 14), 86) : 0;

  return (
    <div className="relative mt-3 h-16">
      {/* Days the series doesn't reach, drawn as a faint tick on the baseline —
          one per empty day, so the flex gaps between them make the run read as a
          dotted rule. Without it a young series is a mark floating beside a void
          and the card looks broken; with it the void is an axis waiting to fill,
          which is what it is. Behind the series, and only ever visible when
          there ARE empty days. */}
      <div className="pointer-events-none absolute inset-0 flex items-end gap-[3px]">
        {slots.map((s, i) =>
          s ? (
            <div key={s.ts} className="min-w-0 flex-1" />
          ) : (
            <div key={`void-${i}`} className="min-w-0 flex-1">
              <span className="block h-px w-full bg-line-2" />
            </div>
          ),
        )}
      </div>

      {variant === "line" ? (
        <LineSeries slots={slots} dataLength={dataLength} hover={hover} />
      ) : (
        <Bars slots={slots} hover={hover} />
      )}

      {/* Hover bands — invisible, full-height, one per DAY. Full-height so a
          near-zero bar is still reachable; hit area shouldn't track magnitude.
          ⚠️ An empty day CLEARS the hover, it isn't inert: leaving that band with
          no handler kept the last real bar highlighted as the cursor slid over
          the blank stretch of a young series — a hover that stuck past the bar it
          belonged to. Clearing on enter makes the blank read as nothing, which is
          what it is, and is also what fixes the "sticky after mouseleave" report. */}
      <div className="absolute inset-0 flex gap-[3px]" onMouseLeave={() => onHover(null)}>
        {slots.map((s, i) => (
          <div
            key={s ? s.ts : `empty-${i}`}
            className="min-w-0 flex-1 cursor-default"
            onMouseEnter={() => onHover(s ? i : null)}
          />
        ))}
      </div>

      {active ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-line-2 bg-bg-2/95 px-2 py-1 font-mono text-[10.5px] shadow-[0_8px_24px_rgba(0,0,0,0.55)] backdrop-blur"
          style={{ left: `${leftPct}%` }}
        >
          <span className="text-ink-3">{fmtDay(active.ts)}</span>
          <span className="mx-1.5 text-ink-4">·</span>
          <span className="font-bold text-ink">{fmt(active.value)}</span>
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
  slots,
  hover,
}: {
  slots: Slot[];
  hover: number | null;
}) {
  const present = slots.filter((s): s is NonNullable<Slot> => s != null);
  const values = present.map((s) => s.value);
  const posMax = Math.max(0, ...values);
  const negMax = Math.min(0, ...values); // ≤ 0
  const span = posMax - negMax || 1;
  const baseFromBottom = (-negMax / span) * 100;
  const diverging = negMax < 0;
  const newest = present.length ? present[present.length - 1].dataIndex : -1;

  return (
    <div className="pointer-events-none absolute inset-0 flex items-stretch gap-[3px]">
      {diverging ? (
        <span
          aria-hidden
          className="absolute inset-x-0 z-10 border-t border-dashed border-line-2"
          style={{ bottom: `${baseFromBottom}%` }}
        />
      ) : null}
      {slots.map((s, i) => {
        // A day this series doesn't cover holds its slot and draws nothing —
        // that blank IS the information.
        if (!s) return <div key={`empty-${i}`} className="min-w-0 flex-1" />;
        const v = s.value;
        const last = s.dataIndex === newest;
        const on = hover === i;
        // Floor the drawn height so a zero day still reads as a tick instead of
        // vanishing — the day happened, and a gap would imply missing data.
        const h = Math.max(2.5, (Math.abs(v) / span) * 100);
        const negative = v < 0;
        // Hovered bar takes full lime + the glow, so the highlight reads the same
        // as the newest-bar emphasis rather than inventing a second visual idiom.
        // Ramp over the series' own length, not the slot count: a 3-day series
        // should still read oldest→newest across its three bars rather than
        // arriving pre-brightened because it happens to sit at the right edge.
        const bg = negative
          ? "var(--color-red)"
          : on || last
            ? "var(--color-yellow)"
            : rampColor(s.dataIndex, present.length);
        return (
          <div key={s.ts} className="relative min-w-0 flex-1">
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
  slots,
  dataLength,
  hover,
}: {
  slots: Slot[];
  dataLength: number;
  hover: number | null;
}) {
  const W = 200;
  const H = 64;
  const PAD = 5;
  const present = slots
    .map((s, i) => (s ? { ...s, slot: i } : null))
    .filter((s): s is NonNullable<Slot> & { slot: number } => s != null);
  const values = present.map((s) => s.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const latest = values[values.length - 1] ?? 0;
  /**
   * ⚠️ The y-domain is at least MIN_SPAN_PCT of the VALUE — not just the data's
   * own min–max.
   *
   * Auto-fitting the range makes every series fill the box, whatever it did: a
   * holders count drifting 0.3% in a fortnight drew the same hockey stick as one
   * that doubled. Scaling noise to full height is a claim, and it was a false
   * one. Against a value-relative floor a 0.3% drift occupies ~15% of the card
   * and reads as what it is — flat.
   *
   * A series that genuinely moves more than the floor keeps auto-fitting, so
   * this only ever damps the noise; it never flattens a real move.
   */
  const span = Math.max(max - min, Math.abs(latest) * MIN_SPAN_PCT) || 1;
  // Centre the data in the domain. This also subsumes the old dead-flat special
  // case: when max === min the reading lands exactly mid-card on its own.
  const mid = (min + max) / 2;
  const lo = mid - span / 2;
  // x is the DAY's position in the window, so three readings occupy three
  // fourteenths at the right edge instead of stretching across the card.
  const X = (slot: number) => (slots.length <= 1 ? W / 2 : (slot / (slots.length - 1)) * W);
  const Y = (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2);

  const hoverPt = hover != null ? present.find((s) => s.slot === hover) ?? null : null;

  // Split the readings into contiguous RUNS — maximal sequences of adjacent day
  // slots with no hole. The line is drawn PER RUN so it pens UP over interior
  // missing days (the Jul 17–19-style holes): no solid segment is ever drawn
  // across a day the series never reported. A subtle dashed connector bridges each
  // gap so the level still reads continuous, while announcing "no data here" —
  // the same story the baseline gap ticks behind it already tell.
  const runs: (NonNullable<Slot> & { slot: number })[][] = [];
  for (const s of present) {
    const cur = runs[runs.length - 1];
    if (cur && s.slot === cur[cur.length - 1].slot + 1) cur.push(s);
    else runs.push([s]);
  }
  const ptOf = (s: NonNullable<Slot> & { slot: number }) => [X(s.slot), Y(s.value)] as [number, number];

  return (
    <div className="pointer-events-none absolute inset-0">
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      role="img"
      aria-label={`Latest ${formatPoint(present)}`}
    >
      <defs>
        <linearGradient id="mbc-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-yellow)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--color-yellow)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Per-run area + solid line. A one-point run draws no line — just its dot,
          below — so an isolated reading between two gaps is still visible.
          non-scaling-stroke: preserveAspectRatio="none" would otherwise stretch
          the stroke horizontally with the box. */}
      {runs.map((run, ri) => {
        if (run.length < 2) return null;
        const pts = run.map(ptOf);
        const line = monotonePath(pts);
        const area = `${line} L${pts[pts.length - 1][0]} ${H} L${pts[0][0]} ${H} Z`;
        return (
          <g key={`run-${ri}`}>
            <path d={area} fill="url(#mbc-area)" />
            <path d={line} fill="none" stroke="var(--color-yellow)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
      {/* Dashed connectors across the interior gaps — dimmed + dashed so they can't
          be mistaken for a real reading. */}
      {runs.slice(1).map((run, i) => {
        const a = runs[i][runs[i].length - 1];
        const b = run[0];
        return (
          <line
            key={`gap-${i}`}
            x1={X(a.slot)}
            y1={Y(a.value)}
            x2={X(b.slot)}
            y2={Y(b.value)}
            stroke="var(--color-yellow)"
            strokeOpacity="0.3"
            strokeWidth="1.2"
            strokeDasharray="2 2.5"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {/* Crosshair rule for a longer series (its dot is drawn in the HTML layer
          below). `hover` is a SLOT index that only lands on days with a reading,
          so the marker never drifts off the compacted series. */}
      {hoverPt && dataLength > 4 ? (
        <line
          x1={X(hoverPt.slot)}
          y1={0}
          x2={X(hoverPt.slot)}
          y2={H}
          stroke="var(--color-line-2)"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
    {/* Dots live OUTSIDE the stretched SVG. preserveAspectRatio="none" scales the
        canvas non-uniformly, which turned every <circle> into a wide ellipse
        (vector-effect protects strokes, not geometry). HTML dots at percentage
        coordinates with a fixed pixel size are round by construction.
        Which readings get a dot: every reading on a short series (a 2-point run
        is a bare diagonal otherwise), any ISOLATED reading whatever the length
        (else it's an invisible point between two gaps), and the hovered one. */}
    {present.map((s) => {
      const isolated = runs.some((r) => r.length === 1 && r[0].slot === s.slot);
      const on = hover === s.slot;
      if (!(dataLength <= 4 || isolated || on)) return null;
      const size = on ? 7 : 5;
      return (
        <span
          key={s.ts}
          aria-hidden
          className="absolute rounded-full"
          style={{
            left: `${(X(s.slot) / W) * 100}%`,
            top: `${(Y(s.value) / H) * 100}%`,
            width: size,
            height: size,
            transform: "translate(-50%, -50%)",
            background: "var(--color-yellow)",
            boxShadow: on ? GLOW : undefined,
          }}
        />
      );
    })}
    </div>
  );
}

/** aria-label helper — the raw latest reading, unformatted by unit. */
function formatPoint(present: NonNullable<Slot>[]): string {
  if (!present.length) return "no data";
  const last = present[present.length - 1];
  return `${last.value} on ${fmtDay(last.ts)}`;
}
