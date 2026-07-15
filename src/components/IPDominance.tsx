"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Dropdown } from "./Dropdown";
import { Section } from "./Section";

export type DomMetric = "volume" | "cards" | "trades" | "avgTrade";
export type DomEntity = { name: string; color: string; values: Record<DomMetric, number> };
export type DominanceSource = { entities: DomEntity[] };

const METRICS: ReadonlyArray<{ value: DomMetric; label: string }> = [
  { value: "volume", label: "24h Volume" },
  { value: "cards", label: "Cards" },
  { value: "trades", label: "Trades" },
  { value: "avgTrade", label: "Avg Trade" },
];

/**
 * Set / Grade / IP dominance — the CURRENT composition for the chosen metric as
 * a 100%-stacked share bar + legend. All real (shares of the live values). No
 * historical trend is drawn: the backend doesn't record per-set/grade/IP daily
 * history yet, and we don't fabricate one. (When metric_snapshots grows that
 * history, this can regain a real trend.)
 *
 * Each panel renders inside the shared <Section> frame (D1) — IPDominance is
 * just the IP page's side-by-side pair of them.
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
    <div className="mb-12 grid grid-cols-1 gap-6 font-sans min-[1024px]:grid-cols-2">
      <DominancePanel title="Set dominance" source={sets} defaultMetric="volume" seeAllHref={setsSeeAllHref} />
      <DominancePanel title="Grade dominance" source={grades} defaultMetric="cards" seeAllHref={gradesSeeAllHref} />
    </div>
  );
}

export function DominancePanel({
  title,
  source,
  defaultMetric,
  seeAllHref,
  className,
}: {
  title: string;
  source: DominanceSource;
  defaultMetric: DomMetric;
  seeAllHref?: string;
  className?: string;
}) {
  const [metric, setMetric] = useState<DomMetric>(defaultMetric);
  const [hi, setHi] = useState<string | null>(null);

  const segments = useMemo(() => {
    // avg_trade is DERIVED (volume ÷ trades), not a stored/backend metric (F7);
    // guarding /0. Deriving here also restores "Other" buckets that were passed
    // avgTrade: 0 (they now show their real average instead of dropping out).
    const ents = source.entities
      .map((e) => {
        const raw =
          metric === "avgTrade"
            ? e.values.trades > 0
              ? e.values.volume / e.values.trades
              : 0
            : e.values[metric] || 0;
        return { name: e.name, color: e.color, v: Math.max(0, raw) };
      })
      .filter((e) => e.v > 0);
    const total = ents.reduce((a, e) => a + e.v, 0) || 1;
    return ents
      .map((e) => ({ ...e, share: e.v / total }))
      .sort((a, b) => b.share - a.share);
  }, [source, metric]);

  const metricLabel = METRICS.find((m) => m.value === metric)!.label.toLowerCase();
  const active = hi ? segments.find((s) => s.name === hi) : null;

  return (
    <Section
      title={title}
      subtitle={
        <>
          current share of {metricLabel}
          {seeAllHref && (
            <>
              {" · "}
              <Link href={seeAllHref} className="text-ink-3 transition-colors hover:text-yellow">
                view all →
              </Link>
            </>
          )}
        </>
      }
      right={<Dropdown value={metric} options={METRICS} onChange={setMetric} />}
      className={className}
    >
      {segments.length === 0 ? (
        <div className="flex h-11 items-center rounded-xl border border-line bg-bg-2 px-3 font-mono text-[12px] text-ink-4">
          No data
        </div>
      ) : (
        <>
          {/* 100%-stacked share bar — real current shares */}
          <div className="flex h-11 w-full overflow-hidden rounded-xl border border-line bg-bg-2">
            {segments.map((s) => (
              <button
                key={s.name}
                type="button"
                onMouseEnter={() => setHi(s.name)}
                onMouseLeave={() => setHi(null)}
                className="h-full min-w-[2px] border-r border-bg transition-opacity last:border-r-0"
                style={{
                  width: `${s.share * 100}%`,
                  background: s.color,
                  opacity: hi && hi !== s.name ? 0.35 : 0.88,
                }}
                aria-label={`${s.name}: ${Math.round(s.share * 100)}%`}
                title={`${s.name} · ${Math.round(s.share * 100)}%`}
              />
            ))}
          </div>

          {/* hover readout (reserves height → no layout shift) */}
          <div className="mt-2 h-4 font-mono text-[11.5px]">
            {active ? (
              <span className="text-ink-2">
                {active.name}{" "}
                <span className="font-semibold tabular text-ink">{Math.round(active.share * 100)}%</span>
              </span>
            ) : (
              <span className="text-ink-4">
                {segments.length} {segments.length === 1 ? "entry" : "entries"} · hover to inspect
              </span>
            )}
          </div>

          {/* Legend — real current shares */}
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {segments.map((s) => (
              <span
                key={s.name}
                onMouseEnter={() => setHi(s.name)}
                onMouseLeave={() => setHi(null)}
                className={`flex cursor-default items-center gap-1.5 text-[12px] transition-opacity ${
                  hi && hi !== s.name ? "text-ink-2 opacity-45" : "text-ink-2"
                }`}
              >
                <span className="h-2 w-2 rounded-md" style={{ background: s.color }} />
                {s.name}
                <span className="font-mono font-semibold tabular text-ink">{Math.round(s.share * 100)}%</span>
              </span>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}
