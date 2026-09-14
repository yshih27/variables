"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Section } from "./Section";
import { ChartActions } from "./ChartActions";
import { MetricInfo } from "./MetricInfo";
import { ChartTooltip, anchorFromEvent, type TooltipAnchor } from "./ChartTooltip";
import { formatCompactUsd, formatCompactNumber } from "@/lib/format";
import type { SeriesPoint } from "@/lib/data/metricSnapshots";
import type { MetricKey } from "@/lib/metrics/glossary";
import { resampleToPeriod, type Period } from "@/lib/chart/period";
import { useWindowPref } from "@/lib/windowPref";

/**
 * StackedAreaChart — the lead chart: several platforms' daily flow, stacked, with
 * a draggable brush and a Stacked / 100% share / Cumulative mode switch.
 *
 * ONE CANVAS, THREE READS (the one-question-per-zone rule). Same-family depth
 * lives in this in-chart switcher, never in a second stacked chart further down
 * the page:
 *   Stacked      — raw daily values stacked; the y-axis is the day's total.
 *   100% share   — each day normalised to 100%; reads share-shift over time.
 *   Cumulative   — per-band running sum OVER THE VISIBLE WINDOW; slope = pace.
 * The brush is orthogonal to the mode: it selects days, the mode only changes
 * how those days render — so brushing works identically in all three.
 *
 * ⚠️ STACK ORDER IS FIXED BY TOTAL, NOT PER DAY. Bands are ordered once, by their
 * total over the whole window, largest at the bottom. Re-sorting per day would
 * make bands swap places mid-chart and turn a stable platform's band into a
 * zig-zag that looks like volatility it does not have.
 *
 * ⚠️ A GAP IS NOT A ZERO. A day a platform has no reading contributes 0 to the
 * stack (there is nothing else a stack can do with it) but the tooltip shows "—"
 * for that band — never 0% or $0 — so a missing reading never reads as a
 * measured zero. Cumulative sums only finite readings, and never back-fills
 * before a band's first one (that stays a gap, honestly).
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
  /**
   * Where the band's entity lives (nav r3, homepage hand-offs). With it, the
   * legend chip is a link and the band itself is clickable; without it both are
   * inert, as before. Cursor and underline on hover only — a band's colour is
   * its identity and is not touched.
   */
  href?: string;
};

/**
 * A single line drawn over the stack on its OWN right axis — a percentage that
 * lives in a different unit from the bands beneath it (the payout ÷ spend ratio
 * on /economics).
 *
 * ⚠️ OPTIONAL, AND OFF EVERYWHERE ELSE. /platforms and /ips pass neither this nor
 * `grainSurface`, so their chart is byte-identical to before.
 */
export type AreaOverlay = {
  label: string;
  color: string;
  /** Percent points (0–100+), same day keys as the bands. */
  points: SeriesPoint[];
};

const PERIODS: Period[] = ["D", "W", "M"];

type Mode = "stacked" | "share" | "cumulative";
const MODES: { key: Mode; label: string }[] = [
  { key: "stacked", label: "Stacked" },
  { key: "share", label: "100% share" },
  { key: "cumulative", label: "Cumulative" },
];

