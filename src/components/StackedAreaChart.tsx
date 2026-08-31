"use client";

import { useMemo, useRef, useState } from "react";
import { Section } from "./Section";
import { MetricInfo } from "./MetricInfo";
import { ChartTooltip, anchorFromEvent, type TooltipAnchor } from "./ChartTooltip";
import { formatCompactUsd, formatCompactNumber } from "@/lib/format";
import type { SeriesPoint } from "@/lib/data/metricSnapshots";
import type { MetricKey } from "@/lib/metrics/glossary";

/**
 * StackedAreaChart — the lead chart: several platforms' daily flow, stacked, with
 * a draggable brush.
 *
 * WHY AREAS AND NOT THE COLUMNS CompositionChart DRAWS. Both answer "who is
 * winning turnover", but at 30+ days of daily data columns become a picket fence:
 * the eye reads the gaps, not the trend. A filled area reads as one continuous
 * quantity, which is what a daily flow is. CompositionChart keeps the short,
 * dense windows and the 100%-share mode; this takes the long lead position.
 *
 * ⚠️ STACK ORDER IS FIXED BY TOTAL, NOT PER DAY. Bands are ordered once, by their
 * total over the whole window, largest at the bottom. Re-sorting per day would
 * make bands swap places mid-chart and turn a stable platform's band into a
 * zig-zag that looks like volatility it does not have.
 *
 * ⚠️ A GAP IS NOT A ZERO. A day a platform has no reading contributes 0 to the
 * stack (there is nothing else a stack can do with it) but the tooltip shows "—"
 * for that band, so a missing reading never reads as a measured zero.
 */
const FILL_OPACITY = 0.35;
const PLOT_H = 260;
const BRUSH_H = 44;
const VB_W = 1000;
const PAD_R = 46;
const DAY = 86_400_000;

