"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Dropdown } from "./Dropdown";

export type DomMetric = "volume" | "cards" | "trades" | "avgTrade";
export type DomEntity = { name: string; color: string; values: Record<DomMetric, number> };
export type DominanceSource = { entities: DomEntity[] };

const METRICS: ReadonlyArray<{ value: DomMetric; label: string }> = [
  { value: "volume", label: "24h Volume" },
  { value: "cards", label: "Cards" },
  { value: "trades", label: "Trades" },
  { value: "avgTrade", label: "Avg Trade" },
];

const W = 600;
const CH = 200;
const N = 26;

/**
 * Set / Grade dominance — dual 100%-stacked area charts. The CURRENT shares
 * (legend + rightmost column) are real (from the chosen metric); the historical
 * trend is a deterministic sample until the backend records set/grade history.
 */
export function IPDominance({
  sets,
  grades,
  setsSeeAllHref,
  gradesSeeAllHref,
}: {
  sets: DominanceSource;
  grades: DominanceSource;
  setsSeeAllHref?: string;
  gradesSeeAllHref?: string;
}) {
  return (
    <section className="mb-12 font-sans">
      <div className="grid grid-cols-1 gap-10 min-[1024px]:grid-cols-2 min-[1024px]:gap-0 min-[1024px]:divide-x min-[1024px]:divide-line">
        <div className="min-[1024px]:pr-8">
          <DominancePanel title="Set dominance" source={sets} defaultMetric="volume" seed={11} seeAllHref={setsSeeAllHref} />
        </div>
        <div className="min-[1024px]:pl-8">
          <DominancePanel title="Grade dominance" source={grades} defaultMetric="cards" seed={23} seeAllHref={gradesSeeAllHref} />
        </div>
      </div>
    </section>
  );
}

export function DominancePanel({
  title,
  source,
  defaultMetric,
  seed,
  seeAllHref,
}: {
  title: string;
  source: DominanceSource;
  defaultMetric: DomMetric;
  seed: number;
  seeAllHref?: string;
}) {
  const [metric, setMetric] = useState<DomMetric>(defaultMetric);
  const [hi, setHi] = useState<number | null>(null);

  const { bands, legend, colShares } = useMemo(() => {
    const ents = source.entities.map((e) => ({
      name: e.name,
      color: e.color,
      v: Math.max(0, e.values[metric] || 0),
    }));
    // Placeholder per-entity series; last column = real current value.
    const raw = ents.map((e, ei) =>
      Array.from({ length: N }, (_, i) => {
        if (i === N - 1) return e.v;
        const x = i / (N - 1);
        const noise = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(seed + ei * 1.9 + x * 6.6));
        return Math.max(0.0001, e.v * noise);
      }),
    );
    // Per-column cumulative fractions (0..1), bottom → top.
    const colShares: number[][] = ents.map(() => []);
    const cumTop: number[][] = ents.map(() => []);
    const cumBot: number[][] = ents.map(() => []);
    for (let i = 0; i < N; i++) {
      const tot = ents.reduce((a, _, ei) => a + raw[ei][i], 0) || 1;
      let acc = 0;
      for (let ei = 0; ei < ents.length; ei++) {
        const frac = raw[ei][i] / tot;
        colShares[ei][i] = frac;
        cumBot[ei][i] = acc;
        acc += frac;
        cumTop[ei][i] = acc;
      }
    }
    const X = (i: number) => (i / (N - 1)) * W;
    const Y = (f: number) => CH - f * CH;
    const bands = ents.map((e, ei) => {
      const top = cumTop[ei].map((f, i) => `${X(i).toFixed(1)} ${Y(f).toFixed(1)}`);
      const bot = cumBot[ei]
        .map((f, i) => `${X(i).toFixed(1)} ${Y(f).toFixed(1)}`)
        .reverse();
      return { name: e.name, color: e.color, d: `M${top.join(" L")} L${bot.join(" L")} Z` };
    });
    const totalNow = ents.reduce((a, e) => a + e.v, 0) || 1;
    const legend = ents.map((e) => ({ name: e.name, color: e.color, share: e.v / totalNow }));
    return { bands, legend, colShares };
  }, [source, metric, seed]);

  return (
    <div>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[16px] font-semibold">{title}</h3>
          <div className="mt-1 font-mono text-[12px] text-ink-3">
            share of activity · trend sampled
            {seeAllHref && (
              <>
                {" · "}
                <Link href={seeAllHref} className="text-ink-3 transition-colors hover:text-yellow">
                  view all →
                </Link>
              </>
            )}
          </div>
        </div>
        <Dropdown value={metric} options={METRICS} onChange={setMetric} />
      </header>

      <div
        className="relative overflow-hidden rounded-xl border border-line bg-bg-1"
        onMouseLeave={() => setHi(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
          setHi(Math.round(frac * (N - 1)));
        }}
      >
        <svg viewBox={`0 0 ${W} ${CH}`} preserveAspectRatio="none" style={{ width: "100%", height: 200 }}>
          {bands.map((b) => (
            <path key={b.name} d={b.d} fill={b.color} fillOpacity={0.82} stroke={b.color} strokeWidth={0.5} />
          ))}
          {hi != null && (
            <line
              x1={(hi / (N - 1)) * W}
              x2={(hi / (N - 1)) * W}
              y1={0}
              y2={CH}
              stroke="var(--color-line-2)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {hi != null && (
          <div className="pointer-events-none absolute left-2 top-2 rounded-lg border border-line-2 bg-bg-2/95 p-2 font-sans text-[11.5px] shadow-[0_8px_28px_rgba(0,0,0,0.5)] backdrop-blur">
            {legend
              .map((l, ei) => ({ ...l, s: colShares[ei][hi] }))
              .sort((a, b) => b.s - a.s)
              .slice(0, 6)
              .map((l) => (
                <div key={l.name} className="flex items-center justify-between gap-3 py-0.5">
                  <span className="flex items-center gap-1.5 text-ink-2">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: l.color }} />
                    {l.name}
                  </span>
                  <span className="font-mono font-semibold tabular text-ink">{Math.round(l.s * 100)}%</span>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Legend — real current shares */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {legend.map((l) => (
          <span key={l.name} className="flex items-center gap-1.5 text-[12px] text-ink-2">
            <span className="h-2 w-2 rounded-[3px]" style={{ background: l.color }} />
            {l.name}
            <span className="font-mono font-semibold tabular text-ink">{Math.round(l.share * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
