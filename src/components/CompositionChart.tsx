"use client";

import { useMemo, useState } from "react";
import type { SeriesPoint } from "@/lib/data/metricSnapshots";
import { Section } from "./Section";
import { MetricInfo } from "./MetricInfo";
import type { MetricKey } from "@/lib/metrics/glossary";
import { formatCompactUsd, formatCompactNumber } from "@/lib/format";

/**
 * CompositionChart — a stacked daily composition (the venue race / the treemap
 * through time). Server-fed: the page hands it the already-shaped per-category
 * daily series (top-N + an "Other" bucket, coloured), and it stacks them with
 * three views:
 *
 *   Stacked      — raw values stacked; the y-axis is the day's total.
 *   100% share   — each day normalised to 100%, so it reads share-shift over time.
 *   Cumulative   — each category's running cumulative, stacked (a growing total).
 *
 * ⚠️ Honest-absence, everywhere: a day a category never reported contributes
 * nothing to that day's stack (it is NOT drawn as 0), and a day NO category
 * reported is a gap column — never an interpolated bridge. In "area" mode the
 * columns simply touch, so dense daily data reads as a filled area and a real
 * hole reads as a hole.
 *
 * Hover brightens the whole day's band (+ a soft bloom) and dims the rest, with a
 * tooltip breaking the day down by category and share. No floating dots.
 */
export type CompositionSeries = {
  key: string;
  label: string;
  color: string;
  /** Daily points, may have gaps. */
  points: SeriesPoint[];
};

type Mode = "stacked" | "share" | "cumulative";
const MODES: { key: Mode; label: string }[] = [
  { key: "stacked", label: "Stacked" },
  { key: "share", label: "100% share" },
  { key: "cumulative", label: "Cumulative" },
];

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (ts: string) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

/** The boards' emphasis: a soft neutral bloom on the hovered band. */
const BAND_GLOW = "0 0 12px 0 rgba(255,255,255,0.22)";
const PLOT_H = 240;

type Seg = { key: string; label: string; color: string; value: number };
type Column = { ts: string; segments: Seg[]; total: number; rawTotal: number };

/** Stack the series into one column per union day, transformed for the mode. */
function buildStacks(series: CompositionSeries[], mode: Mode): { columns: Column[]; maxTotal: number; dates: string[] } {
  const dateSet = new Set<string>();
  for (const s of series) for (const p of s.points) if (Number.isFinite(p.value)) dateSet.add(p.ts);
  const dates = [...dateSet].sort();

  // Per-series value-by-day. Cumulative pre-rolls a running total over the union
  // days, carried forward AFTER the series' first reading (a cumulative doesn't
  // drop on a quiet day) — but never back-filled BEFORE it started (that stays a
  // gap, honestly).
  const byDay = new Map<string, Map<string, number>>();
  for (const s of series) {
    const m = new Map<string, number>();
    if (mode === "cumulative") {
      const own = new Map(s.points.filter((p) => Number.isFinite(p.value)).map((p) => [p.ts, p.value]));
      let cum = 0;
      let started = false;
      for (const d of dates) {
        if (own.has(d)) {
          cum += own.get(d)!;
          started = true;
        }
        if (started) m.set(d, cum);
      }
    } else {
      for (const p of s.points) if (Number.isFinite(p.value)) m.set(p.ts, p.value);
    }
    byDay.set(s.key, m);
  }

  const columns: Column[] = dates.map((d) => {
    // Fixed series order → each colour keeps its vertical slot across days.
    const present: Seg[] = [];
    for (const s of series) {
      const v = byDay.get(s.key)?.get(d);
      if (v != null && Number.isFinite(v)) present.push({ key: s.key, label: s.label, color: s.color, value: v });
    }
    const rawTotal = present.reduce((a, s) => a + s.value, 0);
    const segments =
      mode === "share" && rawTotal > 0 ? present.map((s) => ({ ...s, value: (s.value / rawTotal) * 100 })) : present;
    const total = segments.reduce((a, s) => a + s.value, 0);
    return { ts: d, segments, total, rawTotal };
  });

  const maxTotal = mode === "share" ? 100 : Math.max(1, ...columns.map((c) => c.total));
  return { columns, maxTotal, dates };
}

