"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatCompactUsd, formatInt } from "@/lib/format";

/**
 * Activity — multi-metric overlay chart for the IP / platform pages.
 *
 * Each metric is normalized to its OWN min/max so different units (dollars,
 * counts) share one plot (DefiLlama-style). Metric chips toggle lines on/off
 * (≥1 always on); the timeframe control switches the window. Smooth lines,
 * volume gets a gradient area fill, end-of-line value labels, a pulsing latest
 * dot, and a hover crosshair + tooltip.
 *
 * AXES: the x-axis shows REAL dates (and clock times in the 24H window), read
 * from each window's `ts` timestamps. The y-axis is labelled with the PRIMARY
 * (first active) metric's real value scale — formatted by its kind ($ vs count)
 * — so magnitude is legible, not just shape. Overlaid metrics keep their own
 * normalization for trend comparison; the axis belongs to the primary metric.
 *
 * DATA: every series is REAL, read from the `metric_snapshots` spine (24H volume
 * from hourly buckets). A window with <2 points has no history yet — its chip is
 * disabled for that window and nothing is drawn; we never fabricate a series.
 */

export type Timeframe = "24H" | "7D" | "30D" | "ALL";
export const TIMEFRAMES: Timeframe[] = ["24H", "7D", "30D", "ALL"];

export type MetricWindow = {
  points: number[];
  /** ISO timestamps aligned 1:1 with points (oldest→newest). Enables real date
   *  axis labels; omit and the axis falls back to relative ("3d ago"). */
  ts?: string[];
};
export type ActivityMetric = {
  key: string;
  label: string;
  color: string; // CSS color
  value: string; // real current headline value (shown on the chip)
  /** Real points per timeframe (oldest → newest). <2 points ⇒ no history. */
  series: Record<Timeframe, MetricWindow>;
};

const H = 320;
const PAD = { top: 16, right: 20, bottom: 30, left: 52 };

/** A metric has a drawable series for this window only with ≥2 real points AND at
 *  least one positive value. An all-$0 window (e.g. a platform whose hourly volume
 *  series is empty/miswired) is "no data", not a real flat-zero line to plot. */
function hasWindow(m: ActivityMetric, tf: Timeframe): boolean {
  const pts = m.series[tf]?.points;
  return !!pts && pts.length >= 2 && pts.some((p) => Number.isFinite(p) && p > 0);
}

const USD_KEYS = new Set(["volume", "marketCap", "avgTrade"]);
const fmtByKey = (key: string, v: number) => (USD_KEYS.has(key) ? formatCompactUsd(v) : formatInt(v));

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Axis tick: real date, or clock time in the intraday window. */
function fmtAxisDate(ts: string, tf: Timeframe): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  if (tf === "24H") {
    let h = d.getHours();
    const ap = h < 12 ? "am" : "pm";
    h = h % 12 || 12;
    return `${h}${ap}`;
  }
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Hover label: full date, plus clock time in the intraday window. */
function fmtHoverDate(ts: string, tf: Timeframe): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  if (tf === "24H") {
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    const ap = h < 12 ? "AM" : "PM";
    h = h % 12 || 12;
    return `${MON[d.getMonth()]} ${d.getDate()} · ${h}:${m} ${ap}`;
  }
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** y-axis ticks spanning the primary metric's [min,max], real values. */
function buildYTicks(min: number, max: number, key: string, segments = 3): { f: number; label: string }[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [{ f: 1, label: fmtByKey(key, max) }, { f: 0, label: fmtByKey(key, min) }];
  const out: { f: number; label: string }[] = [];
  for (let k = 0; k <= segments; k++) {
    const f = k / segments;
    out.push({ f, label: fmtByKey(key, min + f * (max - min)) });
  }
  return out;
}

