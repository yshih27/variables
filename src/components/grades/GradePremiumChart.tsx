"use client";

import { useMemo, useRef, useState } from "react";
import { Section } from "../Section";
import { ChartActions } from "../ChartActions";
import type { PREMIUM_PAIRS } from "@/lib/data/gradePremium";

/**
 * The question each pair answers, for the chart's caption.
 *
 * ⚠️ COPY LIVES HERE, THE PAIRS LIVE IN THE BACKEND. `PREMIUM_PAIRS` is the SSOT
 * for WHICH pairs exist and what their blob ids are; a sentence explaining what a
 * reader is looking at is a frontend concern, so it hangs off the id rather than
 * being pushed into the data module. An id with no entry simply shows no caption.
 */
const QUESTION: Record<string, string> = {
  "premium:psa-10:psa-9": "what the top grade costs over the one below it",
  "premium:cgc-10:psa-10": "what the market pays for the label at the same grade",
  "premium:psa-9:psa-8": "whether the spread holds further down the scale",
  "premium:graded:raw": "what grading itself is worth",
};

/**
 * The grade premium — what one grade costs relative to the next, month by month.
 *
 * ⚠️ 100% IS DRAWN AND IT IS THE READING. Above the line the first grade costs
 * more than the second; the PSA 10 / 9 line sitting near 350% says the top grade
 * trades at about three and a half times the one below it. Without the baseline a
 * reader has to do that arithmetic from the axis.
 *
 * ⚠️ THE BAND IS `n`, NOT A CONFIDENCE INTERVAL. Each month's value is a weighted
 * median over `n` matched identities; the band's half-width is drawn from n so a
 * month resting on ten cards is visibly less settled than one resting on eighty.
 * It is a sample-size cue and is labelled as one — calling it a confidence
 * interval would claim a distribution we have not established.
 *
 * ⚠️ WITHHELD MONTHS LEAVE A GAP. A month below the matched-identity floor is not
 * published, and the line is BROKEN across it rather than drawn straight through:
 * an interpolated segment is a price movement that nobody observed.
 */

export type PremiumSeriesView = {
  pair: (typeof PREMIUM_PAIRS)[number];
  /** Percent (the reader converts the blob's ratio); `lo`/`hi` are the matched
   *  ratios' interquartile spread, on the same scale. */
  points: { ts: string; value: number; n?: number; lo?: number; hi?: number }[];
  absent: "not-published" | null;
};

