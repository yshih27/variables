"use client";

/**
 * Index Studio — a plug-and-play market chart (replaces the static composite chart
 * on /ips). Add any metric (a Varible index, a benchmark, or a raw spine series
 * like holders), drag any window, and rebase everything to a common 100 baseline so
 * mixed units overlay meaningfully. Client component: the catalog + series are
 * fetched at runtime from the same-origin /api/internal/chart/{index,benchmarks,
 * series} routes (key-free twins of /api/v1). Whole state lives in the URL hash.
 *
 * Matches docs/prototypes/index-studio.html — mode/range/CSV/PNG/Share/Embed
 * controls, removable chips, add-metric picker, draggable brush + wheel-zoom, and a
 * synced crosshair tooltip — wired to real data on Varible's dark/yellow/mono system.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SectionShell } from "./Section";
import { monotonePath } from "@/lib/chart/path";
import { indexRegistry } from "@/lib/indices/naming";
import { IP_CATALOG, OTHER_IP } from "@/lib/data/ipCatalog";
import { PLATFORM_SOURCES } from "@/lib/data/sources";
import { formatCompactUsd, formatCompactNumber } from "@/lib/format";

type Unit = "index" | "usd" | "count";
type SeriesPoint = { ts: string; value: number };
type CatalogItem = {
  id: string;
  ticker: string;
  name: string;
  group: string;
  unit: Unit;
  color: string;
  dash?: boolean;
};
type Mode = "rebase" | "abs";

const DAY = 86_400_000;
const GROUP_ORDER = ["Indices", "Benchmarks", "Market cap", "Volume", "Activity"];
const RANGES: { key: string; days: number | null; label: string }[] = [
  { key: "30", days: 30, label: "30D" },
  { key: "90", days: 90, label: "90D" },
  { key: "180", days: 180, label: "6M" },
  { key: "all", days: null, label: "ALL" },
];
const DEFAULT_ACTIVE = ["idx:market:total", "bench:BTC", "bench:SP500"];

// Line colors. V-MKT is the brand yellow; benchmarks keep recognizable brand hues;
// everything else draws from a distinct palette assigned by catalog order.
const BENCH_COLOR: Record<string, string> = {
  BTC: "#e8993a",
  ETH: "#8b93c9",
  SP500: "#9aa0ab",
  NASDAQ: "#6fb0c9",
  GOLD: "#c8a951",
};
const PALETTE = [
  "#5fa3ff", "#2bd6a0", "#ff6b9d", "#a18cff", "#4ade80", "#22d3ee",
  "#fb7185", "#c084fc", "#38bdf8", "#fbbf24", "#f97316", "#a3e635", "#e879f9", "#7dd3fc",
];

const IP_NAME: Record<string, string> = Object.fromEntries(
  [...IP_CATALOG, OTHER_IP].map((ip) => [ip.key, ip.name]),
);
const PLATFORM_NAME: Record<string, string> = Object.fromEntries(
  PLATFORM_SOURCES.map((p) => [p.key, p.name]),
);

/** IP short code (PKM, OP…) derived from the naming SSOT ticker (strip the V- prefix). */
function ipShort(key: string): string {
  const reg = indexRegistry().find((r) => r.entity === "ip" && r.key === key);
  return (reg?.ticker ?? key).replace(/^V-/, "");
}
function platShort(key: string): string {
  return key.split("-").map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 3) || key.slice(0, 3).toUpperCase();
}
function titleize(key: string): string {
  return key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
/** Lowercase + strip diacritics so a search for "pokemon" matches "Pokémon". */
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

// ── fetch ─────────────────────────────────────────────────────────────────────
async function fetchChart(
  endpoint: "index" | "benchmarks" | "series",
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/internal/chart/${endpoint}?${qs}`);
  if (!res.ok) throw new Error(`chart ${endpoint} ${res.status}`);
  const j = (await res.json()) as { ok: boolean; data?: Record<string, unknown>; error?: string };
  if (!j.ok || !j.data) throw new Error(j.error ?? "chart fetch failed");
  return j.data;
}

// The spine families the picker offers — each bulk read returns ONLY populated
// keys (the "don't offer empty series" filter) AND prefetches their data.
const SPINE_FAMILIES: { entity: string; metric: string; group: string; unit: Unit; short: string; label: string }[] = [
  { entity: "market", metric: "mcap_usd", group: "Market cap", unit: "usd", short: "MCAP", label: "Total Market Cap" },
  { entity: "ip", metric: "mcap_usd", group: "Market cap", unit: "usd", short: "MC", label: "Market Cap" },
  { entity: "platform", metric: "volume_usd", group: "Volume", unit: "usd", short: "VOL", label: "Marketplace Vol" },
  { entity: "platform", metric: "gacha_volume_usd", group: "Volume", unit: "usd", short: "GAC", label: "Gacha Vol" },
  { entity: "ip", metric: "cards_traded", group: "Activity", unit: "count", short: "CRD", label: "Cards Traded" },
  { entity: "ip", metric: "trades", group: "Activity", unit: "count", short: "TRD", label: "Trades" },
  { entity: "ip", metric: "holders", group: "Activity", unit: "count", short: "HLD", label: "Holders" },
];

/** Build the picker catalog from real availability + prefetch every series' data. */
async function buildCatalog(): Promise<{ items: CatalogItem[]; data: Map<string, SeriesPoint[]> }> {
  const data = new Map<string, SeriesPoint[]>();
  const items: CatalogItem[] = [];
  let paletteI = 0;
  const nextColor = () => PALETTE[paletteI++ % PALETTE.length];

  // 1. Indices (constant-quality price index) — market + the two categories.
  const idxProbes = await Promise.all(
    ([
      ["market", "total"],
      ["category", "tcg"],
      ["category", "sports"],
    ] as const).map(async ([entity, key]) => {
      try {
        const d = await fetchChart("index", { entity, key, kind: "price", from: "2000-01-01", freq: "weekly" });
        return { entity, key, d };
      } catch {
        return null;
      }
    }),
  );
  for (const p of idxProbes) {
    if (!p) continue;
    const points = (p.d.points as SeriesPoint[]) ?? [];
    if (points.length < 2) continue;
    const id = `idx:${p.entity}:${p.key}`;
    data.set(id, points);
    items.push({
      id,
      ticker: (p.d.ticker as string) ?? "V-?",
      name: (p.d.indexName as string) ?? "Index",
      group: "Indices",
      unit: "index",
      color: p.entity === "market" ? "#bfef01" : nextColor(),
    });
  }

  // 2. Benchmarks — one call, keep the populated ones.
  try {
    const bd = await fetchChart("benchmarks", { from: "2000-01-01", freq: "daily" });
    const series = (bd.series as Record<string, SeriesPoint[]>) ?? {};
    for (const sym of ["BTC", "ETH", "SP500", "NASDAQ", "GOLD"]) {
      const points = series[sym] ?? [];
      if (points.length < 2) continue;
      const id = `bench:${sym}`;
      data.set(id, points);
      items.push({
        id,
        ticker: sym === "SP500" ? "S&P 500" : sym === "NASDAQ" ? "NASDAQ" : sym,
        name: { BTC: "Bitcoin", ETH: "Ethereum", SP500: "S&P 500", NASDAQ: "Nasdaq Composite", GOLD: "Gold" }[sym] ?? sym,
        group: "Benchmarks",
        unit: "index",
        color: BENCH_COLOR[sym] ?? nextColor(),
        dash: true,
      });
    }
  } catch {
    /* benchmarks unavailable → skip the group */
  }

  // 3. Raw spine families — bulk reads return only keys with data in-window.
  const fam = await Promise.all(
    SPINE_FAMILIES.map(async (f) => {
      try {
        const d = await fetchChart("series", { entity: f.entity, metric: f.metric, from: "2000-01-01" });
        return { f, series: (d.series as Record<string, SeriesPoint[]>) ?? {} };
      } catch {
        return { f, series: {} as Record<string, SeriesPoint[]> };
      }
    }),
  );
  for (const { f, series } of fam) {
    const keys = Object.keys(series).sort((a, b) => {
      const la = series[a]?.at(-1)?.value ?? 0;
      const lb = series[b]?.at(-1)?.value ?? 0;
      return lb - la; // biggest latest value first
    });
    for (const key of keys) {
      const points = series[key] ?? [];
      if (points.length < 2) continue;
      const isMarket = f.entity === "market";
      const shortEntity =
        f.entity === "ip" ? ipShort(key) : f.entity === "platform" ? platShort(key) : "";
      const entityName =
        f.entity === "ip" ? IP_NAME[key] ?? titleize(key) : f.entity === "platform" ? PLATFORM_NAME[key] ?? titleize(key) : "";
      const id = `sp:${f.entity}:${key}:${f.metric}`;
      data.set(id, points);
      items.push({
        id,
        ticker: isMarket ? f.short : `${shortEntity}·${f.short}`,
        name: isMarket ? f.label : `${entityName} ${f.label}`,
        group: f.group,
        unit: f.unit,
        color: nextColor(),
      });
    }
  }

  return { items, data };
}

// ── formatting ──────────────────────────────────────────────────────────────
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (ms: number) => `${MON[new Date(ms).getUTCMonth()]} ${new Date(ms).getUTCDate()}`;
const fmtDateY = (ms: number) => `${fmtDate(ms)}, ${new Date(ms).getUTCFullYear()}`;
function fmtVal(unit: Unit, v: number): string {
  if (!Number.isFinite(v)) return "—";
  return unit === "usd" ? formatCompactUsd(v) : unit === "count" ? formatCompactNumber(v) : v.toFixed(1);
}

// ── URL hash state ────────────────────────────────────────────────────────────
type UrlState = { active: string[]; mode: Mode; win: [number, number] | null };
function parseHash(): Partial<UrlState> {
  if (typeof window === "undefined") return {};
  try {
    const h = new URLSearchParams(window.location.hash.slice(1));
    const out: Partial<UrlState> = {};
    const m = h.get("m");
    if (m) out.active = m.split(",").filter(Boolean);
    const s = h.get("s");
    if (s === "abs" || s === "rebase") out.mode = s;
    const w = h.get("w");
    if (w) {
      const [a, b] = w.split("_").map((x) => Date.parse(x));
      if (Number.isFinite(a) && Number.isFinite(b) && a < b) out.win = [a, b];
    }
    return out;
  } catch {
    return {};
  }
}

// ── geometry ──────────────────────────────────────────────────────────────────
const PAD = { t: 18, r: 60, b: 24, l: 12 };
const PH = 360;
const BH = 54;

export function IndexStudio() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [seriesData, setSeriesData] = useState<Map<string, SeriesPoint[]>>(() => new Map());
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const initial = useMemo(() => parseHash(), []);
  const [active, setActive] = useState<string[]>(initial.active ?? DEFAULT_ACTIVE);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [mode, setMode] = useState<Mode>(initial.mode ?? "rebase");
  const [win, setWin] = useState<[number, number] | null>(initial.win ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [embedOpen, setEmbedOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<SVGSVGElement>(null);
  const [w, setW] = useState(920);

  // Fetch catalog + all series once.
  useEffect(() => {
    let alive = true;
    buildCatalog()
      .then(({ items, data }) => {
        if (!alive) return;
        setSeriesData(data);
        setCatalog(items);
        setLoaded(true);
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, []);

  // Responsive width.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => {
      for (const e of es) setW(Math.max(360, Math.round(e.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byId = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);
  // Only keep active ids that exist in the catalog once it loads.
  const activeValid = useMemo(
    () => (loaded ? active.filter((id) => byId.has(id)) : active),
    [active, byId, loaded],
  );

  const toastTimer = useRef<number | null>(null);
  const toastMsg = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
  }, []);

  // Write URL hash on state change (after load).
  useEffect(() => {
    if (!loaded) return;
    const p = new URLSearchParams();
    p.set("m", activeValid.join(","));
    p.set("s", mode);
    if (win) p.set("w", `${new Date(win[0]).toISOString().slice(0, 10)}_${new Date(win[1]).toISOString().slice(0, 10)}`);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${p.toString()}`);
  }, [activeValid, mode, win, loaded]);

  // Full data range across active series → the brush extent + default window.
  const fullRange = useMemo<[number, number] | null>(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const id of activeValid) {
      const pts = seriesData.get(id);
      if (!pts?.length) continue;
      const a = Date.parse(pts[0].ts);
      const b = Date.parse(pts[pts.length - 1].ts);
      if (Number.isFinite(a)) lo = Math.min(lo, a);
      if (Number.isFinite(b)) hi = Math.max(hi, b);
    }
    return Number.isFinite(lo) && Number.isFinite(hi) && lo < hi ? [lo, hi] : null;
  }, [activeValid, seriesData]);

  // Effective window: explicit `win`, else the default range (last 90d), clamped.
  const window0 = useMemo<[number, number] | null>(() => {
    if (!fullRange) return null;
    const [lo, hi] = fullRange;
    if (win) return [Math.max(lo, win[0]), Math.min(hi, win[1])];
    return [Math.max(lo, hi - 90 * DAY), hi];
  }, [fullRange, win]);

  const visible = useMemo(
    () => activeValid.filter((id) => !hidden.has(id) && (seriesData.get(id)?.length ?? 0) >= 2),
    [activeValid, hidden, seriesData],
  );

  // Project every visible series onto the current window: rebase to 100 at the
  // first in-window point (or raw in absolute mode). Returns per-series in-window
  // points {ms, v} plus the y-domain and the primary (first visible).
  const model = useMemo(() => {
    if (!window0 || !visible.length) return null;
    const [s, e] = window0;
    const span = e - s || 1;
    const plotW = w - PAD.l - PAD.r;
    const plotH = PH - PAD.t - PAD.b;

    const cols = visible.map((id) => {
      const item = byId.get(id)!;
      const raw = seriesData.get(id) ?? [];
      const inWin = raw.filter((p) => {
        const t = Date.parse(p.ts);
        return t >= s && t <= e && Number.isFinite(p.value);
      });
      let base = 1;
      if (mode === "rebase") {
        const first = inWin.find((p) => p.value > 0);
        base = first ? first.value : NaN;
      }
      const pts = inWin.map((p) => ({
        ms: Date.parse(p.ts),
        v: mode === "rebase" ? (Number.isFinite(base) ? (p.value / base) * 100 : NaN) : p.value,
        raw: p.value,
      }));
      return { id, item, pts };
    });

    let lo = Infinity;
    let hi = -Infinity;
    for (const c of cols) for (const p of c.pts) if (Number.isFinite(p.v)) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
    if (!Number.isFinite(lo)) { lo = 0; hi = 100; }
    if (mode === "rebase") { lo = Math.min(lo, 100); hi = Math.max(hi, 100); }
    const padv = (hi - lo) * 0.1 || 1;
    lo -= padv;
    hi += padv;

    const X = (ms: number) => PAD.l + ((ms - s) / span) * plotW;
    const Y = (v: number) => PAD.t + plotH - ((v - lo) / (hi - lo || 1)) * plotH;

    const lines = cols.map((c) => ({
      ...c,
      path: monotonePath(c.pts.filter((p) => Number.isFinite(p.v)).map((p) => [X(p.ms), Y(p.v)] as [number, number])),
    }));

    // Union of in-window dates (sorted) for crosshair snapping + x-ticks.
    const tsSet = new Set<number>();
    for (const c of cols) for (const p of c.pts) tsSet.add(p.ms);
    const unionTs = [...tsSet].sort((a, b) => a - b);

    return { s, e, span, plotW, plotH, lo, hi, X, Y, lines, unionTs, primary: lines[0] ?? null };
  }, [window0, visible, byId, mode, w, seriesData]);

  // ── interactions ──────────────────────────────────────────────────────────
  const addMetric = (id: string) => {
    setActive((a) => (a.includes(id) ? a : [...a, id]));
    setPickerOpen(false);
  };
  const removeMetric = (id: string) => {
    setActive((a) => a.filter((x) => x !== id));
    setHidden((h) => {
      const n = new Set(h);
      n.delete(id);
      return n;
    });
  };
  const toggleMetric = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id);
      else if (visible.length > 1 || !visible.includes(id)) n.add(id); // keep ≥1 line
      return n;
    });
  const setRange = (r: (typeof RANGES)[number]) => {
    if (!fullRange) return;
    const [lo, hi] = fullRange;
    setWin(r.days == null ? [lo, hi] : [Math.max(lo, hi - r.days * DAY), hi]);
  };
  const activeRangeKey = useMemo(() => {
    if (!fullRange || !window0) return null;
    if (window0[1] < fullRange[1] - DAY) return null; // window doesn't end at "now"
    if (window0[0] <= fullRange[0] + DAY) return "all";
    const days = Math.round((window0[1] - window0[0]) / DAY);
    return RANGES.find((r) => r.days != null && Math.abs(r.days - days) <= 2)?.key ?? null;
  }, [fullRange, window0]);

  // Wheel zoom around the cursor.
  const onWheel = (ev: React.WheelEvent) => {
    if (!model || !fullRange) return;
    ev.preventDefault();
    const rect = plotRef.current!.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    const [s, e] = window0!;
    const span = e - s;
    const focus = s + frac * span;
    const factor = ev.deltaY < 0 ? 0.82 : 1.2;
    let ns = span * factor;
    ns = Math.max(3 * DAY, Math.min(fullRange[1] - fullRange[0], ns));
    let na = focus - frac * ns;
    let nb = na + ns;
    if (na < fullRange[0]) { na = fullRange[0]; nb = na + ns; }
    if (nb > fullRange[1]) { nb = fullRange[1]; na = nb - ns; }
    setWin([na, nb]);
  };

  // Crosshair.
  const onMove = (ev: React.MouseEvent) => {
    if (!model) return;
    const rect = plotRef.current!.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left - (PAD.l / w) * rect.width) / ((model.plotW / w) * rect.width)));
    setHoverMs(model.s + frac * model.span);
  };

  // Nearest union date to the hovered ms (snap the crosshair to real data).
  const hoverIdx = useMemo(() => {
    if (hoverMs == null || !model?.unionTs.length) return null;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < model.unionTs.length; i++) {
      const d = Math.abs(model.unionTs[i] - hoverMs);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }, [hoverMs, model]);
  const hoverTs = hoverIdx != null && model ? model.unionTs[hoverIdx] : null;

  /** Value of a series at (or nearest before) a given ms. */
  const valAt = (pts: { ms: number; v: number }[], ms: number): number | null => {
    let best: number | null = null;
    let bd = Infinity;
    for (const p of pts) {
      const d = Math.abs(p.ms - ms);
      if (d < bd && Number.isFinite(p.v)) { bd = d; best = p.v; }
    }
    return bd <= 4 * DAY ? best : null; // only if within ~4 days
  };

  // ── export ────────────────────────────────────────────────────────────────
  const shareUrl = () => {
    navigator.clipboard?.writeText(window.location.href).then(
      () => toastMsg("Link copied — opens this exact view"),
      () => toastMsg("Copy blocked"),
    );
  };
  const exportCsv = () => {
    if (!model) return;
    const cols = model.lines;
    const rows = [`date,${cols.map((c) => c.item.ticker.replace(/,/g, "")).join(",")}`];
    for (const ms of model.unionTs) {
      const cells = cols.map((c) => {
        const v = valAt(c.pts, ms);
        return v == null ? "" : mode === "rebase" ? v.toFixed(3) : c.pts.find((p) => p.ms === ms)?.raw?.toFixed(2) ?? v.toFixed(2);
      });
      rows.push(`${new Date(ms).toISOString().slice(0, 10)},${cells.join(",")}`);
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "varible-index.csv";
    a.click();
    URL.revokeObjectURL(url);
    toastMsg("CSV downloaded");
  };
  const exportPng = () => {
    const svg = plotRef.current;
    if (!svg) return;
    // A serialized SVG rasterized through <img> is its OWN document — it can't see
    // this page's :root, so `var(--…)` never resolves there: `stroke` falls back to
    // `none` (the grid vanishes) and `fill` to black (axis labels go invisible on
    // the dark plate). Inline the computed values before handing it to the image.
    const rootStyle = getComputedStyle(document.documentElement);
    const inlineVars = (s: string) =>
      s.replace(/var\((--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (m, name: string, fallback?: string) => {
        const v = rootStyle.getPropertyValue(name).trim() || (fallback ? fallback.trim() : m);
        // The substituted value lands INSIDE a double-quoted XML attribute, and the
        // font vars resolve WITH double quotes (`"JetBrains Mono", "…Fallback"`) —
        // left as-is they close the attribute early and the SVG won't parse at all.
        // Single quotes are equally valid in a CSS font-family.
        return v.replace(/"/g, "'");
      });
    const xml = inlineVars(new XMLSerializer().serializeToString(svg));
    const data = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 2}" height="${PH * 2}" viewBox="0 0 ${w} ${PH}">${xml
        .replace(/^<svg[^>]*>/, "")
        .replace(/<\/svg>$/, "")}</svg>`,
    )}`;
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = w * 2;
      cv.height = PH * 2;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#0a0a0c";
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0);
      cv.toBlob((bl) => {
        if (!bl) return;
        const url = URL.createObjectURL(bl);
        const a = document.createElement("a");
        a.href = url;
        a.download = "varible-index.png";
        a.click();
        URL.revokeObjectURL(url);
        toastMsg("PNG downloaded");
      });
    };
    img.onerror = () => toastMsg("PNG export blocked here");
    img.src = data;
  };
  const embedCode =
    typeof window !== "undefined"
      ? `<iframe\n  src="${window.location.href}"\n  width="860" height="560" frameborder="0"\n  title="Varible — Index Studio">\n</iframe>`
      : "";

  const title =
    visible.length === 0
      ? "No metrics"
      : `${byId.get(visible[0])?.name ?? "—"}${visible.length > 1 ? ` + ${visible.length - 1} more` : ""}`;

  return (
    <SectionShell className="font-sans">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4 sm:px-5">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="truncate text-[16px] font-semibold leading-tight tracking-[-0.01em]">{title}</h2>
          <span className="hidden font-mono text-[11px] text-ink-3 sm:inline">
            {mode === "rebase" ? "rebased · 100 at window start" : "absolute values"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Seg
            variant="mode"
            options={[{ key: "rebase", label: "Rebased" }, { key: "abs", label: "Absolute" }]}
            value={mode}
            onChange={(k) => setMode(k as Mode)}
          />
          <Seg
            variant="range"
            options={RANGES.map((r) => ({ key: r.key, label: r.label }))}
            value={activeRangeKey}
            onChange={(k) => setRange(RANGES.find((r) => r.key === k)!)}
          />
          <IconBtn onClick={exportCsv} label="CSV" title="Download CSV" />
          <IconBtn onClick={exportPng} label="PNG" title="Download PNG" />
          <IconBtn onClick={shareUrl} label="Share" title="Copy shareable link" />
          <IconBtn onClick={() => setEmbedOpen(true)} label="Embed" title="Embed" />
        </div>
      </div>

      {/* Chips */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3 sm:px-5">
        {activeValid.map((id) => {
          const item = byId.get(id);
          if (!item) return null;
          const line = model?.lines.find((l) => l.id === id);
          const last = line?.pts.filter((p) => Number.isFinite(p.v)).at(-1);
          const cur = last ? (mode === "rebase" ? last.v.toFixed(1) : fmtVal(item.unit, last.raw)) : "—";
          const off = hidden.has(id);
          return (
            <span
              key={id}
              className={`inline-flex items-center gap-1.5 rounded-none border border-line bg-bg-2 px-2 py-1 text-[12px] transition-opacity ${off ? "opacity-40" : ""}`}
            >
              <span className="h-2 w-2 shrink-0 rounded-md" style={{ background: item.color }} />
              <button type="button" className="font-mono font-semibold tracking-[0.01em] text-ink-2 hover:text-ink" onClick={() => toggleMetric(id)}>
                {item.ticker}
              </button>
              <span className="font-mono text-[11px] text-ink-3">{cur}</span>
              <button type="button" aria-label={`Remove ${item.ticker}`} className="font-mono text-[13px] leading-none text-ink-4 hover:text-red" onClick={() => removeMetric(id)}>
                ✕
              </button>
            </span>
          );
        })}
        <button
          type="button"
          onClick={() => { setPickerOpen((o) => !o); setSearch(""); }}
          className="inline-flex items-center gap-1 rounded-none border border-dashed border-line-2 px-2.5 py-1 text-[12px] font-semibold text-ink-2 transition-colors hover:border-yellow hover:text-yellow"
        >
          ＋ Add metric
        </button>
      </div>

      {/* Plot */}
      <div ref={wrapRef} className="relative px-2 sm:px-3" onMouseLeave={() => setHoverMs(null)}>
        {loadError ? (
          <div className="flex h-[360px] items-center justify-center text-[13px] text-ink-3">Couldn&apos;t load chart data.</div>
        ) : !loaded ? (
          <div className="flex h-[360px] items-center justify-center font-mono text-[12px] text-ink-3">Loading market data…</div>
        ) : !model ? (
          <div className="flex h-[360px] items-center justify-center text-[13px] text-ink-3">Add a metric to begin.</div>
        ) : (
          <svg ref={plotRef} viewBox={`0 0 ${w} ${PH}`} width="100%" height={PH} className="block" onMouseMove={onMove} onWheel={onWheel}>
            <rect x={0} y={0} width={w} height={PH} fill="#0a0a0c" />
            {/* grid + y labels */}
            {Array.from({ length: 6 }, (_, g) => {
              const v = model.lo + ((model.hi - model.lo) * g) / 5;
              const y = model.Y(v);
              const is100 = mode === "rebase" && Math.abs(v - 100) < (model.hi - model.lo) / 10;
              return (
                <g key={g}>
                  <line x1={PAD.l} x2={w - PAD.r} y1={y} y2={y} stroke={is100 ? "var(--color-line-2)" : "var(--color-line)"} strokeDasharray={is100 ? "4 3" : "2 5"} />
                  <text x={w - PAD.r + 6} y={y + 3} fontSize={10} fill={is100 ? "var(--color-ink-3)" : "var(--color-ink-4)"} fontFamily="var(--font-jetbrains-mono), monospace">
                    {mode === "abs" ? axisLabel(model.lines, v) : v.toFixed(0)}
                  </text>
                </g>
              );
            })}
            {/* x labels */}
            {xTicks(model.s, model.e).map((ms, i, arr) => (
              <text key={ms} x={model.X(ms)} y={PH - 7} fontSize={10} fill="var(--color-ink-4)" fontFamily="var(--font-jetbrains-mono), monospace" textAnchor={i === 0 ? "start" : i === arr.length - 1 ? "end" : "middle"}>
                {fmtDate(ms)}
              </text>
            ))}
            {/* primary area */}
            {model.primary?.path && (
              <>
                <defs>
                  <linearGradient id="is-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={model.primary.item.color} stopOpacity={0.16} />
                    <stop offset="100%" stopColor={model.primary.item.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                {(() => {
                  const fp = model.primary.pts.filter((p) => Number.isFinite(p.v));
                  if (fp.length < 2) return null;
                  const area = `${model.primary.path}L${model.X(fp[fp.length - 1].ms).toFixed(1)} ${(PAD.t + model.plotH).toFixed(1)}L${model.X(fp[0].ms).toFixed(1)} ${(PAD.t + model.plotH).toFixed(1)}Z`;
                  return <path d={area} fill="url(#is-area)" />;
                })()}
              </>
            )}
            {/* lines + endpoint dots */}
            {model.lines.map((L) => {
              const fp = L.pts.filter((p) => Number.isFinite(p.v));
              const end = fp[fp.length - 1];
              const isPrim = L.id === model.primary?.id;
              return (
                <g key={L.id}>
                  <path d={L.path} fill="none" stroke={L.item.color} strokeWidth={isPrim ? 2.3 : 1.7} strokeDasharray={L.item.dash ? "5 4" : undefined} strokeOpacity={L.item.dash ? 0.9 : 1} strokeLinejoin="round" strokeLinecap="round" />
                  {end && <circle cx={model.X(end.ms)} cy={model.Y(end.v)} r={isPrim ? 3.2 : 2.5} fill={L.item.color} stroke="#0a0a0c" strokeWidth={1.3} />}
                </g>
              );
            })}
            {/* primary end-value label */}
            {model.primary && (() => {
              const end = model.primary.pts.filter((p) => Number.isFinite(p.v)).at(-1);
              if (!end) return null;
              const y = model.Y(end.v);
              return (
                <g>
                  <rect x={w - PAD.r + 2} y={y - 8} width={PAD.r - 4} height={16} fill="#0a0a0c" rx={3} />
                  <text x={w - PAD.r + 6} y={y + 3} fontSize={11} fontWeight={700} fill={model.primary.item.color} fontFamily="var(--font-jetbrains-mono), monospace">
                    {mode === "rebase" ? end.v.toFixed(1) : fmtVal(model.primary.item.unit, end.raw)}
                  </text>
                </g>
              );
            })()}
            {/* crosshair */}
            {hoverTs != null && (
              <g>
                <line x1={model.X(hoverTs)} x2={model.X(hoverTs)} y1={PAD.t} y2={PAD.t + model.plotH} stroke="var(--color-line-2)" strokeDasharray="3 3" />
                {model.lines.map((L) => {
                  const v = valAt(L.pts, hoverTs);
                  return v == null ? null : <circle key={L.id} cx={model.X(hoverTs)} cy={model.Y(v)} r={3.2} fill={L.item.color} stroke="#0a0a0c" strokeWidth={1.3} />;
                })}
              </g>
            )}
          </svg>
        )}

        {/* tooltip */}
        {model && hoverTs != null && (
          <div
            className="pointer-events-none absolute z-10 min-w-[150px] rounded-lg border border-line-2 bg-bg-2/95 p-2.5 text-[12px] shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur"
            style={{ left: Math.min(w - 168, Math.max(6, model.X(hoverTs) + 12)), top: 8 }}
          >
            <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">{fmtDateY(hoverTs)}</div>
            {model.lines
              .map((L) => ({ L, v: valAt(L.pts, hoverTs), raw: L.pts.find((p) => p.ms === hoverTs)?.raw }))
              .filter((r) => r.v != null)
              .sort((a, b) => (b.v ?? 0) - (a.v ?? 0))
              .map(({ L, v, raw }) => (
                <div key={L.id} className="flex items-center justify-between gap-3 py-0.5">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-none" style={{ background: L.item.color }} />
                    <span className="font-mono text-[11px] text-ink-2">{L.item.ticker}</span>
                  </span>
                  <span className="font-mono font-semibold tabular text-ink">
                    {mode === "rebase" ? (v ?? 0).toFixed(1) : fmtVal(L.item.unit, raw ?? v ?? NaN)}
                  </span>
                </div>
              ))}
          </div>
        )}

        {/* Add-metric picker */}
        {pickerOpen && (
          <MetricPicker
            catalog={catalog}
            active={new Set(activeValid)}
            search={search}
            onSearch={setSearch}
            onPick={addMetric}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>

      {/* Brush */}
      {loaded && fullRange && window0 && (
        <Brush
          full={fullRange}
          window={window0}
          primary={model?.primary ? { pts: seriesData.get(model.primary.id) ?? [], color: model.primary.item.color } : null}
          width={w}
          onChange={setWin}
        />
      )}

      {/* Legend note */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pb-4 pt-1 text-[11.5px] text-ink-3 sm:px-5">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0 w-4 border-t-2 border-ink-3" /> solid = index / metric</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0 w-4 border-t-2 border-dashed border-ink-3" /> dashed = benchmark</span>
        <span>baseline 100 = window start</span>
        <span className="ml-auto font-mono text-[10.5px] text-ink-4">drag the brush to zoom · scroll to zoom · click a ticker to hide</span>
      </div>

      {/* Embed modal */}
      {embedOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-5" onClick={(e) => e.target === e.currentTarget && setEmbedOpen(false)}>
          <div className="w-full max-w-[520px] rounded-2xl border border-line-2 bg-bg-1 p-5">
            <h3 className="text-[15px] font-semibold">Embed this chart</h3>
            <p className="mt-1 text-[12.5px] text-ink-3">The configured view (metrics + window) travels in the URL, so it renders exactly as you built it.</p>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-bg p-3 font-mono text-[11px] text-ink-2">{embedCode}</pre>
            <div className="mt-3 flex justify-end gap-2">
              <IconBtn onClick={() => navigator.clipboard?.writeText(embedCode).then(() => toastMsg("Embed code copied"))} label="Copy" />
              <IconBtn onClick={() => setEmbedOpen(false)} label="Close" />
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-yellow px-4 py-2 text-[12.5px] font-semibold text-black shadow-lg">{toast}</div>
      )}
    </SectionShell>
  );
}

// ── sub-components ──────────────────────────────────────────────────────────
function Seg({ variant, options, value, onChange }: { variant: "mode" | "range"; options: { key: string; label: string }[]; value: string | null; onChange: (k: string) => void }) {
  return (
    <div className="flex gap-0.5 rounded-xl border border-line bg-bg-1 p-[3px]">
      {options.map((o) => {
        const on = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.key)}
            className={`rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${
              on ? (variant === "mode" ? "bg-bg-3 text-ink" : "bg-yellow text-black font-semibold") : "text-ink-3 hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function IconBtn({ onClick, label, title }: { onClick: () => void; label: string; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-bg-2 px-2.5 py-1.5 font-mono text-[11px] text-ink-2 transition-colors hover:border-line-2 hover:text-ink"
    >
      {label}
    </button>
  );
}

function MetricPicker({ catalog, active, search, onSearch, onPick, onClose }: {
  catalog: CatalogItem[];
  active: Set<string>;
  search: string;
  onSearch: (s: string) => void;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // Defer so the opening click doesn't immediately close it.
    const t = window.setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    document.addEventListener("keydown", onEsc);
    return () => { window.clearTimeout(t); document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [onClose]);

  const q = norm(search.trim());
  const groups = GROUP_ORDER.filter((g) => catalog.some((c) => c.group === g));
  return (
    <div ref={ref} className="absolute left-3 top-1 z-20 w-[300px] max-w-[calc(100%-24px)] overflow-hidden rounded-xl border border-line-2 bg-bg-1 shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
      <div className="p-2.5">
        <input
          autoFocus
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Add a metric — index, benchmark, volume, holders…"
          className="w-full rounded-lg border border-line bg-bg px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink-4 focus:border-yellow"
        />
      </div>
      <div className="max-h-[320px] overflow-y-auto px-1.5 pb-2">
        {groups.map((g) => {
          const items = catalog.filter((c) => c.group === g && (!q || norm(c.ticker).includes(q) || norm(c.name).includes(q)));
          if (!items.length) return null;
          return (
            <div key={g}>
              <div className="px-2 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-4">{g}</div>
              {items.map((c) => {
                const on = active.has(c.id);
                return (
                  <div
                    key={c.id}
                    aria-disabled={on}
                    onClick={() => !on && onPick(c.id)}
                    className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${on ? "opacity-40" : "cursor-pointer hover:bg-bg-2"}`}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-md" style={{ background: c.color }} />
                    <span className="min-w-[62px] font-mono text-[12px] font-semibold">{c.ticker}</span>
                    <span className="flex-1 truncate text-[12.5px] text-ink-2">{c.name}</span>
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-ink-4">{on ? "added" : c.unit}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {catalog.filter((c) => !q || norm(c.ticker).includes(q) || norm(c.name).includes(q)).length === 0 && (
          <div className="px-2 py-3 text-[12px] text-ink-4">No match</div>
        )}
      </div>
    </div>
  );
}

function Brush({ full, window: win, primary, width, onChange }: {
  full: [number, number];
  window: [number, number];
  primary: { pts: SeriesPoint[]; color: string } | null;
  width: number;
  onChange: (w: [number, number]) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ mode: "l" | "r" | "pan" | "new"; grab?: number; w0?: [number, number]; anchor?: number } | null>(null);
  const [lo, hi] = full;
  const span = hi - lo || 1;
  const msAt = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    return lo + Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * span;
  };
  const X = (ms: number) => ((ms - lo) / span) * width;

  const spark = useMemo(() => {
    const pts = (primary?.pts ?? []).filter((p) => Number.isFinite(p.value) && p.value > 0);
    if (pts.length < 2) return null;
    const base = pts[0].value;
    const vv = pts.map((p) => ({ ms: Date.parse(p.ts), v: (p.value / base) * 100 }));
    let vlo = Infinity, vhi = -Infinity;
    for (const p of vv) { vlo = Math.min(vlo, p.v); vhi = Math.max(vhi, p.v); }
    const pad = (vhi - vlo) * 0.12 || 1;
    vlo -= pad; vhi += pad;
    const Y = (v: number) => BH - 5 - ((v - vlo) / (vhi - vlo || 1)) * (BH - 10);
    const sx = (ms: number) => ((ms - lo) / (hi - lo || 1)) * width;
    const d = vv.map((p, i) => `${i ? "L" : "M"}${sx(p.ms).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(" ");
    return { d, color: primary!.color };
  }, [primary, lo, hi, width]);

  const onDown = (e: React.PointerEvent) => {
    const role = (e.target as SVGElement).getAttribute?.("data-h");
    const ms = msAt(e.clientX);
    if (role === "l" || role === "r") drag.current = { mode: role };
    else if ((e.target as SVGElement).getAttribute?.("data-h") === "body") drag.current = { mode: "pan", grab: ms, w0: [...win] as [number, number] };
    else drag.current = { mode: "new", anchor: ms };
    ref.current?.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const ms = msAt(e.clientX);
    let [a, b] = win;
    const min = 2 * DAY;
    if (drag.current.mode === "l") a = Math.min(ms, b - min);
    else if (drag.current.mode === "r") b = Math.max(ms, a + min);
    else if (drag.current.mode === "new") { a = Math.min(drag.current.anchor!, ms); b = Math.max(drag.current.anchor!, ms); if (b - a < min) b = a + min; }
    else if (drag.current.mode === "pan") {
      const d = ms - drag.current.grab!;
      const w0 = drag.current.w0!;
      const sp = w0[1] - w0[0];
      a = w0[0] + d; b = w0[1] + d;
      if (a < lo) { a = lo; b = lo + sp; }
      if (b > hi) { b = hi; a = hi - sp; }
    }
    onChange([Math.max(lo, a), Math.min(hi, b)]);
  };
  const onUp = () => { drag.current = null; };

  const x0 = X(win[0]);
  const x1 = X(win[1]);
  return (
    <div className="px-3 pb-3">
      <div className="flex justify-between px-2 pb-1 font-mono text-[10px] tracking-[0.04em] text-ink-4">
        <span>{fmtDate(win[0])}</span>
        <span>{fmtDate(win[1])}</span>
      </div>
      <svg ref={ref} viewBox={`0 0 ${width} ${BH}`} width="100%" height={BH} className="block cursor-ew-resize touch-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <rect x={0} y={0} width={width} height={BH} fill="#0e0e11" />
        {spark && (
          <>
            <path d={`${spark.d}L${width} ${BH}L0 ${BH}Z`} fill={spark.color} opacity={0.08} />
            <path d={spark.d} fill="none" stroke={spark.color} strokeWidth={1.2} opacity={0.5} />
          </>
        )}
        <rect x={0} y={0} width={x0} height={BH} fill="#0a0a0c" opacity={0.62} />
        <rect x={x1} y={0} width={width - x1} height={BH} fill="#0a0a0c" opacity={0.62} />
        <rect data-h="body" x={x0} y={1} width={Math.max(2, x1 - x0)} height={BH - 2} fill="#bfef01" opacity={0.06} stroke="#bfef01" strokeOpacity={0.3} className="cursor-grab" />
        <rect data-h="l" x={x0 - 3} y={6} width={6} height={BH - 12} rx={2} fill="#bfef01" opacity={0.85} className="cursor-ew-resize" />
        <rect data-h="r" x={x1 - 3} y={6} width={6} height={BH - 12} rx={2} fill="#bfef01" opacity={0.85} className="cursor-ew-resize" />
      </svg>
    </div>
  );
}

// ── pure helpers ──────────────────────────────────────────────────────────────
function xTicks(s: number, e: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < 5; k++) out.push(s + ((e - s) * k) / 4);
  return out;
}
function axisLabel(lines: { item: CatalogItem }[], v: number): string {
  const units = new Set(lines.map((l) => l.item.unit));
  if (units.size === 1) {
    const u = [...units][0];
    return u === "usd" ? formatCompactUsd(v) : u === "count" ? formatCompactNumber(v) : v.toFixed(0);
  }
  return Math.abs(v) >= 1000 ? formatCompactUsd(v) : formatCompactNumber(v);
}
