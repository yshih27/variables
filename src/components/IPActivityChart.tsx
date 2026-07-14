"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Section } from "./Section";
import { MetricInfo } from "./MetricInfo";
import { type MetricKey } from "@/lib/metrics/glossary";
import { formatCompactUsd, formatInt } from "@/lib/format";
import { monotonePath } from "@/lib/chart/path";

/** Metric key → glossary entry for the ⓘ in the Metrics menu (R5-3). */
const GLOSSARY_BY_KEY: Record<string, MetricKey> = {
  volume: "volume24h",
  marketCap: "marketCap",
  trades: "trades",
  avgTrade: "avgTrade",
  activeWallets: "activeWallets",
  cardsTraded: "cardsTraded",
};

/**
 * Activity v4 (R7) — the deep-dive flagship, bespoke SVG. One PRIMARY $ metric in
 * the main pane; everything else is its own compact strip below, sharing the
 * x-axis and one crosshair:
 *
 *   • MAIN pane — the primary $ flow (Volume) as line+area on the left axis;
 *     Market Cap MAY overlay on the right axis as a step-line with observation
 *     dots (sparse daily snapshots — real jumps aren't bugs).
 *   • STRIPS — every other active metric gets its own ~64px strip with a private
 *     micro-scale: non-primary $ flows (Avg Trade) as a line, counts (Trades /
 *     Cards Traded / Active Wallets) as bars. Each self-labels (name + last value).
 *
 * Metrics are chosen from a "Metrics ▾" popover (not a wrapping chip row). Modes:
 * Daily | Cumulative (running total — only genuinely additive metrics, Volume &
 * Trades; distinct-counts like Active Wallets / Cards Traded stay DAILY and are
 * tagged, since summing daily-uniques double-counts). Range pills: 24H hourly /
 * 7D / 30D / ALL daily. Mobile caps strips at 2 with "+N more".
 *
 * Every series is REAL, from the metric_snapshots spine; a window with <2 real
 * points (or all-zero) has no history and disables in the menu (QA-2 guard).
 */

export type Timeframe = "24H" | "7D" | "30D" | "ALL";
export const TIMEFRAMES: Timeframe[] = ["24H", "7D", "30D", "ALL"];

export type MetricUnit = "flow" | "count" | "stock";

export type MetricWindow = {
  points: number[];
  ts?: string[];
};
export type ActivityMetric = {
  key: string;
  label: string;
  color: string;
  value: string;
  unit?: MetricUnit;
  /** Coverage/provenance caveat shown under the chart while this metric is active. */
  note?: string;
  series: Record<Timeframe, MetricWindow>;
};

const FLOW_KEYS = new Set(["volume", "avgTrade"]);
const STOCK_KEYS = new Set(["marketCap", "mcap", "marketcap"]);

function unitOf(m: ActivityMetric): MetricUnit {
  if (m.unit) return m.unit;
  if (STOCK_KEYS.has(m.key)) return "stock";
  if (FLOW_KEYS.has(m.key)) return "flow";
  return "count";
}
/** Genuinely additive over days: gross volume ($) and trade COUNT (each sale is a
 *  distinct event). Distinct-entity counts (unique wallets, distinct cards) and
 *  ratios (avg trade) and levels (mcap) are NOT — summing them is wrong (R7-3). */
function isAdditive(m: ActivityMetric): boolean {
  return m.key === "volume" || m.key === "trades";
}
function fmtUnit(unit: MetricUnit, v: number): string {
  return unit === "count" ? formatInt(v) : formatCompactUsd(v);
}

