"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CategoryTrend } from "@/lib/category/rollup";
import { Section } from "./Section";
import { formatCompactUsd } from "@/lib/format";

/**
 * Multi-series trend chart with two modes:
 *  • "stacked"  — one band per series, composition + direction at once (the
 *    category/platform hero; stack height = total).
 *  • "rebased"  — each series indexed to 100 at the window start, drawn as lines,
 *    for relative-growth comparison (Pokémon vs One Piece vs BTC vs S&P).
 *
 * Lines are individually toggleable via the legend (≥1 always on). Datasets flagged
 * `benchmark` (external references — BTC/ETH/S&P/NASDAQ) draw dashed and default off
 * so the internal story leads and the benchmark overlay is opt-in (QA-6). `basis`
 * labels whether the rebased series is a constant-quality PRICE index (apples to
 * benchmarks) or a market-SIZE (mcap) index (kept honest, no benchmark claim).
 */
export type TrendView = { key: string; label: string; data: CategoryTrend };
export type ChartMode = "stacked" | "rebased";
export type Range = { key: string; days: number };

const H = 300;
const PAD = { top: 14, right: 16, bottom: 26, left: 48 };
const DAY_MS = 86_400_000;
const DEFAULT_RANGES: Range[] = [
  { key: "7D", days: 7 },
  { key: "30D", days: 30 },
  { key: "90D", days: 90 },
  { key: "ALL", days: Infinity },
];

function hasHistory(v: TrendView): boolean {
  return v.data.labels.length >= 2 && v.data.datasets.some((d) => d.points.some((p) => p > 0));
}

/**
 * Monotone cubic (Fritsch–Carlson) path through the points — a smooth curve that
 * never overshoots between samples, so a weekly financial series doesn't grow a
 * false peak/dip between two real points (R2-F1). Straight fallback for <3 points.
 */
function monotonePath(pts: Array<[number, number]>): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  if (n === 2) return `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} L${pts[1][0].toFixed(1)} ${pts[1][1].toFixed(1)}`;

  const dx: number[] = [];
  const m: number[] = []; // secant slopes
  for (let i = 0; i < n - 1; i++) {
    const hx = pts[i + 1][0] - pts[i][0];
    dx.push(hx);
    m.push(hx !== 0 ? (pts[i + 1][1] - pts[i][1]) / hx : 0);
  }
  const t = new Array<number>(n); // tangents
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      t[i] = 0; // local extremum → flat tangent (prevents overshoot)
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]); // weighted harmonic mean
    }
  }
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const hx = dx[i];
    const c1x = pts[i][0] + hx / 3;
    const c1y = pts[i][1] + (t[i] * hx) / 3;
    const c2x = pts[i + 1][0] - hx / 3;
    const c2y = pts[i + 1][1] - (t[i + 1] * hx) / 3;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${pts[i + 1][0].toFixed(1)} ${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}