// MODE-AWARE like IPByPlatform's donut clause: a fixed "band thickness is one
// platform's daily take" becomes a false claim the moment the mode flips —
// in 100% a band is a share, in Cumulative it is a running total. Callers pass
// only the framing prefix; the component appends the clause that is true NOW.
const MODE_CLAUSE: Record<Mode, string> = {
  stacked: "band thickness is one platform's daily take",
  share: "band height is share of that day",
  cumulative: "bands accumulate — slope is the daily take",
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
  chartId,
  actions = true,
  grainSurface,
  overlay,
}: {
  title: string;
  /** How to read it (see <ReadMe>) — the FRAMING only ("who is winning
   *  turnover"). The band clause is appended inside the component, because what
   *  a band means depends on the live Stacked / 100% share / Cumulative mode. */
  readMe?: string;
  subtitle?: string;
  metric?: MetricKey;
  series: AreaSeries[];
  unit?: "usd" | "count";
  className?: string;
  /** `/embed/[chart]` id. Omit and the card offers no embed. */
  chartId?: string;
  /**
   * false inside `/embed/[chart]`.
   *
   * ⚠️ AN EMBED OFFERS NO EXPORTS. It renders inside someone else's page, where a
   * CSV button is chrome for a site the reader is not on — the route's own
   * contract says "no shell, no nav, no actions", and the band was the one part
   * still ignoring it.
   */
  actions?: boolean;
  /**
   * localStorage surface for a D | W | M grain control (P1-B). Omit and no
   * control renders and the series are untouched — which is what every existing
   * caller does.
   */
  grainSurface?: string;
  /** A right-axis line over the stack. Omit for no overlay. */
  overlay?: AreaOverlay;
}) {
  const fmt = (n: number) => (unit === "usd" ? formatCompactUsd(n) : formatCompactNumber(n));
  const [mode, setMode] = useState<Mode>("stacked");
  const [period, setPeriod] = useWindowPref<Period>(grainSurface ?? null, PERIODS, "D");
  const [hover, setHover] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null);
  const [win, setWin] = useState<[number, number] | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  // The plot <svg> itself, for the PNG export. Separate from plotRef, which is
  // the positioned wrapper the pointer maths measures against.
  const svgRef = useRef<SVGSVGElement>(null);

  /**
   * The grain, applied BEFORE everything else — so the stack, the brush, the
   * tooltip and the cumulative mode all operate on the aggregated series and
   * needed no changes at all.
   *
   * Bands are FLOWS, so they sum; the overlay is a RATIO and cannot be summed,
   * so it is re-derived per period by the caller if it needs to be. Here it
   * takes the period's close, which is the honest reading of a rate.
   */
  const shaped = useMemo(
    () =>
      period === "D"
        ? series
        : series.map((b) => ({ ...b, points: resampleToPeriod(b.points, period, "sum", {}) })),
    [series, period],
  );
  const shapedOverlay = useMemo(
    () =>
      !overlay
        ? null
        : period === "D"
          ? overlay
          : { ...overlay, points: resampleToPeriod(overlay.points, period, "last", {}) },
    [overlay, period],
  );

  // Union of every day any band reports, plus per-band lookup. Bands are ordered
  // ONCE here (see the note above) and that order is used for the stack, the
  // legend and the tooltip, so all three agree.
  const { days, ordered, fullRange } = useMemo(() => {
    const set = new Set<number>();
    for (const s of shaped) {
      for (const p of s.points) {
        const t = Date.parse(p.ts);
        if (Number.isFinite(t) && Number.isFinite(p.value)) set.add(t);
      }
    }
    const days = [...set].sort((a, b) => a - b);
    const totals = new Map<string, number>();
    for (const s of shaped) {
      totals.set(s.key, s.points.reduce((a, p) => a + (Number.isFinite(p.value) ? p.value : 0), 0));
    }
    const ordered = [...shaped]
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
  }, [shaped]);

  const window: [number, number] | null = win ?? fullRange;
  const visible = useMemo(
    () => (window ? days.filter((d) => d >= window[0] && d <= window[1]) : days),
    [days, window],
  );

  // Columns of cumulative tops — the stack, resolved once per visible day, in
  // MODE UNITS ($ stacked, % share, running-$ cumulative). `value` stays the raw
  // reading (null = no reading) and `cum` the window running sum, so the tooltip
  // can stay honest whatever geometry the mode draws.
  // Plain loops, not nested map+accumulator: a `let` reassigned inside a callback
  // trips react-hooks/immutability even where it is provably local, and the loop
  // form is what the rule is asking for anyway.
  const { cols, maxTotal } = useMemo(() => {
    type Band = { key: string; label: string; color: string; lo: number; hi: number; value: number | null; cum: number | null };
    const out: { ts: number; bands: Band[]; total: number; rawTotal: number }[] = [];
    let peak = 0;
    // Cumulative state per band. Local to this memo on purpose: the running sum
    // is over the VISIBLE window, so a brush move recomputes it from the window's
    // first day — never from all time.
    const cum = new Map<string, { sum: number; started: boolean }>();
    for (const s of ordered) cum.set(s.key, { sum: 0, started: false });
    for (const d of visible) {
      // The day's Σ of finite readings, resolved before the band pass — a share
      // is value / THIS, and it must exclude the gaps it excuses.
      let rawTotal = 0;
      for (const s of ordered) {
        const raw = s.at.get(d);
        if (raw != null) rawTotal += raw;
      }
      const bands: Band[] = [];
      let running = 0;
      for (const s of ordered) {
        const raw = s.at.get(d) ?? null; // `at` holds only finite readings
        const c = cum.get(s.key)!;
        if (raw != null) {
          c.sum += raw;
          c.started = true;
        }
        // Geometry per mode. A gap contributes 0 to the stack (there is nothing
        // else a stack can do with it); the tooltip shows "—" via `value`.
        // Cumulative carries forward AFTER a band's first reading (a running
        // total doesn't drop on a quiet day) but never back-fills before it.
        let v = 0;
        if (mode === "stacked") v = raw ?? 0;
        else if (mode === "share") v = raw != null && rawTotal > 0 ? (raw / rawTotal) * 100 : 0;
        else v = c.started ? c.sum : 0;
        bands.push({
          key: s.key,
          label: s.label,
          color: s.color,
          lo: running,
          hi: running + v,
          value: raw,
          cum: c.started ? c.sum : null,
        });
        running += v;
      }
      if (running > peak) peak = running;
      out.push({ ts: d, bands, total: running, rawTotal });
    }
    return { cols: out, maxTotal: mode === "share" ? 100 : peak || 1 };
  }, [visible, ordered, mode]);

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

  /**
   * Overlay geometry. Its domain ALWAYS includes 100 — the baseline is the
   * reading ("paid out what came in"), so a chart that cropped it would hide the
   * one number the line exists to be compared against.
   */
  const overlayAt = shapedOverlay
    ? new Map(
        shapedOverlay.points
          .filter((p) => Number.isFinite(Date.parse(p.ts)) && Number.isFinite(p.value))
          .map((p) => [Date.parse(p.ts), p.value] as const),
      )
    : null;
  const overlayVals = overlayAt ? cols.map((c) => overlayAt.get(c.ts)).filter((v): v is number => v != null) : [];
  const oLo = overlayVals.length ? Math.min(100, ...overlayVals) * 0.95 : 0;
  const oHi = overlayVals.length ? Math.max(100, ...overlayVals) * 1.05 : 1;
  const oSpan = oHi - oLo || 1;
  const oY = (v: number) => PLOT_H - ((v - oLo) / oSpan) * PLOT_H;
  const overlayBase = overlayVals.length ? oY(100) : null;
  // Broken into runs so a day the ratio has no reading is a GAP, not a segment
  // drawn straight through it.
  const overlayPath =
    overlayAt && overlayVals.length >= 2
      ? cols
          .map((c, i) => {
            const v = overlayAt.get(c.ts);
            if (v == null) return null;
            const prev = i > 0 ? overlayAt.get(cols[i - 1].ts) : undefined;
            return `${prev == null ? "M" : "L"}${X(i).toFixed(1)} ${oY(v).toFixed(1)}`;
          })
          .filter(Boolean)
          .join(" ")
      : null;

  const active = hover != null ? cols[hover] ?? null : null;

  return (
    <Section
      title={titleNode}
      readMe={readMe ? `${readMe} — ${MODE_CLAUSE[mode]}` : MODE_CLAUSE[mode]}
      subtitle={subtitle}
      right={
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Grain, only where a caller asked for one. Same control shape as the
              mode switch beside it, so adding it cannot change the band's height. */}
          {grainSurface && (
            <div className="flex gap-1 rounded-lg border border-line bg-bg-2 p-0.5">
              {PERIODS.map((pd) => (
                <button
                  key={pd}
                  type="button"
                  onClick={() => setPeriod(pd)}
                  aria-pressed={period === pd}
                  aria-label={pd === "D" ? "Daily" : pd === "W" ? "Weekly" : "Monthly"}
                  className={`rounded-md px-2 py-1 font-mono text-[11px] transition-colors ${
                    period === pd ? "bg-bg-3 font-semibold text-ink" : "text-ink-3 hover:text-ink"
                  }`}
                >
                  {pd}
                </button>
              ))}
            </div>
          )}

        {/* Export lives in the same band as the mode switch — same control height,
            so a card that gains it keeps its frame (and its §7 pairing). */}
        {actions && (
          <ChartActions
            meta={{
              title,
              readMe: readMe ? `${readMe} — ${MODE_CLAUSE[mode]}` : MODE_CLAUSE[mode],
              metricKey: metric,
              unit: unit === "usd" ? "USD" : "count",
              window: subtitle,
              asOf: days.length ? new Date(days[days.length - 1]).toISOString().slice(0, 10) : null,
            }}
            // ⚠️ THE OVERLAY IS PART OF THE EXPORT. Its line folds into the PNG
            // (data-export-layer) and its ratio is one more CSV column; the legend
            // names it too, or the picture carries a dashed line nothing explains.
            series={[
              ...series.map((b) => ({ key: b.key, label: b.label, color: b.color, points: b.points })),
              ...(overlay
                ? [{ key: `overlay:${overlay.label}`, label: `${overlay.label} (%)`, color: overlay.color, points: overlay.points }]
                : []),
            ]}
            svgRef={svgRef}
            plotHeight={PLOT_H}
            legend={[
              ...ordered.map((o) => ({ color: o.color, text: o.label })),
              ...(shapedOverlay ? [{ color: shapedOverlay.color, text: `${shapedOverlay.label} · dashed` }] : []),
            ]}
            chartId={chartId}
          />
        )}
        <div className="flex gap-1 rounded-lg border border-line bg-bg-2 p-0.5">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              aria-pressed={mode === m.key}
              className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                mode === m.key ? "bg-bg-3 font-semibold text-ink" : "text-ink-3 hover:text-ink"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        </div>
      }
      className={className}
      flush
    >
      <div className="px-4 pb-4 pt-1 sm:px-5 sm:pb-5">
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {ordered.map((s) =>
            s.href ? (
              <Link
                key={s.key}
                href={s.href}
                className="flex items-center gap-1.5 text-[11.5px] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                <span className="text-ink-2">{s.label}</span>
              </Link>
            ) : (
              <span key={s.key} className="flex items-center gap-1.5 text-[11.5px]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                <span className="text-ink-2">{s.label}</span>
              </span>
            ),
          )}
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
            ref={svgRef}
            viewBox={`0 0 ${VB_W} ${PLOT_H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            role="img"
            aria-label={`${title} — ${
              mode === "share" ? "daily share of" : mode === "cumulative" ? "cumulative" : "stacked daily"
            } ${unit === "usd" ? "volume" : "count"} by platform`}
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
            {paths.map((p) => {
              const href = series.find((b) => b.key === p.key)?.href;
              const band = <path d={p.d} fill={p.color} fillOpacity={FILL_OPACITY} />;
              // ⚠️ THE BAND IS THE LINK, the tooltip layer above stays
              // pointer-events-none, so the plot's own hover/crosshair keeps
              // working through it. An SVG <a> is a real link: it takes the
              // pointer cursor, Tab reaches it, Enter follows it.
              return href ? (
                <a key={p.key} href={href} className="cursor-pointer focus-visible:outline-none" aria-label={`${series.find((b) => b.key === p.key)?.label ?? p.key} — open venue page`}>
                  <title>{series.find((b) => b.key === p.key)?.label}</title>
                  {band}
                </a>
              ) : (
                <g key={p.key}>{band}</g>
              );
            })}
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

          {/* The overlay, on its OWN scale. Drawn in share/cumulative modes too —
              the ratio is a property of the days on screen, not of how the bands
              beneath it happen to be normalised.
              ⚠️ ITS TICKS GO ON THE LEFT. The brief asked for a right axis, but
              the stack's own $ axis already occupies the right gutter (PAD_R) and
              two scales stacked there would be unreadable — worse, a reader would
              not know which number belonged to which mark. The left gutter is
              empty, so the ratio takes it, in the line's own colour. */}
          {overlayPath && (
            <svg
              viewBox={`0 0 ${VB_W} ${PLOT_H}`}
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
              aria-hidden
              data-export-layer=""
            >
              <path
                d={overlayPath}
                fill="none"
                stroke={shapedOverlay!.color}
                strokeWidth="1.75"
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
              {overlayBase != null && (
                <line
                  x1={0}
                  y1={overlayBase}
                  x2={innerW}
                  y2={overlayBase}
                  stroke={shapedOverlay!.color}
                  strokeOpacity="0.35"
                  strokeWidth="1"
                  strokeDasharray="2 4"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
          )}

          {/* The overlay's own scale, left gutter, in its colour so the pairing
              is unambiguous. */}
          {shapedOverlay && overlayVals.length > 0 && (
            <div className="pointer-events-none absolute inset-0">
              {[0, 0.5, 1].map((f) => (
                <span
                  key={f}
                  className="absolute left-0 -translate-y-1/2 font-mono text-[9.5px] leading-none"
                  style={{ top: `${(1 - f) * 100}%`, color: shapedOverlay.color, opacity: 0.75 }}
                >
                  {(oLo + f * oSpan).toFixed(0)}%
                </span>
              ))}
            </div>
          )}

          {/* Mode-unit axis ($ or %), in DOM text so it never inherits the
              viewBox stretch. */}
          <div className="pointer-events-none absolute inset-0">
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <span
                key={f}
                className="absolute right-0 -translate-y-1/2 font-mono text-[9.5px] leading-none text-ink-4"
                style={{ top: `${(1 - f) * 100}%` }}
              >
                {mode === "share" ? `${Math.round(f * 100)}%` : fmt(maxTotal * f)}
              </span>
            ))}
          </div>
        </div>

        {shapedOverlay && overlayVals.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] text-ink-4">
            <span aria-hidden className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: shapedOverlay.color }} />
            <span>
              {shapedOverlay.label} · left-hand scale {oLo.toFixed(0)}–{oHi.toFixed(0)}% · 100% marked
            </span>
          </div>
        )}

        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-ink-4" style={{ paddingRight: `${(PAD_R / VB_W) * 100}%` }}>
          <span>{fmtDate(window[0])}</span>
          <span>{fmtDate(window[1])}</span>
        </div>

        <Brush full={fullRange!} window={window} cols={days} onChange={setWin} />

        <ChartTooltip anchor={active ? anchor : null} width={mode === "share" ? 240 : 214}>
          <div className="mb-1 text-ink-3">{active ? fmtDate(active.ts) : ""}</div>
          {[...(active?.bands ?? [])].reverse().map((b) => (
            <div key={b.key} className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 shrink-0" style={{ background: b.color }} />
              <span className="text-ink-3">{b.label}</span>
              <span className="ml-auto pl-3 font-semibold tabular text-ink">
                {/* null = no reading that day. It contributes 0 to the stack
                    because a stack has no other option, but it must not print as
                    a measured $0 — or 0% — here. Cumulative shows the running
                    sum instead, "—" until the band's first reading. */}
                {mode === "cumulative"
                  ? b.cum == null
                    ? "—"
                    : fmt(b.cum)
                  : b.value == null
                    ? "—"
                    : mode === "share" && active!.rawTotal > 0
                      ? `${((b.value / active!.rawTotal) * 100).toFixed(1)}% · ${fmt(b.value)}`
                      : fmt(b.value)}
              </span>
            </div>
          ))}
          {active && (
            <div className="mt-1 flex items-center gap-1.5 border-t border-line-2 pt-1">
              <span className="text-ink-3">Total</span>
              <span className="ml-auto pl-3 font-semibold tabular text-ink">
                {/* Share re-plots the day as %, but its total stays the day's $Σ;
                    cumulative's total is the stack's running Σ. */}
                {fmt(mode === "cumulative" ? active.total : active.rawTotal)}
              </span>
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