function hasWindow(m: ActivityMetric, tf: Timeframe): boolean {
  const pts = m.series[tf]?.points;
  return !!pts && pts.length >= 2 && pts.some((p) => Number.isFinite(p) && p > 0);
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtAxisDate(ts: string | undefined, tf: Timeframe): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  if (tf === "24H") {
    let h = d.getHours();
    const ap = h < 12 ? "a" : "p";
    h = h % 12 || 12;
    return `${h}${ap}`;
  }
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
function fmtHoverDate(ts: string | undefined, tf: Timeframe): string {
  if (!ts) return "";
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


function axisTicks(lo: number, hi: number, unit: MetricUnit, segs = 3): { f: number; label: string }[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [];
  const out: { f: number; label: string }[] = [];
  for (let k = 0; k <= segs; k++) {
    const f = k / segs;
    out.push({ f, label: fmtUnit(unit, lo + f * (hi - lo)) });
  }
  return out;
}

const RANGE_DESC: Record<Timeframe, string> = {
  "24H": "24h · hourly",
  "7D": "7 days · daily",
  "30D": "30 days · daily",
  ALL: "all history · daily",
};

// Layout constants (px).
const PAD_L = 54;
const PAD_R = 56;
const TOP = 20; // room for the main pane's self-labels
const X_AXIS_H = 22;
const STRIP_HEADER_H = 16;
const STRIP_GAP = 12;
const STRIP_PLOT = 46;

export function IPActivityChart({
  metrics,
  timeframes = TIMEFRAMES,
  defaultTimeframe,
  title = "Activity",
  loading = false,
}: {
  metrics: ActivityMetric[];
  timeframes?: Timeframe[];
  defaultTimeframe?: Timeframe;
  title?: string;
  loading?: boolean;
}) {
  const uid = useId().replace(/[:]/g, "");
  const tf0 = defaultTimeframe ?? timeframes[0] ?? "24H";
  const [tf, setTf] = useState<Timeframe>(tf0);
  const [mode, setMode] = useState<"daily" | "cumulative">("daily");
  const [hover, setHover] = useState<number | null>(null);
  const [showAllStrips, setShowAllStrips] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(820);

  const [wanted, setWanted] = useState<Set<string>>(() => {
    let best = metrics[0]?.key;
    let bestN = -1;
    for (const m of metrics) {
      const n = m.series[tf0]?.points.length ?? 0;
      if (n > bestN) { bestN = n; best = m.key; }
    }
    return new Set(best ? [best] : []);
  });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(Math.max(320, Math.round(e.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isNarrow = w < 560;

  const avail = useMemo(() => metrics.filter((m) => hasWindow(m, tf)).map((m) => m.key), [metrics, tf]);
  const availKey = avail.join(",");

  const active = useMemo(() => {
    const on = [...wanted].filter((k) => avail.includes(k));
    return new Set(on.length ? on : avail.slice(0, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, availKey]);

  function toggle(key: string) {
    setWanted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        const stillOn = avail.filter((k) => k !== key && next.has(k));
        if (stillOn.length >= 1) next.delete(key);
        else return prev;
      } else next.add(key);
      return next;
    });
  }

  const model = useMemo(
    () => buildModel(metrics, active, tf, mode, w, isNarrow, showAllStrips),
    [metrics, active, tf, mode, w, isNarrow, showAllStrips],
  );

  // Legend Δ per metric. Daily = window change (first→last raw). Cumulative =
  // window-total vs prior-half-total for additive metrics; hidden otherwise (R6-4).
  const legendDelta = useMemo(() => {
    const out = new Map<string, number | null>();
    for (const m of metrics) {
      const pts = (m.series[tf]?.points ?? []).filter((p) => Number.isFinite(p));
      if (mode === "cumulative") {
        if (!isAdditive(m) || pts.length < 2) { out.set(m.key, null); continue; }
        const mid = Math.floor(pts.length / 2);
        const prevSum = pts.slice(0, mid).reduce((a, b) => a + b, 0);
        const curSum = pts.slice(mid).reduce((a, b) => a + b, 0);
        out.set(m.key, prevSum > 0 ? ((curSum - prevSum) / prevSum) * 100 : null);
      } else {
        const first = pts.find((p) => p !== 0) ?? pts[0];
        const last = pts[pts.length - 1];
        out.set(m.key, first != null && last != null && first !== 0 ? ((last - first) / first) * 100 : null);
      }
    }
    return out;
  }, [metrics, tf, mode]);

  const cumulativeUseful = metrics.some((m) => active.has(m.key) && isAdditive(m));

  const primaryMetric = metrics.find((m) => active.has(m.key));
  const ariaLabel = primaryMetric
    ? `${title}: ${primaryMetric.label}, ${RANGE_DESC[tf]}, latest ${primaryMetric.value}`
    : `${title} chart`;

  const hoverData = hover != null && !model.empty ? hover : null;

  return (
    <Section
      title={title}
      subtitle={model.empty ? RANGE_DESC[tf] : `${RANGE_DESC[tf]} · one pane per metric`}
      right={
        <>
          <SegToggle
            options={[
              { key: "daily", label: "Daily" },
              { key: "cumulative", label: "Cumulative", disabled: !cumulativeUseful },
            ]}
            value={mode}
            onChange={(k) => setMode(k as "daily" | "cumulative")}
          />
          <SegToggle
            options={timeframes.map((t) => ({ key: t, label: t }))}
            value={tf}
            onChange={(k) => setTf(k as Timeframe)}
          />
        </>
      }
      className="mb-12 font-sans"
    >
      {/* Metric selector — one popover instead of a wrapping chip row (R7-2). */}
      <div className="mb-3 pt-1">
        <MetricsMenu
          metrics={metrics}
          active={active}
          avail={avail}
          tf={tf}
          mode={mode}
          legendDelta={legendDelta}
          onToggle={toggle}
        />
      </div>

      {/* Chart */}
      <div
        ref={wrapRef}
        className="relative"
        style={{ height: model.empty ? 260 : model.totalH + 4 }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          if (model.empty) return;
          const rect = e.currentTarget.getBoundingClientRect();
          setHover(model.bucketAt(e.clientX - rect.left));
        }}
        onTouchStart={(e) => {
          if (model.empty || !e.touches[0]) return;
          const rect = e.currentTarget.getBoundingClientRect();
          setHover(model.bucketAt(e.touches[0].clientX - rect.left));
        }}
        onTouchMove={(e) => {
          if (model.empty || !e.touches[0]) return;
          const rect = e.currentTarget.getBoundingClientRect();
          setHover(model.bucketAt(e.touches[0].clientX - rect.left));
        }}
      >
        {loading ? (
          <ChartSkeleton w={w} />
        ) : model.empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <div className="font-mono text-[13px] text-ink-3">
              {tf === "24H" ? "No activity in this window" : `No ${tf} history yet`}
            </div>
            <div className="max-w-[360px] text-[12px] text-ink-4">
              {tf === "24H"
                ? "Hourly buckets aren't available here — try 7D or 30D."
                : "Recorded daily — it plots as the spine fills; switch metric or range."}
            </div>
          </div>
        ) : (
          <ChartSvg uid={uid} w={w} tf={tf} model={model} hover={hoverData} ariaLabel={ariaLabel} />
        )}

        {/* Desktop floating tooltip. */}
        {!model.empty && hoverData != null && (
          <div
            className="pointer-events-none absolute z-20 hidden min-w-[176px] rounded-lg border border-line-2 bg-bg-2/95 p-2.5 text-[12px] shadow-[0_8px_28px_rgba(0,0,0,0.5)] backdrop-blur sm:block"
            style={{ left: Math.min(w - 192, Math.max(8, model.cx(hoverData) + 12)), top: 8 }}
          >
            <TooltipBody model={model} tf={tf} i={hoverData} />
          </div>
        )}
      </div>

      {/* "+N more" strip toggle (mobile cap). */}
      {!model.empty && model.hiddenStripCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAllStrips((v) => !v)}
          className="mt-2 rounded-md border border-line px-2.5 py-1 text-[11px] text-ink-3 transition-colors hover:text-ink"
        >
          {showAllStrips ? "Show fewer" : `+${model.hiddenStripCount} more metric${model.hiddenStripCount === 1 ? "" : "s"}`}
        </button>
      )}

      {/* Partial-window note. */}
      {!model.empty && model.partial && (
        <div className="mt-2 font-mono text-[10.5px] text-ink-4">
          partial window · {model.n} {tf === "24H" ? "hours" : "days"} of data
        </div>
      )}

      {/* Active-metric coverage notes (e.g. mcap tracked for a subset of platforms). */}
      {metrics
        .filter((m) => active.has(m.key) && m.note)
        .map((m) => (
          <div key={m.key} className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-4">
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: m.color }} />
            {m.note}
          </div>
        ))}

      {/* Mobile summary row (replaces the floating tooltip on touch). */}
      {!model.empty && (
        <div className="mt-3 rounded-lg border border-line bg-bg-2/60 p-3 sm:hidden">
          <TooltipBody model={model} tf={tf} i={hoverData ?? model.n - 1} heading={hoverData == null ? "latest" : undefined} />
        </div>
      )}
    </Section>
  );
}