export type AreaSeries = {
  key: string;
  label: string;
  color: string;
  points: SeriesPoint[];
};

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function StackedAreaChart({
  title,
  readMe,
  subtitle,
  metric,
  series,
  unit = "usd",
  className,
}: {
  title: string;
  readMe?: string;
  subtitle?: string;
  metric?: MetricKey;
  series: AreaSeries[];
  unit?: "usd" | "count";
  className?: string;
}) {
  const fmt = (n: number) => (unit === "usd" ? formatCompactUsd(n) : formatCompactNumber(n));
  const [hover, setHover] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null);
  const [win, setWin] = useState<[number, number] | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);

  // Union of every day any band reports, plus per-band lookup. Bands are ordered
  // ONCE here (see the note above) and that order is used for the stack, the
  // legend and the tooltip, so all three agree.
  const { days, ordered, fullRange } = useMemo(() => {
    const set = new Set<number>();
    for (const s of series) {
      for (const p of s.points) {
        const t = Date.parse(p.ts);
        if (Number.isFinite(t) && Number.isFinite(p.value)) set.add(t);
      }
    }
    const days = [...set].sort((a, b) => a - b);
    const totals = new Map<string, number>();
    for (const s of series) {
      totals.set(s.key, s.points.reduce((a, p) => a + (Number.isFinite(p.value) ? p.value : 0), 0));
    }
    const ordered = [...series]
      .sort((a, b) => (totals.get(b.key) ?? 0) - (totals.get(a.key) ?? 0))
      .map((s) => ({
        ...s,
        at: new Map(
          s.points
            .filter((p) => Number.isFinite(Date.parse(p.ts)) && Number.isFinite(p.value))
            .map((p) => [Date.parse(p.ts), p.value] as const),
        ),
      }));
    return {
      days,
      ordered,
      fullRange: days.length ? ([days[0], days[days.length - 1]] as [number, number]) : null,
    };
  }, [series]);

  const window: [number, number] | null = win ?? fullRange;
  const visible = useMemo(
    () => (window ? days.filter((d) => d >= window[0] && d <= window[1]) : days),
    [days, window],
  );

  // Columns of cumulative tops — the stack, resolved once per visible day.
  // Plain loops, not nested map+accumulator: a `let` reassigned inside a callback
  // trips react-hooks/immutability even where it is provably local, and the loop
  // form is what the rule is asking for anyway.
  const { cols, maxTotal } = useMemo(() => {
    const out: { ts: number; bands: { key: string; label: string; color: string; lo: number; hi: number; value: number | null }[]; total: number }[] = [];
    let peak = 0;
    for (const d of visible) {
      const bands: { key: string; label: string; color: string; lo: number; hi: number; value: number | null }[] = [];
      let running = 0;
      for (const s of ordered) {
        const raw = s.at.get(d);
        const v = raw != null && Number.isFinite(raw) ? raw : 0;
        bands.push({ key: s.key, label: s.label, color: s.color, lo: running, hi: running + v, value: raw ?? null });
        running += v;
      }
      if (running > peak) peak = running;
      out.push({ ts: d, bands, total: running });
    }
    return { cols: out, maxTotal: peak || 1 };
  }, [visible, ordered]);

  if (!days.length || !window) {
    return (
      <Section title={title} readMe={readMe} subtitle={subtitle} className={className} flush>
        <div className="mx-4 mb-4 flex h-40 items-center justify-center rounded-lg border border-dashed border-line text-[12.5px] text-ink-3 sm:mx-5 sm:mb-5">
          Building history
        </div>
      </Section>
    );
  }

  const titleNode = metric ? (
    <span className="inline-flex items-center gap-1.5">
      {title}
      <MetricInfo metric={metric} />
    </span>
  ) : (
    title
  );

  const innerW = VB_W - PAD_R;
  const X = (i: number) => (cols.length <= 1 ? innerW / 2 : (i / (cols.length - 1)) * innerW);
  const Y = (v: number) => PLOT_H - (v / maxTotal) * PLOT_H;

  // One <path> per band: forward along its top edge, back along the one beneath.
  const paths = ordered.map((s, bi) => {
    if (!cols.length) return { key: s.key, d: "", top: "", color: s.color };
    const top = cols.map((c, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(c.bands[bi].hi).toFixed(1)}`).join(" ");
    const back = cols
      .map((c, i) => `L${X(cols.length - 1 - i).toFixed(1)} ${Y(cols[cols.length - 1 - i].bands[bi].lo).toFixed(1)}`)
      .join(" ");
    return { key: s.key, d: `${top} ${back} Z`, top, color: s.color };
  });

  const active = hover != null ? cols[hover] ?? null : null;

  return (
    <Section title={titleNode} readMe={readMe} subtitle={subtitle} className={className} flush>
      <div className="px-4 pb-4 pt-1 sm:px-5 sm:pb-5">
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {ordered.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-[11.5px]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="text-ink-2">{s.label}</span>
            </span>
          ))}
        </div>

        <div
          ref={plotRef}
          className="relative"
          style={{ height: PLOT_H }}
          onMouseLeave={() => {
            setHover(null);
            setAnchor(null);
          }}
          onMouseMove={(e) => {
            const r = plotRef.current?.getBoundingClientRect();
            if (!r || !cols.length) return;
            // Map the cursor to the nearest COLUMN, and do it against the plot's
            // real width — the viewBox stretches, so a viewBox-space calculation
            // drifts from the pointer at any width but the nominal one.
            const usable = r.width * (innerW / VB_W);
            const f = Math.max(0, Math.min(1, (e.clientX - r.left) / (usable || 1)));
            setHover(Math.round(f * (cols.length - 1)));
            setAnchor(anchorFromEvent(e));
          }}
        >
          <svg
            viewBox={`0 0 ${VB_W} ${PLOT_H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            role="img"
            aria-label={`${title} — stacked daily ${unit === "usd" ? "volume" : "count"} by platform`}
          >
            {/* Hairline dashed grid. non-scaling-stroke keeps it a hairline at any
                width; without it preserveAspectRatio="none" fattens the dashes. */}
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <line
                key={f}
                x1={0}
                y1={PLOT_H - f * PLOT_H}
                x2={innerW}
                y2={PLOT_H - f * PLOT_H}
                stroke="var(--color-line)"
                strokeDasharray="2 4"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {paths.map((p) => (
              <path key={p.key} d={p.d} fill={p.color} fillOpacity={FILL_OPACITY} />
            ))}
            {/* Top edge at full colour so adjacent soft fills stay separable. */}
            {paths.map((p) => (
              <path
                key={`e-${p.key}`}
                d={p.top}
                fill="none"
                stroke={p.color}
                strokeWidth={1.25}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {active && hover != null && (
              <line
                x1={X(hover)}
                y1={0}
                x2={X(hover)}
                y2={PLOT_H}
                stroke="var(--color-line-2)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {/* $-unit axis, in DOM text so it never inherits the viewBox stretch. */}
          <div className="pointer-events-none absolute inset-0">
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <span
                key={f}
                className="absolute right-0 -translate-y-1/2 font-mono text-[9.5px] leading-none text-ink-4"
                style={{ top: `${(1 - f) * 100}%` }}
              >
                {fmt(maxTotal * f)}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-ink-4" style={{ paddingRight: `${(PAD_R / VB_W) * 100}%` }}>
          <span>{fmtDate(window[0])}</span>
          <span>{fmtDate(window[1])}</span>
        </div>

        <Brush full={fullRange!} window={window} cols={days} onChange={setWin} />

        <ChartTooltip anchor={active ? anchor : null} width={214}>
          <div className="mb-1 text-ink-3">{active ? fmtDate(active.ts) : ""}</div>
          {[...(active?.bands ?? [])].reverse().map((b) => (
            <div key={b.key} className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 shrink-0" style={{ background: b.color }} />
              <span className="text-ink-3">{b.label}</span>
              <span className="ml-auto pl-3 font-semibold tabular text-ink">
                {/* null = no reading that day. It contributes 0 to the stack
                    because a stack has no other option, but it must not print as
                    a measured $0 here. */}
                {b.value == null ? "—" : fmt(b.value)}
              </span>
            </div>
          ))}
          {active && (
            <div className="mt-1 flex items-center gap-1.5 border-t border-line-2 pt-1">
              <span className="text-ink-3">Total</span>
              <span className="ml-auto pl-3 font-semibold tabular text-ink">{fmt(active.total)}</span>
            </div>
          )}
        </ChartTooltip>
      </div>
    </Section>
  );
}

/**
 * Window brush — the Index Studio's interaction model, reduced to what a lead
 * chart needs: drag the body to pan, the handles to resize, empty track to select
 * a fresh window. Same lime handles and dimmed out-of-window fills, so the two
 * charts feel like one control.
 */
function Brush({
  full,
  window: win,
  cols,
  onChange,
}: {
  full: [number, number];
  window: [number, number];
  cols: number[];
  onChange: (w: [number, number] | null) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ mode: "l" | "r" | "pan" | "new"; grab?: number; w0?: [number, number]; anchor?: number } | null>(null);
  const W = VB_W;
  const [lo, hi] = full;
  const span = hi - lo || 1;
  const X = (ms: number) => ((ms - lo) / span) * W;
  const msAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return lo + Math.max(0, Math.min(1, (clientX - r.left) / (r.width || 1))) * span;
  };

  const onDown = (e: React.PointerEvent) => {
    const role = (e.target as SVGElement).getAttribute?.("data-h");
    const ms = msAt(e.clientX);
    // A full-width window has nothing to pan, and its body covers the whole
    // track — so a drag that starts on it is the user doing what the hint says
    // ("drag to zoom") and must SELECT, or the gesture silently does nothing.
    const isFull = win[0] <= lo && win[1] >= hi;
    if (role === "l" || role === "r") drag.current = { mode: role };
    else if (role === "body" && !isFull) drag.current = { mode: "pan", grab: ms, w0: [...win] as [number, number] };
    else drag.current = { mode: "new", anchor: ms };
    // Capture can throw for a pointer that is already gone; losing capture only
    // degrades the drag (moves outside the svg stop tracking) — never the page.
    try {
      ref.current?.setPointerCapture(e.pointerId);
    } catch {
      /* drag continues uncaptured */
    }
    e.preventDefault();
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const ms = msAt(e.clientX);
    let [a, b] = win;
    const min = 2 * DAY;
    if (drag.current.mode === "l") a = Math.min(ms, b - min);
    else if (drag.current.mode === "r") b = Math.max(ms, a + min);
    else if (drag.current.mode === "new") {
      a = Math.min(drag.current.anchor!, ms);
      b = Math.max(drag.current.anchor!, ms);
      if (b - a < min) b = a + min;
    } else if (drag.current.mode === "pan") {
      const d = ms - drag.current.grab!;
      const w0 = drag.current.w0!;
      const sp = w0[1] - w0[0];
      a = w0[0] + d;
      b = w0[1] + d;
      if (a < lo) { a = lo; b = lo + sp; }
      if (b > hi) { b = hi; a = hi - sp; }
    }
    a = Math.max(lo, a);
    b = Math.min(hi, b);
    // Clamp-churn guard (the Index Studio wheel-storm lesson, PR #53): an
    // edge-pinned pan or a clamped resize lands on the SAME window every move,
    // and committing a fresh array for identical values re-renders the whole
    // stack per pointermove for nothing.
    if (a === win[0] && b === win[1]) return;
    onChange([a, b]);
  };
  const onUp = () => {
    drag.current = null;
  };

  const x0 = X(win[0]);
  const x1 = X(win[1]);
  const zoomed = win[0] > lo || win[1] < hi;

  return (
    <div className="mt-2">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${BRUSH_H}`}
        width="100%"
        height={BRUSH_H}
        preserveAspectRatio="none"
        className="block cursor-ew-resize touch-none"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <rect x={0} y={0} width={W} height={BRUSH_H} fill="var(--color-bg-2)" />
        {/* Weekly ticks, not daily. At 90+ days a tick per day stretches into a
            solid hatch under preserveAspectRatio="none" and the track stops
            reading as a timeline — it reads as a filled bar. */}
        {cols.filter((_, i) => i % 7 === 0).map((d) => (
          <line
            key={d}
            x1={X(d)}
            y1={BRUSH_H - 9}
            x2={X(d)}
            y2={BRUSH_H - 4}
            stroke="var(--color-line-2)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <rect x={0} y={0} width={Math.max(0, x0)} height={BRUSH_H} fill="var(--color-bg)" opacity={0.62} />
        <rect x={x1} y={0} width={Math.max(0, W - x1)} height={BRUSH_H} fill="var(--color-bg)" opacity={0.62} />
        <rect
          data-h="body"
          x={x0}
          y={1}
          width={Math.max(2, x1 - x0)}
          height={BRUSH_H - 2}
          fill="var(--color-yellow)"
          opacity={0.06}
          stroke="var(--color-yellow)"
          strokeOpacity={0.3}
          vectorEffect="non-scaling-stroke"
          className="cursor-grab"
        />
        <rect data-h="l" x={x0 - 3} y={6} width={6} height={BRUSH_H - 12} rx={2} fill="var(--color-yellow)" opacity={0.85} className="cursor-ew-resize" />
        <rect data-h="r" x={x1 - 3} y={6} width={6} height={BRUSH_H - 12} rx={2} fill="var(--color-yellow)" opacity={0.85} className="cursor-ew-resize" />
      </svg>
      <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-ink-4">
        <span>drag to zoom · drag the band to pan</span>
        {zoomed && (
          <button type="button" onClick={() => onChange(null)} className="text-ink-3 transition-colors hover:text-yellow">
            reset
          </button>
        )}
      </div>
    </div>
  );
}
