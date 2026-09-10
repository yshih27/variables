"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChartActions } from "./ChartActions";

/**
 * Compact market-index line chart for the MarketHeader's middle band (QA-5) —
 * replaces the decorative sparkline with a real, readable trend that fills the
 * empty desktop gap between the mcap number and the Change/Benchmark columns.
 *
 * Points are the market index already rebased to 100 at inception, so a dashed
 * baseline at 100 marks "flat vs inception" and the line's color reads its sign
 * (green above, red below). Desktop-only — the MarketHeader hides it on mobile.
 */
type Point = { ts: string; value: number; lo?: number; hi?: number; n?: number; thin?: boolean };

const H = 92;
const PAD = { top: 12, right: 8, bottom: 10, left: 8 };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDay(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * `anchor` — the tracked market cap rebased to the same base month, drawn as a
 * second faint line ("cap anchor"). It is the reader's check on the index: the
 * index follows what RESELLS and runs warmer than the whole market, so the gap
 * between the two lines is the disclosed resale premium made visible.
 *
 * The band is the bootstrap over identities (lo/hi on each point), filled at 35%
 * like the stacked areas. Six or seven monthly points must still read as a chart:
 * straight segments between month-end stamps, nothing smoothed or invented.
 */
export function MarketIndexChart({
  points,
  anchor = [],
  receipt,
  actions = true,
}: {
  points: Point[];
  anchor?: Point[];
  /**
   * The disclosure receipt (`indexReceipt()`), verbatim from the page.
   *
   * ⚠️ IT IS PASSED, NOT RE-DERIVED. The header already prints this line from the
   * blob; recomputing it here would give the export a second chance to disagree
   * with the page about the resale skew, which is exactly the number an exported
   * index image must not be able to travel without.
   */
  receipt?: string | null;
  /** false inside `/embed/home-index` — an embed offers no export band. */
  actions?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
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
    // The anchor is drawn on the index's x positions: snap each index point to the
    // anchor's last reading on or before that stamp (the anchor is daily, the
    // index monthly), so the two lines share the same month-end columns.
    const anchorAt = clean.map((p) => {
      const t = Date.parse(p.ts);
      let best: number | null = null;
      for (const a of anchor) {
        const ta = Date.parse(a.ts);
        if (Number.isFinite(ta) && ta <= t && Number.isFinite(a.value)) best = a.value;
        else if (ta > t) break;
      }
      return best;
    });
    const anchorVals = anchorAt.filter((v): v is number => v != null);
    const bandLo = clean.map((p) => p.lo).filter((v): v is number => v != null && Number.isFinite(v));
    const bandHi = clean.map((p) => p.hi).filter((v): v is number => v != null && Number.isFinite(v));
    // Always frame the 100 baseline so "above / below inception" is legible; the
    // band and the anchor must fit too or they would draw off-canvas.
    const lo = Math.min(100, ...vals, ...bandLo, ...anchorVals);
    const hi = Math.max(100, ...vals, ...bandHi, ...anchorVals);
    const span = hi - lo || 1;
    const plotW = w - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
    const y = (v: number) => PAD.top + (1 - (v - lo) / span) * plotH;
    const line = clean.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
    const area = `${line} L${x(n - 1).toFixed(1)} ${(PAD.top + plotH).toFixed(1)} L${x(0).toFixed(1)} ${(PAD.top + plotH).toFixed(1)} Z`;
    const last = vals[n - 1];
    const up = last >= 100;
    // Band polygon: hi edge forward, lo edge back. Only where every point has one.
    const hasBand = clean.every((p) => p.lo != null && p.hi != null);
    const band = hasBand
      ? clean.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.hi!).toFixed(1)}`).join(" ") +
        " " +
        [...clean].reverse().map((p, k) => `L${x(n - 1 - k).toFixed(1)} ${y(p.lo!).toFixed(1)}`).join(" ") +
        " Z"
      : null;
    const anchorLine =
      anchorVals.length >= 2
        ? anchorAt.map((v, i) => (v == null ? null : `${x(i).toFixed(1)} ${y(v).toFixed(1)}`)).filter(Boolean).map((seg, i) => `${i ? "L" : "M"}${seg}`).join(" ")
        : null;
    return { clean, n, x, y, line, area, last, up, baseY: y(100), plotH, band, anchorLine, anchorAt, anchorLast: anchorVals.at(-1) ?? null };
  }, [points, anchor, w]);

  if (!model) return null;
  const stroke = model.up ? "var(--color-green)" : "var(--color-red)";
  const gradId = model.up ? "mkt-idx-up" : "mkt-idx-down";
  const hi = hover != null ? model.clean[hover] : null;

  return (
    <>
      {/* ⚠️ IN NORMAL FLOW, ABOVE THE PLOT, NEVER OVER IT. The plot's top-right
          is where a rising index ENDS — the peak dot and its hover tooltip live
          there — so an absolutely positioned band sat on the one part of the
          picture the reader looks at. The header's middle column is
          justify-center with ~30px of slack at 1440; the 27px row with -mt-1 and
          a 2px gap was MEASURED at a 0px change to the hero's height (242 → 242),
          where mb-1 alone cost 6px. */}
      {actions && model.clean.length >= 2 && (
        <div className="-mt-1 mb-0.5 flex justify-end">
          <ChartActions
            meta={{
              title: "The Varible Index",
              readMe: "resale comparables — follows what resells, so it runs warmer than the market",
              receipt: receipt ?? null,
              unit: "index (100 = base month)",
              window: `${model.clean.length} complete months`,
              asOf: model.clean.at(-1)?.ts ?? null,
              slug: "varible-index",
            }}
            series={[
              {
                key: "v-mkt",
                label: "V-MKT (index)",
                color: stroke,
                points: model.clean.map((p) => ({ ts: p.ts, value: p.value })),
              },
              // ⚠️ THE ANCHOR IS EXPORTED AS THE CHART DRAWS IT — snapped to the
              // index's month-end stamps, not as its own daily series. Pivoting a
              // daily anchor against a monthly index produced a 102-row CSV whose
              // two columns were almost never populated on the same row: the file
              // said the two lines never coexist, when in the picture they do.
              ...(anchor.length
                ? [{
                    key: "cap-anchor",
                    label: "Cap anchor (rebased)",
                    color: "var(--color-ink-4)",
                    points: model.clean
                      .map((p, i) => ({ ts: p.ts, value: model.anchorAt[i] }))
                      .filter((p): p is { ts: string; value: number } => p.value != null),
                  }]
                : []),
            ]}
            svgRef={svgRef}
            plotHeight={H}
            legend={[
              { color: stroke, text: "V-MKT" },
              ...(anchor.length ? [{ color: "#8a8a92", text: "cap anchor" }] : []),
            ]}
            chartId="home-index"
          />
        </div>
      )}
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
      <svg ref={svgRef} width={w} height={H} className="block">
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

        {/* bootstrap band — soft 35% fill, same weight as the stacked areas */}
        {model.band ? (
          <path d={model.band} fill={stroke} fillOpacity={0.35 * 0.35} stroke="none" />
        ) : (
          <path d={model.area} fill={`url(#${gradId})`} />
        )}
        {/* cap anchor — tracked market cap on the same base, the reader's check */}
        {model.anchorLine && (
          <path d={model.anchorLine} fill="none" stroke="var(--color-ink-4)" strokeWidth={1} strokeDasharray="2 3" strokeLinejoin="round" />
        )}
        <path d={model.line} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />

        {hover != null && model.clean[hover] && (
          <>
            <line x1={model.x(hover)} x2={model.x(hover)} y1={PAD.top} y2={PAD.top + model.plotH} stroke="var(--color-line-2)" />
            <circle cx={model.x(hover)} cy={model.y(model.clean[hover].value)} r={3} fill={stroke} stroke="var(--color-bg-1)" strokeWidth={1.5} />
          </>
        )}
        <circle cx={model.x(model.n - 1)} cy={model.y(model.last)} r={2.6} fill={stroke} />
        {model.anchorLine && (
          <text x={PAD.left} y={PAD.top + 8} fontSize={9} fill="var(--color-ink-4)" fontFamily="var(--font-jetbrains-mono), monospace">
            ┄ cap anchor{model.anchorLast != null ? ` ${model.anchorLast.toFixed(0)}` : ""}
          </text>
        )}
      </svg>

      {hi && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-line-2 bg-bg-2/95 px-2 py-1 font-mono text-[10.5px] shadow-lg backdrop-blur"
          style={{ left: Math.min(w - 92, Math.max(0, model.x(hover!) - 40)) }}
        >
          <span className="text-ink-3">{fmtDay(hi.ts)} </span>
          <span className="font-semibold tabular text-ink">{hi.value.toFixed(1)}</span>
          {hi.lo != null && hi.hi != null && (
            <span className="text-ink-4"> ({hi.lo.toFixed(0)}–{hi.hi.toFixed(0)})</span>
          )}
          {/* v4.1 disclosure: a step on fewer than THIN_MONTH_IDENTITIES identities is
              published, and says so here rather than reading with the confidence of
              a month with 200. */}
          {hi.thin && (
            <div className="text-ink-4">thin month{hi.n != null ? ` · ${hi.n} identities` : ""}</div>
          )}
        </div>
      )}
    </div>
    </>
  );
}