/* ─────────────────────────── model ─────────────────────────── */

type LineSeries = {
  key: string;
  label: string;
  color: string;
  unit: MetricUnit;
  encoding: "line" | "step";
  vals: number[];
  raw: number[];
  y: (v: number) => number;
  base: number;
  dots: boolean; // observation dots (sparse stock snapshots)
};

type Strip = {
  key: string;
  label: string;
  color: string;
  unit: MetricUnit;
  kind: "line" | "bar";
  vals: number[];
  raw: number[];
  top: number;
  plotTop: number;
  plotBottom: number;
  lo: number;
  hi: number;
  y: (v: number) => number;
  lastVal: number;
  daily: boolean; // shown daily (not cumulated) while in cumulative mode → tag
};

type TipSeries = { key: string; label: string; color: string; unit: MetricUnit; vals: number[]; raw: number[]; daily: boolean };

type ChartModel =
  | { empty: true }
  | {
      empty: false;
      n: number;
      ts: (string | undefined)[];
      band: number;
      cx: (i: number) => number;
      pad: { left: number; right: number };
      totalH: number;
      partial: boolean;
      main: {
        top: number;
        bottom: number;
        leftUnit: MetricUnit | null;
        rightUnit: MetricUnit | null;
        leftDomain: [number, number] | null;
        rightDomain: [number, number] | null;
        series: LineSeries[];
        primaryLabel: string | null;
        primaryColor: string | null;
        overlayLabel: string | null;
        overlayColor: string | null;
        showEndLabels: boolean;
      } | null;
      strips: Strip[];
      hiddenStripCount: number;
      hasStock: boolean;
      tip: TipSeries[];
      bucketAt: (px: number) => number;
      chartBottom: number;
    };

