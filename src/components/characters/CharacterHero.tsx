"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Section } from "../Section";
import { ChartActions } from "../ChartActions";
import { ChartTooltip, anchorFromEvent, type TooltipAnchor } from "../ChartTooltip";
import type { CharacterIndexGate, CharacterMonthly } from "@/lib/data/characterRollups";
import type { IdentityIndexPoint } from "@/lib/data/identityIndex";
import { formatCompactUsd, formatDelta } from "@/lib/format";
import { PALETTE } from "@/lib/studio/catalog";
import { monthLong, monthShort } from "@/lib/card/identityView";
import { provisionalLabel } from "@/lib/card/characterView";
import { monthStartUtc } from "@/lib/chart/period";

/**
 * The hero — what this character does, month by month.
 *
 * Two modes, decided by the reader and never by this component:
 *
 * • INDEX PUBLISHED — the character index (`identityIndex()` on the
 *   character's own cards, complete months only) as the line on the left
 *   scale, with monthly resale volume as a band of bars under it on the right
 *   scale. A thin month (the engine's flag) is a hollow marker; two published
 *   months that are not adjacent are not joined (a withheld step is not a
 *   month's move).
 *
 * • NO INDEX — the monthly volume bars alone. The read-me says why, from
 *   `indexGate`: under the floor, or the floor met but not two months running.
 *   Never a flat line standing in for a level nobody measured.
 *
 * ⚠️ THE RUNNING MONTH IS HOLLOW AND PROVISIONAL. `monthly` carries it flagged
 * `partial`; it is drawn as a dashed outline labelled "Sep · provisional · n
 * sales", its tooltip leads with that label, and it is in no CSV row.
 *
 * One measured-width <svg> carries both layers, so the PNG export carries the
 * band by construction (the economics hero draws its overlay in a second svg
 * marked `data-export-layer`; with one document there is nothing to fold in).
 */

const H = 260;
// The right inset holds the volume axis only when the index owns the left one.
const PAD = { l: 52, rIndex: 56, r: 16, t: 16, b: 26 };
const DAY = 86_400_000;
const LINE = PALETTE[0]; // the index palette's first slot — the set and grade pages' first line
const BAND = "var(--color-line-2)";
const BARS = "var(--color-yellow)";

type Hover =
  | { kind: "month"; m: CharacterMonthly; at: TooltipAnchor }
  | { kind: "index"; p: IdentityIndexPoint; at: TooltipAnchor };

const monthStartOf = (monthEndIso: string) => Date.parse(monthStartUtc(Date.parse(monthEndIso)));
const monthsApart = (a: string, b: string) => {
  const da = new Date(a), db = new Date(b);
  return (db.getUTCFullYear() - da.getUTCFullYear()) * 12 + (db.getUTCMonth() - da.getUTCMonth());
};