const PLOT_H = 260;
const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 14;
const PAD_B = 26;
const VIEW_W = 1000;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (iso: string) => {
  const d = new Date(iso);
  return `${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
};

export function GradePremiumChart({ series }: { series: PremiumSeriesView[] }) {
  const first = series.findIndex((s) => s.absent == null);
  const [active, setActive] = useState(first < 0 ? 0 : first);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const current = series[active];

  const shaped = useMemo(() => {
    const pts = current?.points ?? [];
    if (pts.length < 2) return null;
    const values = pts.flatMap((p) => [p.value, p.lo, p.hi].filter((v): v is number => v != null));
    // Always include 100 in the domain — the baseline IS the reading.
    const lo = Math.min(100, ...values) * 0.94;
    const hi = Math.max(100, ...values) * 1.06;
    const span = hi - lo || 1;
    const t0 = Date.parse(pts[0].ts);
    const t1 = Date.parse(pts[pts.length - 1].ts);
    const dt = t1 - t0 || 1;
    const x = (iso: string) => PAD_L + ((Date.parse(iso) - t0) / dt) * (VIEW_W - PAD_L - PAD_R);
    const y = (v: number) => PAD_T + (1 - (v - lo) / span) * (PLOT_H - PAD_T - PAD_B);

    // Break the path wherever a month was withheld: adjacency is "the next
    // calendar month", never "the next published point".
    const segments: { ts: string; value: number; n?: number }[][] = [];
    let run: typeof pts = [];
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) {
        const a = new Date(pts[i - 1].ts), b = new Date(pts[i].ts);
        const gap = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
        if (gap !== 1) { segments.push(run); run = []; }
      }
      run.push(pts[i]);
    }
    if (run.length) segments.push(run);

    const maxN = Math.max(...pts.map((p) => p.n ?? 0), 1);
    /**
     * ⚠️ THE BAND IS THE BACKEND'S MEASURED SPREAD, not a function of n.
     *
     * It used to be drawn as `value · 0.12/√n` — a stand-in, because the blob
     * carried no band for a premium. It does now: `lo`/`hi` are the INTERQUARTILE
     * range of the matched ratios in that month, which is the real dispersion of
     * the observations rather than a curve fitted to their count. Where a point
     * has no band it draws none; nothing is inferred.
     */
    const banded = pts.filter((p) => p.lo != null && p.hi != null);
    const bandPath = banded.length >= 2
      ? (() => {
          const up: string[] = [], down: string[] = [];
          for (const p of banded) {
            up.push(`${x(p.ts).toFixed(1)} ${y(p.hi!).toFixed(1)}`);
            down.unshift(`${x(p.ts).toFixed(1)} ${y(p.lo!).toFixed(1)}`);
          }
          return `M${up.join(" L")} L${down.join(" L")} Z`;
        })()
      : null;

    const ticks = [lo + span * 0.15, 100, hi - span * 0.15].filter((v, i, a) => a.indexOf(v) === i);
    return { pts, segments, x, y, lo, hi, bandPath, maxN, ticks };
  }, [current]);

  const gaps = shaped ? shaped.segments.length - 1 : 0;

  return (
    <Section
      title="Grade premium"
      readMe="same card, two grades, monthly"
      subtitle={
        current
          ? `${current.pair.better} ÷ ${current.pair.worse}${QUESTION[current.pair.id] ? ` — ${QUESTION[current.pair.id]}` : ""}. Weighted median over identities priced in both grades that month.`
          : undefined
      }
      right={
        shaped ? (
          <ChartActions
            meta={{
              title: `Grade premium — ${current.pair.label}`,
              readMe: "same card, two grades, monthly",
              unit: "%",
              window: `${shaped.pts.length} complete months`,
              asOf: shaped.pts.at(-1)?.ts ?? null,
              slug: `grade-premium-${current.pair.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
            }}
            series={[
              {
                key: current.pair.id,
                label: `${current.pair.better} ÷ ${current.pair.worse} (%)`,
                color: "var(--color-yellow)",
                points: shaped.pts.map((p) => ({ ts: p.ts, value: p.value })),
              },
            ]}
            svgRef={svgRef}
            plotHeight={PLOT_H}
            legend={[{ color: "var(--color-yellow)", text: `${current.pair.better} ÷ ${current.pair.worse}` }]}
          />
        ) : undefined
      }
    >
      {/* In-chart switches: the pairs are four answers to one question, so they
          share a canvas rather than becoming four charts (one question per zone). */}
      <div className="mb-3 flex flex-wrap gap-1">
        {series.map((s, i) => {
          const on = i === active;
          const dead = s.absent != null;
          return (
            <button
              key={s.pair.label}
              type="button"
              disabled={dead}
              onClick={() => setActive(i)}
              title={dead ? `${s.pair.better} ÷ ${s.pair.worse}: not published — too few identities priced in both grades` : QUESTION[s.pair.id] ?? s.pair.label}
              className={`rounded-lg px-2 py-1 font-mono text-[11px] leading-none transition-colors ${
                dead
                  ? "cursor-not-allowed bg-bg-1 text-ink-4 line-through"
                  : on
                    ? "bg-yellow font-semibold text-bg"
                    : "bg-bg-2 text-ink-2 hover:bg-bg-3 hover:text-ink"
              }`}
            >
              {s.pair.label}
            </button>
          );
        })}
      </div>

      {!shaped ? (
        <p className="text-[12.5px] text-ink-3">
          {current
            ? `No month has ${current.pair.better} and ${current.pair.worse} prices for enough of the same cards.`
            : "No grade pair is published yet."}
        </p>
      ) : (
        <>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_W} ${PLOT_H}`}
            preserveAspectRatio="none"
            className="h-[260px] w-full"
            role="img"
            aria-label={`${current.pair.better} divided by ${current.pair.worse}, monthly, ${shaped.pts.length} months`}
          >
            {shaped.ticks.map((v) => (
              <g key={v}>
                <line
                  x1={PAD_L} y1={shaped.y(v)} x2={VIEW_W - PAD_R} y2={shaped.y(v)}
                  stroke={v === 100 ? "var(--color-line-2)" : "var(--color-line)"}
                  strokeWidth="1"
                  strokeDasharray={v === 100 ? "4 3" : undefined}
                  vectorEffect="non-scaling-stroke"
                />
                <text x={4} y={shaped.y(v) + 3} className="fill-ink-4 font-mono" fontSize="9">
                  {Math.round(v)}%
                </text>
              </g>
            ))}

            {shaped.bandPath && <path d={shaped.bandPath} fill="var(--color-yellow)" opacity="0.14" />}

            {shaped.segments.map((seg, i) => (
              <path
                key={i}
                d={seg.map((p, j) => `${j ? "L" : "M"}${shaped.x(p.ts).toFixed(1)} ${shaped.y(p.value).toFixed(1)}`).join(" ")}
                fill="none"
                stroke="var(--color-yellow)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {shaped.pts.map((p) => (
              <circle
                key={p.ts}
                cx={shaped.x(p.ts)}
                cy={shaped.y(p.value)}
                r="3"
                fill="var(--color-yellow)"
              >
                <title>{`${monthLabel(p.ts)}: ${p.value.toFixed(0)}% · ${p.n ?? 0} matched cards`}</title>
              </circle>
            ))}

            <text x={PAD_L} y={PLOT_H - 6} className="fill-ink-4 font-mono" fontSize="9">
              {monthLabel(shaped.pts[0].ts)}
            </text>
            <text x={VIEW_W - PAD_R} y={PLOT_H - 6} textAnchor="end" className="fill-ink-4 font-mono" fontSize="9">
              {monthLabel(shaped.pts[shaped.pts.length - 1].ts)}
            </text>
          </svg>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-ink-4">
            <span>100% = the two grades cost the same</span>
            <span>
              {shaped.bandPath ? "band = interquartile spread of the matched ratios · " : ""}
              {shaped.pts.at(-1)?.n ?? 0} matched cards latest, {shaped.maxN} at most
            </span>
            {gaps > 0 && (
              <span className="text-ink-3">
                {gaps} month{gaps > 1 ? "s" : ""} withheld — line broken, never interpolated
              </span>
            )}
          </div>
        </>
      )}
    </Section>
  );
}