function buildModel(
  metrics: ActivityMetric[],
  active: Set<string>,
  tf: Timeframe,
  mode: "daily" | "cumulative",
  w: number,
  isNarrow: boolean,
  showAllStrips: boolean,
): ChartModel {
  const act = metrics.filter((m) => active.has(m.key) && hasWindow(m, tf));
  if (act.length === 0) return { empty: true };

  const n = Math.max(...act.map((m) => m.series[tf].points.length));
  if (n < 1) return { empty: true };
  const tsSrc =
    act.find((m) => (m.series[tf].ts?.length ?? 0) === n)?.series[tf].ts ??
    act.map((m) => m.series[tf].ts).find((t) => t && t.length) ??
    null;
  const ts: (string | undefined)[] = Array.from({ length: n }, (_, i) => tsSrc?.[i]);

  const align = (arr: number[]): number[] => {
    const out = new Array<number>(n).fill(NaN);
    const off = n - arr.length;
    for (let i = 0; i < arr.length; i++) out[off + i] = arr[i];
    return out;
  };

  type Pre = { m: ActivityMetric; unit: MetricUnit; raw: number[]; vals: number[]; daily: boolean };
  const pre = (m: ActivityMetric): Pre => {
    const unit = unitOf(m);
    const raw = align(m.series[tf].points);
    let vals = raw;
    const additive = isAdditive(m);
    if (mode === "cumulative" && additive) {
      let run = 0;
      vals = raw.map((v) => {
        if (Number.isFinite(v)) run += v;
        return run;
      });
    }
    return { m, unit, raw, vals, daily: mode === "cumulative" && !additive && unit !== "stock" };
  };

  // Order: flows first (Volume preferred), then the rest — used to pick the primary.
  const flows = act.filter((m) => unitOf(m) === "flow").sort((a, b) => (a.key === "volume" ? -1 : 0) - (b.key === "volume" ? -1 : 0));
  const stockM = act.find((m) => unitOf(m) === "stock") ?? null;
  const counts = act.filter((m) => unitOf(m) === "count");

  const plotW = Math.max(10, w - PAD_L - PAD_R);
  const band = plotW / n;
  const cx = (i: number) => PAD_L + (i + 0.5) * band;

  const scaleY = (top: number, h: number, lo: number, hi: number) => (v: number) =>
    top + (1 - (v - lo) / (hi - lo || 1)) * h;

  const domainFlow = (p: Pre): [number, number] => {
    const vs = p.vals.filter((v) => Number.isFinite(v));
    const hi = vs.length ? Math.max(...vs) : 1;
    return [0, hi > 0 ? hi : 1];
  };
  const domainLevel = (p: Pre): [number, number] => {
    const vs = p.vals.filter((v) => Number.isFinite(v));
    if (!vs.length) return [0, 1];
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    const padv = (hi - lo) * 0.1 || Math.abs(hi) * 0.05 || 1;
    return [lo - padv, hi + padv];
  };

  const mainPlotH = isNarrow ? 150 : 194;
  const mainTop = TOP;

  // ── Main pane: ONE primary $ + optional mcap overlay (R7-1). ──
  const primaryFlow = flows[0] ?? null;
  const restFlows = flows.slice(1);
  let main: Extract<ChartModel, { empty: false }>["main"] = null;
  const mainBottom = primaryFlow || stockM ? mainTop + mainPlotH : mainTop;

  if (primaryFlow) {
    const pp = pre(primaryFlow);
    const leftDomain = domainFlow(pp);
    const yLeft = scaleY(mainTop, mainPlotH, leftDomain[0], leftDomain[1]);
    const series: LineSeries[] = [
      { key: pp.m.key, label: pp.m.label, color: pp.m.color, unit: "flow", encoding: "line", vals: pp.vals, raw: pp.raw, y: yLeft, base: yLeft(0), dots: false },
    ];
    let rightUnit: MetricUnit | null = null;
    let rightDomain: [number, number] | null = null;
    let overlayLabel: string | null = null;
    let overlayColor: string | null = null;
    if (stockM) {
      const sp = pre(stockM);
      rightUnit = "stock";
      rightDomain = domainLevel(sp);
      const yRight = scaleY(mainTop, mainPlotH, rightDomain[0], rightDomain[1]);
      series.push({ key: sp.m.key, label: sp.m.label, color: sp.m.color, unit: "stock", encoding: "step", vals: sp.vals, raw: sp.raw, y: yRight, base: mainBottom, dots: true });
      overlayLabel = sp.m.label;
      overlayColor = sp.m.color;
    }
    main = {
      top: mainTop, bottom: mainBottom,
      leftUnit: "flow", rightUnit, leftDomain, rightDomain,
      series, primaryLabel: pp.m.label, primaryColor: pp.m.color, overlayLabel, overlayColor,
      showEndLabels: !rightUnit,
    };
  } else if (stockM) {
    // No flow active → mcap becomes the main-pane primary (step on the left axis).
    const sp = pre(stockM);
    const leftDomain = domainLevel(sp);
    const yLeft = scaleY(mainTop, mainPlotH, leftDomain[0], leftDomain[1]);
    main = {
      top: mainTop, bottom: mainBottom,
      leftUnit: "stock", rightUnit: null, leftDomain, rightDomain: null,
      series: [{ key: sp.m.key, label: sp.m.label, color: sp.m.color, unit: "stock", encoding: "step", vals: sp.vals, raw: sp.raw, y: yLeft, base: mainBottom, dots: true }],
      primaryLabel: sp.m.label, primaryColor: sp.m.color, overlayLabel: null, overlayColor: null,
      showEndLabels: false,
    };
  }

  // ── Strips: non-primary flows (line) + counts (bar). ──
  const stripMetrics = [...restFlows, ...counts];
  const maxStrips = isNarrow && !showAllStrips ? 2 : stripMetrics.length;
  const visible = stripMetrics.slice(0, maxStrips);
  const hiddenStripCount = stripMetrics.length - visible.length;

  const strips: Strip[] = [];
  let cursor = main ? mainBottom + STRIP_GAP : mainTop;
  for (const m of visible) {
    const p = pre(m);
    const kind: "line" | "bar" = p.unit === "count" ? "bar" : "line";
    const [lo, hi] = kind === "bar" ? domainFlow(p) : domainLevel(p);
    const headerTop = cursor;
    const plotTop = headerTop + STRIP_HEADER_H;
    const plotBottom = plotTop + STRIP_PLOT;
    let lastVal = 0;
    for (let i = n - 1; i >= 0; i--) if (Number.isFinite(p.vals[i])) { lastVal = p.vals[i]; break; }
    strips.push({
      key: p.m.key, label: p.m.label, color: p.m.color, unit: p.unit, kind,
      vals: p.vals, raw: p.raw,
      top: headerTop, plotTop, plotBottom, lo, hi,
      y: scaleY(plotTop, STRIP_PLOT, lo, hi),
      lastVal, daily: p.daily,
    });
    cursor = plotBottom + STRIP_GAP;
  }

  const chartBottom = strips.length ? strips[strips.length - 1].plotBottom : mainBottom;
  const totalH = chartBottom + X_AXIS_H;

  // Tooltip — primary + overlay + every strip metric (visible or not).
  const tip: TipSeries[] = [];
  if (main) for (const s of main.series) tip.push({ key: s.key, label: s.label, color: s.color, unit: s.unit, vals: s.vals, raw: s.raw, daily: false });
  for (const m of stripMetrics) {
    const p = pre(m);
    tip.push({ key: p.m.key, label: p.m.label, color: p.m.color, unit: p.unit, vals: p.vals, raw: p.raw, daily: p.daily });
  }

  const bucketAt = (px: number) => {
    const i = Math.floor((px - PAD_L) / band);
    return Math.max(0, Math.min(n - 1, i));
  };

  const expected = tf === "7D" ? 7 : tf === "30D" ? 30 : tf === "24H" ? 24 : n;
  const partial = (tf === "7D" || tf === "30D") && n < expected;

  return {
    empty: false, n, ts, band, cx, pad: { left: PAD_L, right: PAD_R },
    totalH, partial, main, strips, hiddenStripCount, hasStock: !!stockM,
    tip, bucketAt, chartBottom,
  };
}

