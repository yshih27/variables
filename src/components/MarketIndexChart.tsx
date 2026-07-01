"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Compact market-index line chart for the MarketHeader's middle band (QA-5) —
 * replaces the decorative sparkline with a real, readable trend that fills the
 * empty desktop gap between the mcap number and the Change/Benchmark columns.
 *
 * Points are the market index already rebased to 100 at inception, so a dashed
 * baseline at 100 marks "flat vs inception" and the line's color reads its sign
 * (green above, red below). Desktop-only — the MarketHeader hides it on mobile.
 */
type Point = { ts: string; value: number };

const H = 92;
const PAD = { top: 12, right: 8, bottom: 10, left: 8 };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDay(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function MarketIndexChart({ points }: { points: Point[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(360);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => {
      for (const e of es) setW(Math.max(160, Math.round(e.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const model = useMemo(() => {
    const clean = points.filter((p) => Number.isFinite(p.value));
    const n = clean.length;
    if (n < 2) return null;
    const vals = clean.map((p) => p.value);
    // Always frame the 100 baseline so "above / below inception" is legible.
    const lo = Math.min(100, ...vals);
    const hi = Math.max(100, ...vals);
    const span = hi - lo || 1;
    const plotW = w - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
    const y = (v: number) => PAD.top + (1 - (v - lo) / span) * plotH;
    const line = clean.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
    const area = `${line} L${x(n - 1).toFixed(1)} ${(PAD.top + plotH).toFixed(1)} L${x(0).toFixed(1)} ${(PAD.top + plotH).toFixed(1)} Z`;
    const last = vals[n - 1];
    const up = last >= 100;
    return { clean, n, x, y, line, area, last, up, baseY: y(100), plotH };
  }, [points, w]);

  if (!model) return null;
  const stroke = model.up ? "var(--color-green)" : "var(--color-red)";
  const gradId = model.up ? "mkt-idx-up" : "mkt-idx-down";
  const hi = hover != null ? model.clean[hover] : null;

  return (
    <div
      ref={wrapRef}
      className="relative w-full"
      style={{ height: H }}
      onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left - PAD.left) / (w - PAD.left - PAD.right)));
        setHover(Math.round(frac * (model.n - 1)));
      }}
    >
      <svg width={w} height={H} className="block">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* rebase baseline at 100 */}
        <line
          x1={PAD.left}
          x2={w - PAD.right}
          y1={model.baseY}
          y2={model.baseY}
          stroke="var(--color-line-2)"
          strokeDasharray="3 3"
        />
        <text x={w - PAD.right} y={model.baseY - 4} textAnchor="end" fontSize={9.5} fill="var(--color-ink-4)" fontFamily="var(--font-jetbrains-mono), monospace">
          100
        </text>

        <path d={model.area} fill={`url(#${gradId})`} />
        <path d={model.line} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />

        {hover != null && model.clean[hover] && (
          <>
            <line x1={model.x(hover)} x2={model.x(hover)} y1={PAD.top} y2={PAD.top + model.plotH} stroke="var(--color-line-2)" />
            <circle cx={model.x(hover)} cy={model.y(model.clean[hover].value)} r={3} fill={stroke} stroke="var(--color-bg-1)" strokeWidth={1.5} />
          </>
        )}
        <circle cx={model.x(model.n - 1)} cy={model.y(model.last)} r={2.6} fill={stroke} />
      </svg>

      {hi && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-line-2 bg-bg-2/95 px-2 py-1 font-mono text-[10.5px] shadow-lg backdrop-blur"
          style={{ left: Math.min(w - 92, Math.max(0, model.x(hover!) - 40)) }}
        >
          <span className="text-ink-3">{fmtDay(hi.ts)} </span>
          <span className="font-semibold tabular text-ink">{hi.value.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
}