export function CompositionChart({
  title,
  subtitle,
  metric,
  series,
  unit,
  variant = "area",
  foot,
}: {
  title: string;
  subtitle?: string;
  metric?: MetricKey;
  series: CompositionSeries[];
  unit: "usd" | "count";
  /** "area" columns touch (dense data reads as a filled area); "bars" gaps them. */
  variant?: "bars" | "area";
  /** A muted qualifier under the plot — e.g. how the "Other" bucket is composed. */
  foot?: string;
}) {
  const [mode, setMode] = useState<Mode>("stacked");
  const [hover, setHover] = useState<number | null>(null);
  const fmt = (n: number) => (unit === "usd" ? formatCompactUsd(n) : formatCompactNumber(n));

  const { columns, maxTotal, dates } = useMemo(() => buildStacks(series, mode), [series, mode]);
  const hasData = columns.some((c) => c.segments.length > 0);
  const gapCls = variant === "bars" ? "gap-[2px]" : "gap-0";
  const col = hover != null ? columns[hover] ?? null : null;
  // Clamp the tooltip so an edge column doesn't push it off the card.
  const leftPct = hover != null && columns.length ? Math.min(Math.max(((hover + 0.5) / columns.length) * 100, 16), 84) : 0;

  return (
    <Section
      title={metric ? <span className="inline-flex items-center gap-1.5">{title}<MetricInfo metric={metric} /></span> : title}
      subtitle={subtitle}
      right={
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
      }
      className="font-sans"
      flush
    >
      <div className="px-4 pb-4 pt-1 sm:px-5 sm:pb-5">
        {/* legend */}
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-[11.5px]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="text-ink-2">{s.label}</span>
            </span>
          ))}
        </div>

        {!hasData ? (
          <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-line text-[12.5px] text-ink-3">
            Building history
          </div>
        ) : (
          <>
            <div className="relative" style={{ height: PLOT_H }}>
              {/* gridlines + y labels (right) */}
              {[0, 0.5, 1].map((f) => (
                <div key={f} className="pointer-events-none absolute inset-x-0 flex items-center" style={{ bottom: `${f * 100}%` }}>
                  <span className="h-px w-full bg-line/40" />
                  <span className="ml-1.5 shrink-0 font-mono text-[9.5px] leading-none text-ink-4">
                    {mode === "share" ? `${Math.round(f * 100)}%` : fmt(maxTotal * f)}
                  </span>
                </div>
              ))}

              {/* stacked columns — one per union day; a gap day draws nothing */}
              <div className={`absolute inset-0 flex items-end ${gapCls}`}>
                {columns.map((c, i) => (
                  <div key={c.ts} className="flex h-full min-w-0 flex-1 items-end">
                    {c.segments.length ? (
                      <div
                        className="flex w-full flex-col-reverse overflow-hidden transition-opacity duration-100"
                        style={{
                          height: `${(c.total / maxTotal) * 100}%`,
                          opacity: hover == null || hover === i ? 1 : 0.42,
                          boxShadow: hover === i ? BAND_GLOW : undefined,
                          borderRadius: variant === "bars" ? 2 : 0,
                        }}
                      >
                        {c.segments.map((seg) => (
                          <div key={seg.key} style={{ flexGrow: seg.value || 0.0001, background: seg.color }} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              {/* hover bands — full height so a tiny stack is still reachable; an
                  empty day clears the hover rather than leaving the last one stuck */}
              <div className={`absolute inset-0 flex ${gapCls}`} onMouseLeave={() => setHover(null)}>
                {columns.map((c, i) => (
                  <div
                    key={c.ts}
                    className="min-w-0 flex-1 cursor-default"
                    onMouseEnter={() => setHover(c.segments.length ? i : null)}
                  />
                ))}
              </div>

              {/* tooltip */}
              {col && col.segments.length ? (
                <div
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full z-20 mb-1 w-[176px] -translate-x-1/2 rounded-md border border-line-2 bg-bg-2/95 px-2.5 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.55)] backdrop-blur"
                  style={{ left: `${leftPct}%` }}
                >
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">{fmtDay(col.ts)}</div>
                  {[...col.segments].reverse().map((seg) => (
                    <div key={seg.key} className="flex items-center justify-between gap-2 py-[1px] text-[11px]">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: seg.color }} />
                        <span className="truncate text-ink-2">{seg.label}</span>
                      </span>
                      <span className="shrink-0 font-mono tabular text-ink">
                        {mode === "share"
                          ? `${seg.value.toFixed(1)}%`
                          : `${fmt(seg.value)}${col.rawTotal > 0 ? ` · ${((seg.value / col.rawTotal) * 100).toFixed(0)}%` : ""}`}
                      </span>
                    </div>
                  ))}
                  <div className="mt-1 flex items-center justify-between gap-2 border-t border-line/60 pt-1 text-[11px]">
                    <span className="text-ink-3">Total</span>
                    <span className="font-mono font-bold tabular text-ink">
                      {mode === "share" ? fmt(col.rawTotal) : fmt(col.total)}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>

            {/* x labels */}
            <div className="mt-1.5 flex justify-between font-mono text-[9.5px] text-ink-4">
              <span>{dates[0] ? fmtDay(dates[0]) : ""}</span>
              <span>{dates[dates.length - 1] ? fmtDay(dates[dates.length - 1]) : ""}</span>
            </div>
          </>
        )}

        {foot ? <div className="mt-2 font-mono text-[10.5px] text-ink-4">{foot}</div> : null}
      </div>
    </Section>
  );
}