/* ─────────────────────────── SVG ─────────────────────────── */

function ChartSvg({
  uid,
  w,
  tf,
  model,
  hover,
  ariaLabel,
}: {
  uid: string;
  w: number;
  tf: Timeframe;
  model: Extract<ChartModel, { empty: false }>;
  hover: number | null;
  ariaLabel: string;
}) {
  const { band, cx, n, main, strips, totalH, chartBottom, pad } = model;
  const barW = Math.max(1, Math.min(band * 0.62, 22));

  const xTicks = (() => {
    const count = Math.min(5, n);
    const out: { i: number; lab: string }[] = [];
    for (let k = 0; k < count; k++) {
      const i = count <= 1 ? 0 : Math.round((k / (count - 1)) * (n - 1));
      out.push({ i, lab: fmtAxisDate(model.ts[i], tf) });
    }
    return out;
  })();

  const endLabels = (() => {
    if (!main || !main.showEndLabels) return [];
    const items = main.series
      .map((s) => {
        let lastI = -1;
        for (let i = n - 1; i >= 0; i--) if (Number.isFinite(s.vals[i])) { lastI = i; break; }
        if (lastI < 0) return null;
        return { key: s.key, color: s.color, y: s.y(s.vals[lastI]), text: fmtUnit(s.unit, s.vals[lastI]) };
      })
      .filter((x): x is { key: string; color: string; y: number; text: string } => !!x)
      .sort((a, b) => a.y - b.y);
    const GAP = 13;
    for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < GAP) items[i].y = items[i - 1].y + GAP;
    const overflow = items.length ? items[items.length - 1].y - main.bottom : 0;
    if (overflow > 0) for (const it of items) it.y -= overflow;
    for (const it of items) it.y = Math.max(main.top + 4, it.y);
    return items;
  })();

  return (
    <svg width={w} height={totalH} className="block" role="img" aria-label={ariaLabel}>
      <defs>
        {main?.series
          .filter((s) => s.encoding === "line")
          .map((s) => (
            <linearGradient key={s.key} id={`act-${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.26" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        {strips
          .filter((s) => s.kind === "line")
          .map((s) => (
            <linearGradient key={s.key} id={`str-${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.2" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
      </defs>

      {/* ── Main pane ── */}
      {main && (
        <g role="group" aria-label={`${main.primaryLabel ?? "Value"} — ${RANGE_DESC[tf]}`}>
          {/* self-labels */}
          {main.primaryLabel && (
            <text x={pad.left} y={main.top - 7} fontSize={11} fontWeight={600} fill={main.primaryColor ?? "var(--color-ink-2)"} fontFamily="var(--font-inter), sans-serif">
              {main.primaryLabel}
            </text>
          )}
          {main.overlayLabel && (
            <text x={w - pad.right} y={main.top - 7} textAnchor="end" fontSize={11} fontWeight={600} fill={main.overlayColor ?? "var(--color-ink-2)"} fontFamily="var(--font-inter), sans-serif">
              {main.overlayLabel}
            </text>
          )}

          {/* gridlines + left axis ticks */}
          {main.leftDomain &&
            axisTicks(main.leftDomain[0], main.leftDomain[1], main.leftUnit!).map((t, i) => {
              const yy = main.top + (main.bottom - main.top) * (1 - t.f);
              return (
                <g key={`l${i}`}>
                  <line x1={pad.left} x2={w - pad.right} y1={yy} y2={yy} stroke="var(--color-line)" strokeDasharray={t.f === 0 ? undefined : "2 5"} />
                  <text x={pad.left - 8} y={yy + 3} textAnchor="end" fontSize={10.5} fill="var(--color-ink-4)" fontFamily="var(--font-jetbrains-mono), monospace">
                    {t.label}
                  </text>
                </g>
              );
            })}
          {main.rightDomain && main.rightUnit &&
            axisTicks(main.rightDomain[0], main.rightDomain[1], main.rightUnit).map((t, i) => {
              const yy = main.top + (main.bottom - main.top) * (1 - t.f);
              return (
                <text key={`r${i}`} x={w - pad.right + 8} y={yy + 3} textAnchor="start" fontSize={10.5} fill="var(--color-ink-4)" fontFamily="var(--font-jetbrains-mono), monospace">
                  {t.label}
                </text>
              );
            })}

          {/* flow lines + area */}
          {main.series
            .filter((s) => s.encoding === "line")
            .map((s) => {
              const pts: Array<[number, number]> = [];
              for (let i = 0; i < n; i++) if (Number.isFinite(s.vals[i])) pts.push([cx(i), s.y(s.vals[i])]);
              if (!pts.length) return null;
              const line = monotonePath(pts);
              const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${s.base.toFixed(1)} L${pts[0][0].toFixed(1)} ${s.base.toFixed(1)} Z`;
              return (
                <g key={s.key}>
                  <path d={area} fill={`url(#act-${uid}-${s.key})`} />
                  <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                </g>
              );
            })}

          {/* stock step-line + observation dots */}
          {main.series
            .filter((s) => s.encoding === "step")
            .map((s) => {
              let d = "";
              let prevY: number | null = null;
              const dots: Array<[number, number]> = [];
              for (let i = 0; i < n; i++) {
                if (!Number.isFinite(s.vals[i])) continue;
                const x = cx(i);
                const y = s.y(s.vals[i]);
                if (prevY == null) d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
                else d += ` L${x.toFixed(1)} ${prevY.toFixed(1)} L${x.toFixed(1)} ${y.toFixed(1)}`;
                prevY = y;
                dots.push([x, y]);
              }
              return (
                <g key={s.key}>
                  <path d={d} fill="none" stroke={s.color} strokeWidth={1.75} strokeLinejoin="round" />
                  {s.dots && dots.map(([x, y], i) => (
                    <circle key={i} cx={x} cy={y} r={2} fill="var(--color-bg-1)" stroke={s.color} strokeWidth={1.25} />
                  ))}
                </g>
              );
            })}

          {endLabels.map((e) => (
            <text key={e.key} x={w - pad.right + 5} y={e.y + 3} fontSize={10.5} fontWeight={600} fill={e.color} fontFamily="var(--font-jetbrains-mono), monospace">
              {e.text}
            </text>
          ))}
        </g>
      )}

      {/* ── Strips ── */}
      {strips.map((p) => (
        <g key={p.key} role="group" aria-label={`${p.label} — latest ${fmtUnit(p.unit, p.lastVal)}`}>
          {/* header: swatch + name (left), last value (right) */}
          <rect x={pad.left} y={p.top + 2} width={9} height={9} rx={2} fill={p.color} opacity={p.daily ? 0.5 : 1} />
          <text x={pad.left + 14} y={p.top + 10} fontSize={11} fontWeight={600} fill={p.daily ? "var(--color-ink-3)" : "var(--color-ink-2)"} fontFamily="var(--font-inter), sans-serif">
            {p.label}
            {p.daily ? "  · daily" : ""}
          </text>
          <text x={w - pad.right} y={p.top + 10} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--color-ink)" fontFamily="var(--font-jetbrains-mono), monospace">
            {fmtUnit(p.unit, p.lastVal)}
          </text>
          {/* frame gridlines */}
          <line x1={pad.left} x2={w - pad.right} y1={p.plotTop} y2={p.plotTop} stroke="var(--color-line)" strokeDasharray="2 5" />
          <line x1={pad.left} x2={w - pad.right} y1={p.plotBottom} y2={p.plotBottom} stroke="var(--color-line)" />

          {p.kind === "bar"
            ? p.vals.map((v, i) => {
                if (!Number.isFinite(v)) return null;
                const yTop0 = p.y(v);
                let yTop = yTop0;
                let h = p.plotBottom - yTop0;
                if (v > 0 && h < 2) { h = 2; yTop = p.plotBottom - 2; }
                if (h <= 0) return null;
                const isHover = hover === i;
                return (
                  <rect key={i} x={cx(i) - barW / 2} y={yTop} width={barW} height={h} rx={1} fill={p.color} fillOpacity={hover == null ? 0.82 : isHover ? 1 : 0.4} />
                );
              })
            : (() => {
                const pts: Array<[number, number]> = [];
                for (let i = 0; i < n; i++) if (Number.isFinite(p.vals[i])) pts.push([cx(i), p.y(p.vals[i])]);
                if (!pts.length) return null;
                const line = monotonePath(pts);
                const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${p.plotBottom.toFixed(1)} L${pts[0][0].toFixed(1)} ${p.plotBottom.toFixed(1)} Z`;
                return (
                  <g>
                    <path d={area} fill={`url(#str-${uid}-${p.key})`} />
                    <path d={line} fill="none" stroke={p.color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
                  </g>
                );
              })()}
        </g>
      ))}

      {/* ── One crosshair through all panes ── */}
      {hover != null && (
        <>
          <line x1={cx(hover)} x2={cx(hover)} y1={main ? main.top : strips[0]?.plotTop ?? 0} y2={chartBottom} stroke="var(--color-line-2)" />
          {main?.series.map((s) =>
            Number.isFinite(s.vals[hover]) ? (
              <circle key={s.key} cx={cx(hover)} cy={s.y(s.vals[hover])} r={3} fill={s.color} stroke="var(--color-bg-1)" strokeWidth={1.5} />
            ) : null,
          )}
          {strips.filter((p) => p.kind === "line").map((p) =>
            Number.isFinite(p.vals[hover]) ? (
              <circle key={p.key} cx={cx(hover)} cy={p.y(p.vals[hover])} r={2.5} fill={p.color} stroke="var(--color-bg-1)" strokeWidth={1.5} />
            ) : null,
          )}
        </>
      )}

      {/* shared x-axis date ticks */}
      {xTicks.map((t) => (
        <text
          key={t.i}
          x={cx(t.i)}
          y={chartBottom + 15}
          fontSize={10.5}
          fill="var(--color-ink-4)"
          textAnchor={t.i === 0 ? "start" : t.i === n - 1 ? "end" : "middle"}
          fontFamily="var(--font-jetbrains-mono), monospace"
        >
          {t.lab}
        </text>
      ))}
    </svg>
  );
}

/* ─────────────────────────── tooltip ─────────────────────────── */

function TooltipBody({
  model,
  tf,
  i,
  heading,
}: {
  model: Extract<ChartModel, { empty: false }>;
  tf: Timeframe;
  i: number;
  heading?: string;
}) {
  return (
    <>
      <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
        {heading ?? fmtHoverDate(model.ts[i], tf)}
      </div>
      <div className="flex flex-col gap-0.5">
        {model.tip.map((s) => {
          const v = s.vals[i];
          let prev: number | null = null;
          for (let k = i - 1; k >= 0; k--) if (Number.isFinite(s.vals[k])) { prev = s.vals[k]; break; }
          const delta = prev != null && Number.isFinite(v) ? v - prev : null;
          return (
            <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
              <span className="flex items-center gap-1.5 text-ink-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                {s.label}
                {s.daily && <span className="text-[10px] text-ink-4">daily</span>}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono font-semibold tabular text-ink">
                  {Number.isFinite(v) ? fmtUnit(s.unit, v) : "—"}
                </span>
                {delta != null && Number.isFinite(delta) && delta !== 0 && (
                  <span className={`font-mono text-[10.5px] tabular ${delta > 0 ? "text-green" : "text-red"}`}>
                    {delta > 0 ? "▲" : "▼"}
                    {fmtUnit(s.unit, Math.abs(delta))}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {model.hasStock && (
        <div className="mt-1.5 border-t border-line/60 pt-1.5 text-[10px] leading-snug text-ink-4">
          ◦ Market cap = sparse daily snapshots; steps mark real changes.
        </div>
      )}
    </>
  );
}

/* ─────────────────────────── Metrics menu ─────────────────────────── */

function MetricsMenu({
  metrics,
  active,
  avail,
  tf,
  mode,
  legendDelta,
  onToggle,
}: {
  metrics: ActivityMetric[];
  active: Set<string>;
  avail: string[];
  tf: Timeframe;
  mode: "daily" | "cumulative";
  legendDelta: Map<string, number | null>;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const activeCount = metrics.filter((m) => active.has(m.key)).length;
  const activeLabels = metrics.filter((m) => active.has(m.key)).map((m) => m.label);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-[10px] border border-line-2 bg-bg-2 px-3 py-1.5 text-[12.5px] transition-colors hover:border-ink-4"
      >
        <span className="font-medium text-ink">Metrics</span>
        <span className="font-mono text-[11px] tabular text-ink-3">{activeCount}</span>
        <svg width="9" height="9" viewBox="0 0 10 10" className={`text-ink-4 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M2 3.5 L5 6.5 L8 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
        </svg>
      </button>
      {!open && (
        <span className="ml-2 hidden text-[11.5px] text-ink-4 sm:inline">{activeLabels.join(" · ")}</span>
      )}
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-[300px] rounded-xl border border-line-2 bg-bg-2 p-1.5 shadow-[0_18px_44px_rgba(0,0,0,0.55)]">
          {metrics.map((m) => {
            const on = active.has(m.key);
            const canShow = avail.includes(m.key);
            const unit = unitOf(m);
            const dp = legendDelta.get(m.key);
            const gk = GLOSSARY_BY_KEY[m.key];
            const daily = mode === "cumulative" && !isAdditive(m) && unit !== "stock";
            return (
              <div
                key={m.key}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 ${canShow ? "hover:bg-bg-3" : "opacity-45"}`}
              >
                <button
                  type="button"
                  disabled={!canShow}
                  onClick={() => canShow && onToggle(m.key)}
                  aria-pressed={on}
                  aria-label={`${m.label} — toggle`}
                  className={`flex min-w-0 flex-1 items-center gap-2 text-left ${canShow ? "cursor-pointer" : "cursor-not-allowed"}`}
                >
                  <span
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${on && canShow ? "border-yellow bg-yellow text-black" : "border-line-2 text-transparent"}`}
                  >
                    <svg width="9" height="9" viewBox="0 0 10 10"><path d="M2 5 L4 7.5 L8 2.5" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>
                  </span>
                  <EncodingSwatch unit={unit} color={m.color} on={on && canShow} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
                    {m.label}
                    {daily && <span className="ml-1 text-[10px] font-normal text-ink-4">daily</span>}
                  </span>
                  <span className="font-mono text-[12px] font-semibold tabular text-ink-2">{m.value}</span>
                  {canShow ? (
                    dp != null && Number.isFinite(dp) ? (
                      <span className={`w-[46px] text-right font-mono text-[11px] font-semibold tabular ${dp > 0 ? "text-green" : dp < 0 ? "text-red" : "text-ink-4"}`}>
                        {dp > 0 ? "+" : ""}
                        {dp.toFixed(dp <= -100 || dp >= 100 ? 0 : 1)}%
                      </span>
                    ) : (
                      <span className="w-[46px]" />
                    )
                  ) : (
                    <span className="w-[46px] text-right font-mono text-[9px] uppercase tracking-[0.06em] text-ink-4">no {tf}</span>
                  )}
                </button>
                {gk && <MetricInfo metric={gk} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── chrome ─────────────────────────── */

function EncodingSwatch({ unit, color, on }: { unit: MetricUnit; color: string; on: boolean }) {
  const c = on ? color : "var(--color-ink-4)";
  if (unit === "count") {
    return (
      <span className="flex items-end gap-[2px]" style={{ height: 10 }} aria-hidden>
        <span style={{ width: 2, height: 5, background: c, borderRadius: 1 }} />
        <span style={{ width: 2, height: 9, background: c, borderRadius: 1 }} />
        <span style={{ width: 2, height: 7, background: c, borderRadius: 1 }} />
      </span>
    );
  }
  if (unit === "stock") {
    return (
      <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden>
        <path d="M1 8 H5 V4 H9 V6 H13" fill="none" stroke={c} strokeWidth="1.5" />
      </svg>
    );
  }
  return <span className="inline-block h-[2px] w-3.5 rounded" style={{ background: c }} aria-hidden />;
}

function SegToggle({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string; disabled?: boolean }[];
  value: string;
  onChange: (k: string) => void;
}) {
  return (
    <div className="flex gap-0.5 rounded-[10px] border border-line bg-bg-2 p-[3px]">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={o.disabled}
          onClick={() => !o.disabled && onChange(o.key)}
          aria-pressed={value === o.key}
          className={`rounded-md px-3 py-1.5 font-mono text-[12px] transition-colors ${
            o.disabled
              ? "cursor-not-allowed text-ink-4/50"
              : value === o.key
                ? "bg-bg-3 text-yellow"
                : "text-ink-3 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ChartSkeleton({ w }: { w: number }) {
  const height = 260;
  const plotH = 180;
  const bars = 14;
  const band = Math.max(10, w - PAD_L - PAD_R) / bars;
  return (
    <svg width={w} height={height} className="block motion-safe:animate-pulse" aria-hidden>
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1={PAD_L} x2={w - PAD_R} y1={TOP + plotH * (1 - f)} y2={TOP + plotH * (1 - f)} stroke="var(--color-line)" strokeDasharray={f === 0 ? undefined : "2 5"} />
      ))}
      {Array.from({ length: bars }, (_, i) => {
        const h = plotH * (0.25 + ((i * 37) % 60) / 100);
        return <rect key={i} x={PAD_L + i * band + band * 0.2} y={TOP + plotH - h} width={band * 0.6} height={h} rx={1} fill="var(--color-line)" opacity={0.5} />;
      })}
    </svg>
  );
}