/** Catmull-Rom → cubic Bézier for a smooth line through all points. */
function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length === 0) return "";
  if (pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

export function IPActivityChart({
  metrics,
  timeframes = TIMEFRAMES,
  defaultTimeframe,
  title = "Activity",
}: {
  metrics: ActivityMetric[];
  /** Which windows to offer (e.g. market data is daily → omit 24H). */
  timeframes?: Timeframe[];
  defaultTimeframe?: Timeframe;
  title?: string;
}) {
  const [tf, setTf] = useState<Timeframe>(defaultTimeframe ?? timeframes[0] ?? "24H");
  const [active, setActive] = useState<Set<string>>(() => {
    const tf0 = defaultTimeframe ?? timeframes[0] ?? "24H";
    let best = metrics[0]?.key;
    let bestN = -1;
    for (const m of metrics) {
      const n = m.series[tf0]?.points.length ?? 0;
      if (n > bestN) { bestN = n; best = m.key; }
    }
    return new Set(best ? [best] : []);
  });
  const [hover, setHover] = useState<number | null>(null);
  const [reduce, setReduce] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(820);

  useEffect(() => {
    setReduce(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(Math.max(320, Math.round(e.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const avail = metrics.filter((m) => hasWindow(m, tf)).map((m) => m.key);
    if (avail.length === 0) return;
    setActive((prev) => (avail.some((k) => prev.has(k)) ? prev : new Set([avail[0]])));
  }, [tf, metrics]);

  function toggle(key: string) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else next.add(key);
      return next;
    });
  }

  const plotW = w - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const lines = useMemo(() => {
    return metrics
      .filter((m) => active.has(m.key) && hasWindow(m, tf))
      .map((m) => {
        const win = m.series[tf];
        const s = win.points;
        const n = s.length;
        const min = Math.min(...s);
        const max = Math.max(...s);
        const span = max - min || 1;
        const pts: Array<[number, number]> = s.map((v, i) => {
          const x = PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
          const y = PAD.top + (1 - (v - min) / span) * plotH;
          return [x, y];
        });
        return { ...m, pts, n, min, max, ts: win.ts };
      });
  }, [metrics, active, tf, plotW, plotH]);

  const primary = lines[0];
  const hoverN = primary?.n ?? 0;
  const yTicks = primary ? buildYTicks(primary.min, primary.max, primary.key) : [];
  const xTickCount = primary ? Math.min(5, primary.n) : 0;

  return (
    <section className="mb-12 font-sans">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[22px] font-bold tracking-[-0.02em]">{title}</h2>
          <div className="mt-1 font-mono text-[12px] text-ink-3">
            {tf === "24H" ? "24h history · hourly" : `${tf} history · daily`} · overlay any metric
          </div>
        </div>
        <div className="flex gap-0.5 rounded-[10px] border border-line bg-bg-1 p-[3px]">
          {timeframes.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTf(t)}
              className={`rounded-md px-3 py-1.5 font-mono text-[12px] transition-colors ${
                t === tf ? "bg-bg-3 text-yellow" : "text-ink-3 hover:text-ink"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Metric chips */}
      <div className="mb-4 flex flex-wrap gap-2">
        {metrics.map((m) => {
          const on = active.has(m.key);
          const avail = hasWindow(m, tf);
          return (
            <button
              key={m.key}
              type="button"
              disabled={!avail}
              onClick={() => avail && toggle(m.key)}
              className={`flex items-center gap-2 rounded-[10px] border px-3 py-1.5 transition-colors ${
                !avail
                  ? "cursor-not-allowed border-line bg-transparent opacity-40"
                  : on
                    ? "border-line-2 bg-bg-2"
                    : "border-line bg-transparent opacity-55 hover:opacity-100"
              }`}
              aria-pressed={on}
              title={avail ? undefined : `No ${tf} history yet`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: m.color, boxShadow: on && avail ? `0 0 8px ${m.color}` : "none" }}
              />
              <span className="text-[12.5px] font-medium text-ink">{m.label}</span>
              <span className="font-mono text-[12.5px] font-semibold tabular text-ink-2">{m.value}</span>
              {!avail && (
                <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-4">no {tf}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <div
        ref={wrapRef}
        className="relative rounded-2xl border border-line bg-bg-1 p-4"
        style={{ height: H + 32 }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          if (hoverN < 2) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left - 16;
          const frac = Math.max(0, Math.min(1, (x - PAD.left) / plotW));
          setHover(Math.round(frac * (hoverN - 1)));
        }}
      >
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <div className="font-mono text-[13px] text-ink-3">
              {tf === "24H" ? "No intraday data" : `No ${tf} history yet`}
            </div>
            <div className="text-[12px] text-ink-4">
              {tf === "24H"
                ? "Hourly volume isn't available for this window — try 7D or 30D."
                : "This metric is recorded daily — pick a longer window or check back as the spine fills."}
            </div>
          </div>
        ) : (
          <svg width={w} height={H} className="block">
            <defs>
              <linearGradient id="act-vol-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={metrics[0]?.color ?? "#E8FF59"} stopOpacity="0.28" />
                <stop offset="100%" stopColor={metrics[0]?.color ?? "#E8FF59"} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* y-axis: labelled gridlines from the primary metric's real scale */}
            {yTicks.map((t, i) => {
              const y = PAD.top + plotH * (1 - t.f);
              return (
                <g key={i}>
                  <line
                    x1={PAD.left}
                    x2={w - PAD.right}
                    y1={y}
                    y2={y}
                    stroke="var(--color-line)"
                    strokeDasharray={t.f === 0 ? undefined : "2 5"}
                  />
                  <text
                    x={PAD.left - 8}
                    y={y + 3.5}
                    textAnchor="end"
                    fontSize={11}
                    fill="var(--color-ink-4)"
                    fontFamily="var(--font-jetbrains-mono), monospace"
                  >
                    {t.label}
                  </text>
                </g>
              );
            })}

            {lines.map((m) => {
              const path = smoothPath(m.pts);
              const isVol = m.key === "volume";
              const last = m.pts[m.pts.length - 1];
              return (
                <g key={m.key}>
                  {isVol && (
                    <path
                      d={`${path} L${last[0]} ${PAD.top + plotH} L${m.pts[0][0]} ${PAD.top + plotH} Z`}
                      fill="url(#act-vol-fill)"
                    />
                  )}
                  <path
                    d={path}
                    pathLength={1}
                    fill="none"
                    stroke={m.color}
                    strokeWidth={1.8}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    className={reduce ? "" : "act-draw"}
                  />
                  <circle cx={last[0]} cy={last[1]} r={3.2} fill={m.color} className={reduce ? "" : "act-pulse"} />
                  {hover != null && m.pts[hover] && (
                    <circle cx={m.pts[hover][0]} cy={m.pts[hover][1]} r={3.6} fill={m.color} stroke="var(--color-bg)" strokeWidth={1.5} />
                  )}
                </g>
              );
            })}

            {/* crosshair */}
            {hover != null && primary?.pts[hover] && (
              <line
                x1={primary.pts[hover][0]}
                x2={primary.pts[hover][0]}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="var(--color-line-2)"
              />
            )}

            {/* x-axis: real dates (clock times in the 24H window) */}
            {Array.from({ length: xTickCount }, (_, k) => {
              if (!primary) return null;
              const n = primary.n;
              const i = xTickCount <= 1 ? 0 : Math.round((k / (xTickCount - 1)) * (n - 1));
              const x = PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
              const lab = primary.ts?.[i] ? fmtAxisDate(primary.ts[i], tf) : "";
              if (!lab) return null;
              return (
                <text
                  key={k}
                  x={x}
                  y={H - 8}
                  fontSize={11}
                  fill="var(--color-ink-4)"
                  textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
                  fontFamily="var(--font-jetbrains-mono), monospace"
                >
                  {lab}
                </text>
              );
            })}
          </svg>
        )}

        {/* tooltip */}
        {hover != null && lines.length > 0 && primary?.pts[hover] && (
          <div
            className="pointer-events-none absolute z-10 min-w-[150px] rounded-lg border border-line-2 bg-bg-2/95 p-2.5 font-sans text-[12px] shadow-[0_8px_28px_rgba(0,0,0,0.5)] backdrop-blur"
            style={{ left: Math.min(w - 170, Math.max(8, primary.pts[hover][0] + 14)), top: 18 }}
          >
            <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
              {primary.ts?.[hover] ? fmtHoverDate(primary.ts[hover], tf) : hoverLabel(tf, hover, hoverN)}
            </div>
            {lines.map((m) => (
              <div key={m.key} className="flex items-center justify-between gap-4 py-0.5">
                <span className="flex items-center gap-1.5 text-ink-2">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
                  {m.label}
                </span>
                <span className="font-mono font-semibold tabular text-ink">{pointValue(m, tf, hover)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Fallback hover label when a series carries no timestamps. */
function hoverLabel(tf: Timeframe, idx: number, n: number): string {
  const ago = n - 1 - idx;
  if (tf === "24H") return ago === 0 ? "now" : `${ago}h ago`;
  if (tf === "7D" || tf === "30D") {
    const days = n <= 1 ? 0 : Math.round((ago / (n - 1)) * (tf === "7D" ? 7 : 30));
    return days === 0 ? "now" : `${days}d ago`;
  }
  return ago === 0 ? "now" : `${ago} pts ago`;
}

/** Real per-point value, formatted by metric kind (USD vs count). */
function pointValue(m: ActivityMetric, tf: Timeframe, idx: number): string {
  const raw = m.series[tf]?.points?.[idx];
  if (raw == null || !Number.isFinite(raw)) return "—";
  return fmtByKey(m.key, raw);
}