export function CategoryTrendChart({
  views,
  defaultKey,
  entityLabel = "category",
  title,
  defaultMode = "stacked",
  allowRebase = true,
  basis = "size",
  ranges = DEFAULT_RANGES,
  defaultRange = "30D",
}: {
  views: TrendView[];
  defaultKey?: string;
  /** Noun for the title: "{metric} by {entityLabel}". */
  entityLabel?: string;
  /** Full title override (e.g. "One Piece vs market"); "(rebased)" still appends. */
  title?: string;
  /** Initial mode. "rebased" = index lines (each series → 100 at window start). */
  defaultMode?: ChartMode;
  /** Show the stacked⇄rebased toggle. */
  allowRebase?: boolean;
  /** "price" = constant-quality price index (benchmark-comparable, drops the
   *  "market size" caveat); "size" = mcap market-size index (the honest default). */
  basis?: "price" | "size";
  /** Range options; a range with days ≤ 0 (or Infinity) means "all". */
  ranges?: Range[];
  defaultRange?: string;
}) {
  const initialKey = useMemo(() => {
    const pref = views.find((v) => v.key === defaultKey);
    if (pref && hasHistory(pref)) return pref.key;
    return (views.find(hasHistory) ?? views[0])?.key ?? defaultKey;
  }, [views, defaultKey]);

  const [viewKey, setViewKey] = useState<string | undefined>(initialKey);
  const [rangeKey, setRangeKey] = useState<string>(defaultRange);
  const [mode, setMode] = useState<ChartMode>(defaultMode);
  const [hover, setHover] = useState<number | null>(null);
  // Per-line visibility — ALL lines (incl. benchmarks) on by default (R2-F2) so
  // the comparison shows without a click; each stays individually toggleable.
  // Group names are stable across a chart's metric views, so one init covers all.
  const [active, setActive] = useState<Set<string>>(
    () => new Set(((views.find((v) => v.key === initialKey) ?? views[0])?.data.datasets ?? []).map((d) => d.group)),
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(820);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => {
      for (const e of es) setW(Math.max(320, Math.round(e.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const view = views.find((v) => v.key === viewKey) ?? views[0];
  const rangeDays = ranges.find((r) => r.key === rangeKey)?.days ?? 30;
  const days = rangeDays > 0 ? rangeDays : Infinity; // days ≤ 0 ⇒ "all"
  const plotW = w - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  function toggleSeries(group: string) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        if (next.size > 1) next.delete(group); // keep at least one line on
      } else next.add(group);
      return next;
    });
  }

  const model = useMemo(() => {
    if (!view) return null;
    // Window by real date span (works for daily AND weekly series), not by label
    // count — a 30D range on a weekly index keeps the last ~30 days, not 30 weeks.
    const allLabels = view.data.labels;
    const n0 = allLabels.length;
    let start = 0;
    if (days !== Infinity && n0 > 0) {
      const cutoff = Date.parse(allLabels[n0 - 1]) - days * DAY_MS;
      const idx = allLabels.findIndex((l) => Date.parse(l) >= cutoff);
      start = idx < 0 ? 0 : idx;
    }
    const labels = allLabels.slice(start);
    const sliced = view.data.datasets
      .filter((d) => active.has(d.group))
      .map((d) => ({ group: d.group, color: d.color, benchmark: !!d.benchmark, points: d.points.slice(start) }));
    const n = labels.length;
    if (n < 2 || sliced.length === 0) return { empty: true as const };
    const x = (i: number) => PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * plotW);

    if (mode === "rebased") {
      const rebased = sliced.map((d) => {
        const base = d.points.find((p) => Number.isFinite(p) && p > 0);
        return {
          group: d.group,
          color: d.color,
          benchmark: d.benchmark,
          points: d.points.map((p) => (base && Number.isFinite(p) ? (p / base) * 100 : NaN)),
        };
      });
      // Robust range: percentile bounds (not raw min/max) so a glitchy early
      // base — which can rebase one tiny day into a huge index — doesn't blow up
      // the axis. Rendered points clamp to the range, so a spike rides the edge
      // cleanly while the tooltip/legend still report the true value.
      const sorted = rebased
        .flatMap((d) => d.points)
        .filter((v) => Number.isFinite(v))
        .sort((a, b) => a - b);
      const q = (p: number) =>
        sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))] : 100;
      const lo0 = Math.min(100, q(0.05));
      const hi0 = Math.max(100, q(0.95));
      const padv = (hi0 - lo0) * 0.12 || 5;
      const lo = lo0 - padv;
      const hi = hi0 + padv;
      const y = (v: number) => PAD.top + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / ((hi - lo) || 1)) * plotH;
      const lines = rebased.map((d) => {
        // Collect the finite points, then draw a monotone-cubic curve through them
        // (bridges the rare internal gap, same as before, but smooth — R2-F1).
        const pts: Array<[number, number]> = [];
        for (let i = 0; i < n; i++) {
          const v = d.points[i];
          if (Number.isFinite(v)) pts.push([x(i), y(v)]);
        }
        return { group: d.group, color: d.color, benchmark: d.benchmark, points: d.points, path: monotonePath(pts) };
      });
      return { empty: false as const, mode: "rebased" as const, labels, n, x, y, lo, hi, lines, datasets: rebased };
    }

    const cum: number[][] = [];
    const running = new Array(n).fill(0);
    for (const d of sliced) {
      for (let i = 0; i < n; i++) running[i] += d.points[i] || 0;
      cum.push([...running]);
    }
    const maxY = Math.max(1, ...running);
    const y = (v: number) => PAD.top + (1 - v / maxY) * plotH;
    const layers = sliced.map((d, k) => {
      const upper = cum[k];
      const lower = k > 0 ? cum[k - 1] : null;
      let path = `M${x(0).toFixed(1)} ${y(upper[0]).toFixed(1)}`;
      for (let i = 1; i < n; i++) path += ` L${x(i).toFixed(1)} ${y(upper[i]).toFixed(1)}`;
      if (lower) for (let i = n - 1; i >= 0; i--) path += ` L${x(i).toFixed(1)} ${y(lower[i]).toFixed(1)}`;
      else path += ` L${x(n - 1).toFixed(1)} ${y(0).toFixed(1)} L${x(0).toFixed(1)} ${y(0).toFixed(1)}`;
      path += " Z";
      let line = `M${x(0).toFixed(1)} ${y(upper[0]).toFixed(1)}`;
      for (let i = 1; i < n; i++) line += ` L${x(i).toFixed(1)} ${y(upper[i]).toFixed(1)}`;
      return { group: d.group, color: d.color, points: d.points, path, line };
    });
    return { empty: false as const, mode: "stacked" as const, labels, n, x, y, maxY, cum, layers, datasets: sliced };
  }, [view, days, mode, plotW, plotH, active]);

  const rebaseable = allowRebase && (view?.data.datasets.length ?? 0) >= 1;
  const isRebased = !!model && !model.empty && model.mode === "rebased";
  const titleText = title
    ? `${title}${isRebased ? " (rebased)" : ""}`
    : view
      ? `${view.label}${isRebased ? " (rebased)" : ""} by ${entityLabel}`
      : `By ${entityLabel}`;
  const hasBench = (view?.data.datasets ?? []).some((d) => d.benchmark);
  // Latest value per ACTIVE line (from the model) for the legend readout.
  const lastByGroup = new Map<string, number | undefined>(
    (model && !model.empty ? model.datasets : []).map((d) => [
      d.group,
      [...d.points].reverse().find((p) => Number.isFinite(p)),
    ]),
  );

  return (
    <Section
      title={titleText}
      className="font-sans"
      right={
        <>
          {views.length > 1 && (
            <Toggle options={views.map((v) => ({ key: v.key, label: v.label }))} value={view?.key} onChange={setViewKey} />
          )}
          {rebaseable && (
            <Toggle
              options={[
                { key: "stacked", label: "Stacked" },
                { key: "rebased", label: "Rebased" },
              ]}
              value={mode}
              onChange={(k) => setMode(k as ChartMode)}
            />
          )}
          <Toggle options={ranges.map((r) => ({ key: r.key, label: r.key }))} value={rangeKey} onChange={setRangeKey} />
        </>
      }
    >
      <div className="mb-2.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-ink-4">
        {isRebased ? (
          <>
            <span>
              indexed to 100 at window start · {basis === "price" ? "constant-quality price index" : "market size, not price"}
            </span>
            {basis !== "price" && !hasBench && (
              <>
                <span aria-hidden className="text-ink-4">·</span>
                <span
                  className="cursor-default rounded border border-line px-1.5 py-px text-ink-4"
                  title="Benchmark overlay (vs BTC · ETH · S&P 500 · NASDAQ) arrives with the price index"
                >
                  benchmarks soon
                </span>
              </>
            )}
          </>
        ) : (
          <span>daily</span>
        )}
      </div>

      {view && view.data.datasets.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {view.data.datasets.map((d) => {
            const on = active.has(d.group);
            const last = lastByGroup.get(d.group);
            return (
              <button
                key={d.group}
                type="button"
                onClick={() => toggleSeries(d.group)}
                aria-pressed={on}
                className={`flex items-center gap-1.5 text-[12px] transition-opacity ${on ? "" : "opacity-40 hover:opacity-70"}`}
                title={d.benchmark ? "External benchmark" : undefined}
              >
                {d.benchmark ? (
                  <span className="inline-block h-0 w-3.5 border-t-[2px] border-dashed" style={{ borderColor: d.color }} />
                ) : (
                  <span className="h-2 w-2 rounded-[2px]" style={{ background: d.color }} />
                )}
                <span className={on ? "text-ink-3" : "text-ink-4"}>{d.group}</span>
                {on && last != null && (
                  <span className="font-mono tabular text-ink">
                    {isRebased ? last.toFixed(1) : formatCompactUsd(last)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

        <div
          ref={wrapRef}
          className="relative"
          style={{ height: H }}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            if (!model || model.empty) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const frac = Math.max(0, Math.min(1, (e.clientX - rect.left - PAD.left) / plotW));
            setHover(Math.round(frac * (model.n - 1)));
          }}
        >
          {!model || model.empty ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
              <div className="font-mono text-[13px] text-ink-3">No history yet for {view?.label.toLowerCase()}</div>
              <div className="max-w-[360px] text-[12px] text-ink-4">
                Recorded daily — it plots here as the spine fills. {views.length > 1 && "Switch metric for live history."}
              </div>
            </div>
          ) : model.mode === "rebased" ? (
            <svg width={w} height={H} className="block">
              {rebasedYTicks(model.lo, model.hi).map((v, i) => {
                const yy = model.y(v);
                const is100 = Math.abs(v - 100) < 1e-6;
                return (
                  <g key={i}>
                    <line
                      x1={PAD.left}
                      x2={w - PAD.right}
                      y1={yy}
                      y2={yy}
                      stroke={is100 ? "var(--color-line-2)" : "var(--color-line)"}
                      strokeDasharray={is100 ? "4 3" : "2 5"}
                    />
                    <text x={PAD.left - 8} y={yy + 3} textAnchor="end" fontSize={10.5} fill="var(--color-ink-4)" fontFamily="var(--font-jetbrains-mono), monospace">
                      {Math.round(v)}
                    </text>
                  </g>
                );
              })}

              {model.lines.map((L) => (
                <path
                  key={L.group}
                  d={L.path}
                  fill="none"
                  stroke={L.color}
                  strokeWidth={L.benchmark ? 1.5 : 2}
                  strokeDasharray={L.benchmark ? "5 4" : undefined}
                  strokeOpacity={L.benchmark ? 0.92 : 1}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}

              {hover != null && (
                <>
                  <line x1={model.x(hover)} x2={model.x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--color-line-2)" />
                  {model.datasets.map((d) =>
                    Number.isFinite(d.points[hover]) ? (
                      <circle key={d.group} cx={model.x(hover)} cy={model.y(d.points[hover])} r={3} fill={d.color} stroke="var(--color-bg-1)" strokeWidth={1.5} />
                    ) : null,
                  )}
                </>
              )}

              {xTicks(model.labels).map((t) => (
                <text
                  key={t.i}
                  x={model.x(t.i)}
                  y={H - 8}
                  fontSize={10.5}
                  fill="var(--color-ink-4)"
                  textAnchor={t.i === 0 ? "start" : t.i === model.n - 1 ? "end" : "middle"}
                  fontFamily="var(--font-jetbrains-mono), monospace"
                >
                  {t.lab}
                </text>
              ))}
            </svg>
          ) : (
            <svg width={w} height={H} className="block">
              {[0, 0.5, 1].map((p) => {
                const yy = PAD.top + plotH * (1 - p);
                return (
                  <g key={p}>
                    <line x1={PAD.left} x2={w - PAD.right} y1={yy} y2={yy} stroke="var(--color-line)" strokeDasharray={p === 0 ? undefined : "2 5"} />
                    {p > 0 && (
                      <text x={PAD.left - 8} y={yy + 3} textAnchor="end" fontSize={10.5} fill="var(--color-ink-4)" fontFamily="var(--font-jetbrains-mono), monospace">
                        {formatCompactUsd(model.maxY * p)}
                      </text>
                    )}
                  </g>
                );
              })}

              {model.layers.map((L) => (
                <g key={L.group}>
                  <path d={L.path} fill={L.color} fillOpacity={0.68} />
                  <path d={L.line} fill="none" stroke={L.color} strokeWidth={1.5} strokeLinejoin="round" />
                </g>
              ))}

              {hover != null && model.cum[0]?.[hover] != null && (
                <>
                  <line x1={model.x(hover)} x2={model.x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--color-line-2)" />
                  {model.layers.map((L, k) => (
                    <circle key={L.group} cx={model.x(hover)} cy={model.y(model.cum[k][hover])} r={3} fill={L.color} stroke="var(--color-bg-1)" strokeWidth={1.5} />
                  ))}
                </>
              )}

              {xTicks(model.labels).map((t) => (
                <text
                  key={t.i}
                  x={model.x(t.i)}
                  y={H - 8}
                  fontSize={10.5}
                  fill="var(--color-ink-4)"
                  textAnchor={t.i === 0 ? "start" : t.i === model.n - 1 ? "end" : "middle"}
                  fontFamily="var(--font-jetbrains-mono), monospace"
                >
                  {t.lab}
                </text>
              ))}
            </svg>
          )}

          {hover != null && model && !model.empty && (
            <div
              className="pointer-events-none absolute z-10 min-w-[150px] rounded-lg border border-line-2 bg-bg-2/95 p-2.5 text-[12px] shadow-[0_8px_28px_rgba(0,0,0,0.5)] backdrop-blur"
              style={{ left: Math.min(w - 168, Math.max(8, model.x(hover) + 12)), top: 10 }}
            >
              <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">{fmtDay(model.labels[hover])}</div>
              {model.datasets.map((d) => (
                <div key={d.group} className="flex items-center justify-between gap-4 py-0.5">
                  <span className="flex items-center gap-1.5 text-ink-2">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: d.color }} />
                    {d.group}
                  </span>
                  <span className="font-mono font-semibold tabular text-ink">
                    {model.mode === "rebased"
                      ? Number.isFinite(d.points[hover])
                        ? d.points[hover].toFixed(1)
                        : "—"
                      : formatCompactUsd(d.points[hover])}
                  </span>
                </div>
              ))}
              {model.mode === "stacked" && (
                <div className="mt-1 flex items-center justify-between gap-4 border-t border-line pt-1">
                  <span className="text-ink-3">Total</span>
                  <span className="font-mono font-semibold tabular text-ink">{formatCompactUsd(model.cum[model.cum.length - 1][hover])}</span>
                </div>
              )}
            </div>
          )}
        </div>
    </Section>
  );
}

function Toggle({ options, value, onChange }: { options: { key: string; label: string }[]; value?: string; onChange: (k: string) => void }) {
  return (
    <div className="flex gap-0.5 rounded-[9px] border border-line bg-bg-1 p-[3px]">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={`rounded-md px-2.5 py-1 font-mono text-[11.5px] transition-colors ${
            value === o.key ? "bg-bg-3 text-yellow" : "text-ink-3 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDay(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function xTicks(labels: string[]): { i: number; lab: string }[] {
  const n = labels.length;
  if (n === 0) return [];
  const count = Math.min(5, n);
  const out: { i: number; lab: string }[] = [];
  for (let k = 0; k < count; k++) {
    const i = Math.round((k / (count - 1)) * (n - 1));
    out.push({ i, lab: fmtDay(labels[i]) });
  }
  return out;
}

/** Index-axis ticks across [lo, hi], always including the 100 baseline. */
function rebasedYTicks(lo: number, hi: number): number[] {
  const set = new Set<number>([100]);
  const n = 4;
  for (let k = 0; k <= n; k++) set.add(lo + (k / n) * (hi - lo));
  return [...set].filter((v) => v >= lo - 1e-6 && v <= hi + 1e-6).sort((a, b) => a - b);
}
