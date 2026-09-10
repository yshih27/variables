"use client";

import { useMemo, useRef } from "react";
import { Section } from "../Section";
import { ChartActions } from "../ChartActions";

/**
 * Published index levels for a family of entities — the grade indices, or one
 * set's — rebased to 100 at the first month they share.
 *
 * ⚠️ THIS IS NOT THE INDEX STUDIO, AND THE DIFFERENCE IS DELIBERATE FOR NOW.
 * brief-grades-and-sets asks for "studio scoped to `grade:*`", which needs the
 * studio's catalog to ENUMERATE grade and set entities — a `ChartLoader` listing
 * call, the /api/internal/chart route that backs it, and the seed the warmer
 * writes per scope. All three are backend item 4. This component draws the same
 * numbers off the same blob keys, with the same export actions, so the zone
 * answers its question today; when item 4 lands, swap it for
 * `<IndexStudio scope={{ entity: "grade" }} />` and delete this.
 *
 * ⚠️ REBASED ON THE SHARED BASE, not each line's own first point. Two grades
 * whose histories start in different months are not comparable if each starts at
 * 100 — the later one would appear to have gone nowhere while the earlier one
 * moved. Lines are rebased at the first month they ALL have; a line with no
 * value there keeps its own base and says so.
 *
 * ⚠️ MONTH-END STAMPS. The last point is weeks behind today by construction (the
 * running month is never published), so the axis is labelled by month and the
 * footer says which month the level is as of. A level that reads as "today" is
 * the whole failure mode the monthly cadence exists to avoid.
 */

export type LevelSeries = {
  id: string;
  ticker: string;
  name: string;
  color: string;
  points: { ts: string; value: number; n?: number }[];
};

const PLOT_H = 200;
const PAD_L = 40;
const PAD_R = 10;
const PAD_T = 12;
const PAD_B = 24;
const VIEW_W = 1000;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (iso: string) => {
  const d = new Date(iso);
  return `${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
};

export function IndexLevelsChart({
  series,
  title,
  readMe,
  subtitle,
  emptyNote,
  fill,
}: {
  series: LevelSeries[];
  title: string;
  readMe: string;
  subtitle?: string;
  emptyNote: string;
  fill?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const shaped = useMemo(() => {
    const live = series.filter((s) => s.points.length >= 2);
    if (!live.length) return null;

    // The first month every line has — the shared base.
    const common = live
      .map((s) => new Set(s.points.map((p) => p.ts)))
      .reduce((acc, set) => new Set([...acc].filter((t) => set.has(t))));
    const base = [...common].sort()[0] ?? null;

    const rebased = live.map((s) => {
      const b = base ? s.points.find((p) => p.ts === base)?.value : undefined;
      const f = b && b > 0 ? 100 / b : 100 / s.points[0].value;
      return { ...s, ownBase: !b, points: s.points.map((p) => ({ ...p, value: p.value * f })) };
    });

    const all = rebased.flatMap((s) => s.points);
    const lo = Math.min(...all.map((p) => p.value)) * 0.96;
    const hi = Math.max(...all.map((p) => p.value)) * 1.04;
    const span = hi - lo || 1;
    const times = [...new Set(all.map((p) => p.ts))].sort();
    const t0 = Date.parse(times[0]);
    const t1 = Date.parse(times[times.length - 1]);
    const dt = t1 - t0 || 1;
    const x = (iso: string) => PAD_L + ((Date.parse(iso) - t0) / dt) * (VIEW_W - PAD_L - PAD_R);
    const y = (v: number) => PAD_T + (1 - (v - lo) / span) * (PLOT_H - PAD_T - PAD_B);
    return { rebased, x, y, lo, hi, times, base };
  }, [series]);

  return (
    <Section
      title={title}
      readMe={readMe}
      subtitle={subtitle}
      fill={fill}
      right={
        shaped ? (
          <ChartActions
            meta={{
              title,
              readMe,
              unit: "index (100 = base month)",
              window: `${shaped.times.length} complete months`,
              asOf: shaped.times[shaped.times.length - 1] ?? null,
              slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            }}
            series={shaped.rebased.map((s) => ({
              key: s.id,
              label: `${s.ticker} ${s.name}`,
              color: s.color,
              points: s.points.map((p) => ({ ts: p.ts, value: p.value })),
            }))}
            svgRef={svgRef}
            plotHeight={PLOT_H}
            legend={shaped.rebased.map((s) => ({ color: s.color, text: s.name }))}
          />
        ) : undefined
      }
    >
      {!shaped ? (
        <p className="text-[12.5px] text-ink-3">{emptyNote}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap gap-x-3 gap-y-1 pb-2 text-[11px]">
            {shaped.rebased.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5 text-ink-3">
                <span aria-hidden className="h-0.5 w-3" style={{ background: s.color }} />
                {s.name}
                <span className="tabular text-ink-2">{s.points.at(-1)!.value.toFixed(1)}</span>
                {s.ownBase && (
                  <span className="font-mono text-[9.5px] text-ink-4" title="starts after the shared base month, so it is rebased on its own first month">
                    own base
                  </span>
                )}
              </span>
            ))}
          </div>

          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_W} ${PLOT_H}`}
            preserveAspectRatio="none"
            className="h-[200px] w-full"
            role="img"
            aria-label={`${title}: ${shaped.rebased.length} series over ${shaped.times.length} months`}
          >
            <line
              x1={PAD_L} y1={shaped.y(100)} x2={VIEW_W - PAD_R} y2={shaped.y(100)}
              stroke="var(--color-line-2)" strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"
            />
            <text x={4} y={shaped.y(100) + 3} className="fill-ink-4 font-mono" fontSize="9">100</text>

            {shaped.rebased.map((s) => (
              <g key={s.id}>
                <path
                  d={s.points.map((p, i) => `${i ? "L" : "M"}${shaped.x(p.ts).toFixed(1)} ${shaped.y(p.value).toFixed(1)}`).join(" ")}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                {s.points.map((p) => (
                  <circle key={p.ts} cx={shaped.x(p.ts)} cy={shaped.y(p.value)} r="2.4" fill={s.color}>
                    <title>{`${s.name} · ${monthLabel(p.ts)}: ${p.value.toFixed(1)}${p.n ? ` · ${p.n} identities` : ""}`}</title>
                  </circle>
                ))}
              </g>
            ))}
          </svg>

          <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-ink-4">
            <span>{monthLabel(shaped.times[0])}</span>
            <span className="text-ink-3">100 = {shaped.base ? monthLabel(shaped.base) : "first month"}</span>
            <span>as of {monthLabel(shaped.times[shaped.times.length - 1])}</span>
          </div>
        </div>
      )}
    </Section>
  );
}