export function CharacterHero({
  name,
  ip,
  characterKey,
  index,
  gate,
  monthly,
}: {
  name: string;
  ip: string;
  characterKey: string;
  index: IdentityIndexPoint[] | null;
  gate: CharacterIndexGate;
  monthly: CharacterMonthly[];
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [w, setW] = useState(860);
  const [hover, setHover] = useState<Hover | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => {
      for (const e of es) setW(Math.max(280, Math.round(e.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const published = !!index && index.length >= 2;
  const readMe = published
    ? "the character index, with the resale behind it"
    : gate.held === "too-few-months"
      ? "no index yet: not 20 priced cards two months running"
      : "no index yet: under 20 priced cards a month";

  const model = useMemo(() => {
    const months = [...monthly].filter((m) => Number.isFinite(Date.parse(m.ts))).sort((a, b) => a.ts.localeCompare(b.ts));
    const idx = published ? [...index!].sort((a, b) => a.ts.localeCompare(b.ts)) : [];
    if (!months.length && !idx.length) return null;
    const complete = months.filter((m) => !m.partial);
    const partial = months.find((m) => m.partial) ?? null;

    const stamps = [...months.map((m) => m.ts), ...idx.map((p) => p.ts)];
    const t0raw = Math.min(...stamps.map(monthStartOf));
    const t1raw = Math.max(...stamps.map((s) => Date.parse(s)));
    const spanT = Math.max(t1raw - t0raw, 28 * DAY);
    const t0 = t0raw - spanT * 0.02;
    const t1 = t1raw + spanT * 0.02;
    const padR = published ? PAD.rIndex : PAD.r;
    const innerW = w - PAD.l - padR;
    const innerH = H - PAD.t - PAD.b;
    const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * innerW;

    // Volume scale — from zero, always, so a bar's height is its size.
    const vMax = Math.max(1, ...months.map((m) => m.volumeUsd));
    const yV = (v: number) => PAD.t + (1 - v / (vMax * 1.08)) * innerH;
    // Index scale — around the published levels, 100 kept in reach.
    const vals = idx.map((p) => p.value);
    const iLo = idx.length ? Math.min(...vals, 100) * 0.96 : 0;
    const iHi = idx.length ? Math.max(...vals, 100) * 1.04 : 1;
    const yI = (v: number) => PAD.t + (1 - (v - iLo) / (iHi - iLo || 1)) * innerH;

    // A bar sits in its month's slot, capped so a two-month history does not
    // draw two slabs the width of the canvas.
    const BAR_MAX = 96;
    const bars = months.map((m) => {
      const s = monthStartOf(m.ts), e = Date.parse(m.ts);
      const slot = Math.max(2, x(e) - x(s) - 4);
      const bw = Math.min(slot, BAR_MAX);
      const mid = (x(s) + x(e)) / 2;
      return { m, x0: mid - bw / 2, x1: mid + bw / 2, y: yV(m.volumeUsd), base: yV(0) };
    });
    // Index segments: adjacent months only.
    const segments: IdentityIndexPoint[][] = [];
    let run: IdentityIndexPoint[] = [];
    for (let i = 0; i < idx.length; i++) {
      if (i > 0 && monthsApart(idx[i - 1].ts, idx[i].ts) !== 1) { segments.push(run); run = []; }
      run.push(idx[i]);
    }
    if (run.length) segments.push(run);

    // Ticks
    const nice = (v: number) => { const p = 10 ** Math.floor(Math.log10(Math.max(v, 1))); const f = v / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; };
    const vStep = nice(vMax / 3);
    const vTicks: number[] = [];
    for (let v = vStep; v <= vMax * 1.08; v += vStep) vTicks.push(v);
    const iTicks = idx.length ? [iLo + (iHi - iLo) * 0.15, 100, iHi - (iHi - iLo) * 0.15].filter((v, i, a) => a.indexOf(v) === i && v > iLo && v < iHi) : [];
    const xTicks = months.length ? months.map((m) => ({ t: (monthStartOf(m.ts) + Date.parse(m.ts)) / 2, label: monthShort(m.ts) })) : [];
    // One label per ~34px of plot, so nine months at 375 thin to every third.
    const every = Math.max(1, Math.ceil(xTicks.length / Math.max(1, Math.floor(innerW / 34))));

    return { months, complete, partial, idx, bars, segments, x, yV, yI, vTicks, iTicks, xTicks: xTicks.filter((_, i) => i % every === 0), innerH, padR };
  }, [monthly, index, published, w]);

  const exportRows = useMemo(() => {
    if (!model) return null;
    const idxByMonth = new Map(model.idx.map((p) => [p.ts.slice(0, 7), p]));
    return {
      columns: ["month", "sales", "volume_usd", ...(published ? ["index", "priced_cards", "thin"] : [])],
      // Complete months only — the running month is provisional and stays off every artefact.
      rows: model.complete.map((m) => {
        const p = idxByMonth.get(m.ts.slice(0, 7));
        return [m.ts.slice(0, 7), m.sales, Number(m.volumeUsd.toFixed(2)), ...(published ? [p ? Number(p.value.toFixed(2)) : null, p?.n ?? null, p ? (p.thin ? "thin" : "") : null] : [])];
      }),
    };
  }, [model, published]);

  const nComplete = model?.complete.length ?? 0;
  const title = published ? `${name} index` : `${name}, month by month`;

  if (!model) {
    return (
      <Section title={title} readMe={readMe}>
        <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-center">
          <span className="text-[13px] text-ink-2">No resale in the panel</span>
          <span className="max-w-[440px] text-[12px] leading-relaxed text-ink-3">
            The cards are tracked; monthly resale will chart here as it clears.
          </span>
        </div>
      </Section>
    );
  }

  const legend = [
    { color: published ? "#8a8a92" : BARS, text: "monthly resale volume" },
    ...(published ? [{ color: LINE, text: `${name} index (100 = base month)` }] : []),
  ];

  return (
    <Section
      title={title}
      readMe={readMe}
      subtitle={`${nComplete} complete month${nComplete === 1 ? "" : "s"}${model.complete.length ? ` · ${monthLong(model.complete[0].ts)} – ${monthLong(model.complete[model.complete.length - 1].ts)}` : ""}${model.partial ? ` · ${monthShort(model.partial.ts)} in progress` : ""}`}
      right={
        <ChartActions
          meta={{
            title: `${name} — ${published ? "index and monthly resale" : "monthly resale"}`,
            readMe,
            unit: published ? "USD · index (100 = base month)" : "USD",
            window: `${nComplete} complete months`,
            asOf: model.complete.at(-1)?.ts ?? null,
            slug: `character-${ip}-${characterKey}`,
          }}
          rows={exportRows ?? undefined}
          svgRef={svgRef}
          plotHeight={H}
          legend={legend}
        />
      }
    >
      <div ref={wrapRef} className="relative w-full" style={{ height: H }} onMouseLeave={() => setHover(null)}>
        <svg ref={svgRef} width={w} height={H} className="block" role="img" aria-label={published ? `${name} index with monthly resale volume` : `${name} monthly resale volume`}>
          {/* volume ticks — the right axis when the index owns the left */}
          {model.vTicks.map((v) => (
            <g key={`v${v}`}>
              <line x1={PAD.l} x2={w - model.padR} y1={model.yV(v)} y2={model.yV(v)} stroke="var(--color-line)" strokeWidth={1} />
              <text x={published ? w - model.padR + 6 : PAD.l - 6} y={model.yV(v) + 3} textAnchor={published ? "start" : "end"} fontSize={9.5} fill="var(--color-ink-4)" fontFamily="var(--font-jetbrains-mono), monospace">
                {formatCompactUsd(v)}
              </text>
            </g>
          ))}
          {published && model.iTicks.map((v) => (
            <g key={`i${v}`}>
              {v === 100 && <line x1={PAD.l} x2={w - model.padR} y1={model.yI(100)} y2={model.yI(100)} stroke="var(--color-line-2)" strokeWidth={1} strokeDasharray="4 3" />}
              <text x={PAD.l - 6} y={model.yI(v) + 3} textAnchor="end" fontSize={9.5} fill={v === 100 ? "var(--color-ink-3)" : "var(--color-ink-4)"} fontFamily="var(--font-jetbrains-mono), monospace">
                {v.toFixed(0)}
              </text>
            </g>
          ))}
          {model.xTicks.map((t) => (
            <text key={t.t} x={model.x(t.t)} y={H - 8} textAnchor="middle" fontSize={9.5} fill="var(--color-ink-4)" fontFamily="var(--font-jetbrains-mono), monospace">
              {t.label}
            </text>
          ))}

          {/* monthly resale — the band under the index, or the picture itself */}
          {model.bars.map((b) => (
            <rect
              key={b.m.ts}
              x={b.x0} y={Math.min(b.y, b.base - 1)} width={b.x1 - b.x0} height={Math.max(1, b.base - b.y)}
              fill={b.m.partial ? "none" : published ? BAND : BARS}
              fillOpacity={b.m.partial ? 1 : published ? 0.55 : 0.85}
              stroke={b.m.partial ? (published ? "var(--color-ink-4)" : BARS) : "none"}
              strokeWidth={b.m.partial ? 1.25 : 0}
              strokeDasharray={b.m.partial ? "3 3" : undefined}
              className="cursor-default"
              onMouseMove={(e) => setHover({ kind: "month", m: b.m, at: anchorFromEvent(e) })}
            />
          ))}
          {model.partial && (() => {
            const b = model.bars.find((x) => x.m.partial)!;
            const label = provisionalLabel(b.m);
            const cx = (b.x0 + b.x1) / 2;
            const anchor = cx > w - model.padR - 120 ? "end" : "middle";
            return (
              <text x={anchor === "end" ? b.x1 : cx} y={Math.min(b.y, b.base - 1) - 6} textAnchor={anchor} fontSize={9.5} fill="var(--color-ink-3)" fontFamily="var(--font-jetbrains-mono), monospace">
                {label}
              </text>
            );
          })()}

          {/* the character index — complete months, adjacent months joined */}
          {published && model.segments.map((seg, i) => (
            <path
              key={`s${i}`}
              d={seg.map((p, j) => `${j ? "L" : "M"}${model.x(Date.parse(p.ts)).toFixed(1)} ${model.yI(p.value).toFixed(1)}`).join(" ")}
              fill="none" stroke={LINE} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            />
          ))}
          {published && model.idx.map((p) => (
            <circle
              key={p.ts}
              cx={model.x(Date.parse(p.ts))} cy={model.yI(p.value)} r={p.thin ? 4 : 3}
              fill={p.thin ? "var(--color-bg-1)" : LINE} stroke={LINE} strokeWidth={p.thin ? 1.5 : 1}
              className="cursor-default"
              onMouseMove={(e) => setHover({ kind: "index", p, at: anchorFromEvent(e) })}
            >
              <title>{`${monthLong(p.ts)} · ${p.value.toFixed(1)}${p.n != null ? ` · ${p.n} priced cards` : ""}${p.thin ? " · thin" : ""}`}</title>
            </circle>
          ))}
        </svg>

        <ChartTooltip anchor={hover?.at ?? null} width={210}>
          {hover?.kind === "month" && (hover.m.partial ? (
            <>
              <div className="font-semibold text-ink">{monthShort(hover.m.ts)} · provisional</div>
              <div className="text-ink-3">{formatCompactUsd(hover.m.volumeUsd)} · {hover.m.sales} sale{hover.m.sales === 1 ? "" : "s"} so far</div>
              <div className="text-ink-4">month in progress · not in the CSV</div>
            </>
          ) : (
            <>
              <div className="font-semibold tabular text-ink">{formatCompactUsd(hover.m.volumeUsd)}</div>
              <div className="text-ink-3">{monthLong(hover.m.ts)} · {hover.m.sales} sale{hover.m.sales === 1 ? "" : "s"}</div>
              <div className="text-ink-4">resale volume, every set and grade</div>
            </>
          ))}
          {hover?.kind === "index" && (
            <>
              <div className="font-semibold tabular text-ink">{hover.p.value.toFixed(1)}</div>
              <div className="text-ink-3">{monthLong(hover.p.ts)}{hover.p.n != null ? ` · ${hover.p.n} priced cards` : ""}</div>
              {hover.p.thin && <div className="text-ink-4">thin month — fewer cards than the engine trusts</div>}
            </>
          )}
        </ChartTooltip>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-ink-4">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2" style={{ background: published ? BAND : BARS, opacity: published ? 0.7 : 0.85 }} />
          monthly resale volume
        </span>
        {published && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3" style={{ background: LINE }} />
            {name} index · 100 = base month · hollow = thin month
            {(() => { const l = model.idx.at(-1)!; const prev = model.idx.at(-2); const d = prev && monthsApart(prev.ts, l.ts) === 1 ? (l.value / prev.value - 1) * 100 : null; return d != null ? ` · ${formatDelta(d)} 1m` : ""; })()}
          </span>
        )}
        {model.partial && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 border border-dashed" style={{ borderColor: published ? "var(--color-ink-4)" : BARS }} />
            running month, provisional — drawn, never in the CSV
          </span>
        )}
      </div>
    </Section>
  );
}
