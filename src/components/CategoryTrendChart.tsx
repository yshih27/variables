"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CategoryTrend } from "@/lib/category/rollup";
import { formatCompactUsd } from "@/lib/format";

/**
 * Market-cap / 24h-volume trend GROUPED BY CATEGORY — the category page's hero
 * and the thing the homepage no longer shows. A stacked area (one band per
 * category) so composition and direction read at once. Real, daily, from the
 * spine; a metric with no history yet shows an honest empty state.
 *
 * Distinct from IPActivityChart, which normalizes each metric independently
 * (overlay) — wrong for part-to-whole. Here the stack height IS the total.
 */

export type TrendView = { key: string; label: string; data: CategoryTrend };

const H = 300;
const PAD = { top: 14, right: 16, bottom: 26, left: 48 };
const RANGES = [
  { key: "7D", days: 7 },
  { key: "30D", days: 30 },
  { key: "90D", days: 90 },
  { key: "ALL", days: Infinity },
] as const;

function hasHistory(v: TrendView): boolean {
  return v.data.labels.length >= 2 && v.data.datasets.some((d) => d.points.some((p) => p > 0));
}

export function CategoryTrendChart({ views, defaultKey }: { views: TrendView[]; defaultKey?: string }) {
  const initialKey = useMemo(() => {
    const pref = views.find((v) => v.key === defaultKey);
    if (pref && hasHistory(pref)) return pref.key;
    return (views.find(hasHistory) ?? views[0])?.key ?? defaultKey;
  }, [views, defaultKey]);

  const [viewKey, setViewKey] = useState<string | undefined>(initialKey);
  const [rangeKey, setRangeKey] = useState<string>("30D");
  const [hover, setHover] = useState<number | null>(null);
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
  const days = RANGES.find((r) => r.key === rangeKey)?.days ?? 30;
  const plotW = w - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const model = useMemo(() => {
    if (!view) return null;
    const n0 = view.data.labels.length;
    const start = days === Infinity ? 0 : Math.max(0, n0 - days);
    const labels = view.data.labels.slice(start);
    const datasets = view.data.datasets.map((d) => ({ ...d, points: d.points.slice(start) }));
    const n = labels.length;
    if (n < 2) return { empty: true as const };

    const cum: number[][] = [];
    const running = new Array(n).fill(0);
    for (const d of datasets) {
      for (let i = 0; i < n; i++) running[i] += d.points[i] || 0;
      cum.push([...running]);
    }
    const maxY = Math.max(1, ...running);
    const x = (i: number) => PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
    const y = (v: number) => PAD.top + (1 - v / maxY) * plotH;

    const layers = datasets.map((d, k) => {
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

    return { empty: false as const, labels, datasets, n, cum, maxY, x, y, layers };
  }, [view, days, plotW, plotH]);

  return (
    <section className="mb-7">
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[14px] font-semibold">{view ? `${view.label} by category` : "By category"}</h2>
          <div className="flex flex-wrap items-center gap-2.5">
            {views.length > 1 && (
              <Toggle options={views.map((v) => ({ key: v.key, label: v.label }))} value={view?.key} onChange={setViewKey} />
            )}
            <Toggle options={RANGES.map((r) => ({ key: r.key, label: r.key }))} value={rangeKey} onChange={setRangeKey} />
          </div>
        </div>

        {view && (
          <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1.5">
            {view.data.datasets.map((d) => (
              <span key={d.group} className="flex items-center gap-1.5 text-[12px] text-ink-3">
                <span className="h-2 w-2 rounded-[2px]" style={{ background: d.color }} />
                {d.group}
                <span className="font-mono tabular text-ink">{formatCompactUsd(d.points[d.points.length - 1] ?? 0)}</span>
              </span>
            ))}
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
          ) : (
            <svg width={w} height={H} className="block">
              {[0, 0.5, 1].map((p) => {
                const yy = PAD.top + plotH * (1 - p);
                return (
                  <g key={p}>
                    <line
                      x1={PAD.left}
                      x2={w - PAD.right}
                      y1={yy}
                      y2={yy}
                      stroke="var(--color-line)"
                      strokeDasharray={p === 0 ? undefined : "2 5"}
                    />
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

          {hover != null && model && !model.empty && model.datasets[0]?.points[hover] != null && (
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
                  <span className="font-mono font-semibold tabular text-ink">{formatCompactUsd(d.points[hover])}</span>
                </div>
              ))}
              <div className="mt-1 flex items-center justify-between gap-4 border-t border-line pt-1">
                <span className="text-ink-3">Total</span>
                <span className="font-mono font-semibold tabular text-ink">{formatCompactUsd(model.cum[model.cum.length - 1][hover])}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
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

function fmtDay(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
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
