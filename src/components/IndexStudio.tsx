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
import {
  BRAND_LIME,
  BRAND_LOCKUP_ASPECT,
  BRAND_LOCKUP_MARK_PATH,
  BRAND_LOCKUP_VIEWBOX,
  BRAND_LOCKUP_WORDMARK_PATH,
} from "@/lib/brand";
import { SITE_ORIGIN } from "@/lib/site";
import { formatCompactUsd, formatCompactNumber } from "@/lib/format";

type Unit = "index" | "usd" | "count" | "percent";
type SeriesPoint = { ts: string; value: number };
type CatalogItem = {
  id: string;
  ticker: string;
  name: string;
  group: string;
  unit: Unit;
  color: string;
  dash?: boolean;
  /** Sampled weekly, not daily (the price indices). Drives the "weekly" tag and
   *  the dated-endpoint honesty: a weekly line's last point is usually days
   *  behind the window edge, and its value must not read as "as of today". */
  weekly?: boolean;
  /** A per-day FLOW (volume / trades / gacha rips) rather than a level or an
   *  index. Flows render as grouped bars in ABSOLUTE mode (a $/day quantity is a
   *  bar, not a trend line); indices, benchmarks, and levels (market cap,
   *  holders) stay lines. Rebased mode is lines-only for everything. */
  flow?: boolean;
};
type Mode = "rebase" | "abs";

const DAY = 86_400_000;
const GROUP_ORDER = ["Indices", "Benchmarks", "Market cap", "Volume", "Activity", "Ratios"];
const RANGES: { key: string; days: number | null; label: string }[] = [
  { key: "30", days: 30, label: "30D" },
  { key: "90", days: 90, label: "90D" },
  { key: "180", days: 180, label: "6M" },
  { key: "all", days: null, label: "ALL" },
];
// /ips (unscoped market studio) opens on V-MKT against the four majors it's most
// often read against — rebased so the mixed units overlay, over the default 90D
// window. V-MKT leads (primary → area + glow); a benchmark the /benchmarks
// endpoint doesn't return (e.g. SOL past CoinGecko's 365d free-tier cap) is simply
// dropped by activeValid, honestly, rather than erroring.
const DEFAULT_ACTIVE = ["idx:market:total", "bench:BTC", "bench:ETH", "bench:SOL", "bench:SP500"];

/**
 * Scoping the studio to one entity (today: a platform detail page). Unscoped =
 * the /ips market-wide studio, unchanged.
 *
 * When scoped, the catalog narrows to THIS entity's own spine metrics plus the
 * two things worth comparing it against — the benchmarks and V-MKT — so the
 * picker on /platform/beezie isn't a list of every other platform's series.
 */
export type StudioScope = {
  entity: "platform";
  /** One entity (/platform/[key]) — omit for the whole FAMILY (/platforms), where
   *  the question is "how do the platforms compare", not "how is this one doing". */
  key?: string;
};

/** Ids the scoped catalog keeps besides the entity's own series. */
const SCOPE_KEEP = new Set(["idx:market:total"]);

function inScope(id: string, scope: StudioScope): boolean {
  if (SCOPE_KEEP.has(id) || id.startsWith("bench:")) return true;
  return scope.key
    ? id.startsWith(`sp:${scope.entity}:${scope.key}:`)
    : id.startsWith(`sp:${scope.entity}:`);
}

/**
 * The chips a scoped studio opens with — always volume, because that's the
 * comparable. Deterministic, so it can seed useState before the catalog loads;
 * `activeValid` then drops any id whose series doesn't exist.
 *
 * That drop IS the honest-absence rule, not a bug: nothing writes
 * platform/phygitals/volume_usd (no secondary-sales source), so Phygitals simply
 * isn't a default line here. Its gacha series is still addable from the picker.
 */
function scopedDefaultActive(scope: StudioScope): string[] {
  if (scope.key) return [`sp:${scope.entity}:${scope.key}:volume_usd`];
  // /platforms compares the venues on ONE comparable measure: each platform's
  // TOTAL 24h volume (marketplace + gacha), a synthetic series built in
  // buildCatalog. Using total (not marketplace-only volume_usd) is what lets
  // Phygitals — gacha-only, no volume_usd — appear at all, at its real gacha
  // volume. activeValid still drops any total that never got 2 points.
  return PLATFORM_SOURCES.map((p) => `sp:platform:${p.key}:total_volume`);
}

// Line colors. V-MKT is the brand yellow; benchmarks keep recognizable brand hues;
// everything else draws from a distinct palette assigned by catalog order.
// Benchmark presentation, keyed by the symbol the /benchmarks endpoint returns.
// The picker iterates whatever keys come back (so a backend-added symbol like SOL
// shows up with zero FE edits) and looks each up here; an unknown symbol falls
// back to itself for ticker/name and a palette colour. SOL is pre-seeded because
// it's the known incoming one — a courtesy, not a requirement for it to appear.
const BENCH_COLOR: Record<string, string> = {
  BTC: "#e8993a",
  ETH: "#8b93c9",
  SP500: "#9aa0ab",
  NASDAQ: "#6fb0c9",
  GOLD: "#c8a951",
  SOL: "#14f195", // Solana green
};
const BENCH_TICKER: Record<string, string> = { SP500: "S&P 500", NASDAQ: "NASDAQ" };
const BENCH_NAME: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SP500: "S&P 500",
  NASDAQ: "Nasdaq Composite",
  GOLD: "Gold",
  SOL: "Solana",
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

/**
 * Map with bounded concurrency, preserving input order in the result.
 *
 * The index probes went from 3 to one-per-registry-entry (~27). All internal
 * chart endpoints share ONE 240-req/60s per-IP bucket, so ~27 in one build is far
 * under it — but this caps the in-flight burst anyway: it keeps the rate-limiter's
 * (non-atomic) bookkeeping honest under concurrency, and behaves the same whether
 * or not the browser's own ~6-per-origin cap is in play.
 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// The spine families the picker offers — each bulk read returns ONLY populated
// keys (the "don't offer empty series" filter) AND prefetches their data.
const SPINE_FAMILIES: { entity: string; metric: string; group: string; unit: Unit; short: string; label: string }[] = [
  { entity: "market", metric: "mcap_usd", group: "Market cap", unit: "usd", short: "MCAP", label: "Total Market Cap" },
  { entity: "ip", metric: "mcap_usd", group: "Market cap", unit: "usd", short: "MC", label: "Market Cap" },
  { entity: "platform", metric: "mcap_usd", group: "Market cap", unit: "usd", short: "MC", label: "Market Cap" },
  { entity: "platform", metric: "volume_usd", group: "Volume", unit: "usd", short: "VOL", label: "Marketplace Vol" },
  { entity: "platform", metric: "gacha_volume_usd", group: "Volume", unit: "usd", short: "GAC", label: "Gacha Vol" },
  { entity: "ip", metric: "cards_traded", group: "Activity", unit: "count", short: "CRD", label: "Cards Traded" },
  { entity: "ip", metric: "trades", group: "Activity", unit: "count", short: "TRD", label: "Trades" },
  { entity: "ip", metric: "holders", group: "Activity", unit: "count", short: "HLD", label: "Holders" },
  // Platform-entity activity the spine already records (populated-only culling
  // keeps this honest — active_wallets is CC-only today, so only CC's line appears).
  { entity: "platform", metric: "trades", group: "Activity", unit: "count", short: "TRD", label: "Trades" },
  { entity: "platform", metric: "holders", group: "Activity", unit: "count", short: "HLD", label: "Holders" },
  { entity: "platform", metric: "active_wallets", group: "Activity", unit: "count", short: "ACT", label: "Active Wallets" },
];

/** Spine metrics that are per-day FLOWS (→ bars in absolute mode). mcap_usd and
 *  holders are LEVELS / stocks (→ lines); active_wallets is a per-day activity
 *  count, a flow like trades. The synthetic total_volume is a flow and is tagged
 *  where it's built; the derived share%/avg-trade are LEVELS, tagged there. */
const FLOW_METRICS = new Set(["volume_usd", "gacha_volume_usd", "cards_traded", "trades", "active_wallets"]);

/** Build the picker catalog from real availability + prefetch every series' data. */
async function buildCatalog(): Promise<{ items: CatalogItem[]; data: Map<string, SeriesPoint[]> }> {
  const data = new Map<string, SeriesPoint[]>();
  const items: CatalogItem[] = [];
  let paletteI = 0;
  const nextColor = () => PALETTE[paletteI++ % PALETTE.length];

  // 1. Indices (constant-quality price index) — the FULL registry: the market,
  //    the categories, and every named IP. The naming SSOT is the source of
  //    truth, so a new catalog IP appears here with no edit; empty ones (an IP
  //    without enough index history) are culled by the <2-point check. Batched so
  //    the burst is modest (see mapLimit).
  const idxProbes = await mapLimit(indexRegistry(), 8, async (reg) => {
    try {
      const d = await fetchChart("index", {
        entity: reg.entity,
        key: reg.key,
        kind: "price",
        from: "2000-01-01",
        freq: "weekly",
      });
      return { reg, d };
    } catch {
      return null;
    }
  });
  for (const p of idxProbes) {
    if (!p) continue;
    const points = (p.d.points as SeriesPoint[]) ?? [];
    if (points.length < 2) continue;
    const id = `idx:${p.reg.entity}:${p.reg.key}`;
    data.set(id, points);
    items.push({
      id,
      // Prefer the endpoint's own ticker/name; the registry values are the same
      // SSOT and stand in if a field is ever missing.
      ticker: (p.d.ticker as string) ?? p.reg.ticker,
      name: (p.d.indexName as string) ?? p.reg.name,
      group: "Indices",
      unit: "index",
      color: p.reg.entity === "market" ? "#bfef01" : nextColor(),
      weekly: true, // fetched freq:"weekly" above
    });
  }

  // 2. Benchmarks — one call; iterate WHATEVER symbols come back so a
  //    backend-added one (SOL) shows up without an FE edit. Ticker/name/colour
  //    come from the maps above, each with a fallback to the raw symbol.
  try {
    const bd = await fetchChart("benchmarks", { from: "2000-01-01", freq: "daily" });
    const series = (bd.series as Record<string, SeriesPoint[]>) ?? {};
    for (const sym of Object.keys(series)) {
      const points = series[sym] ?? [];
      if (points.length < 2) continue;
      const id = `bench:${sym}`;
      data.set(id, points);
      items.push({
        id,
        ticker: BENCH_TICKER[sym] ?? sym,
        name: BENCH_NAME[sym] ?? sym,
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
        flow: FLOW_METRICS.has(f.metric),
      });
    }
  }

  // 4. Combined per-platform TOTAL volume — marketplace volume_usd + gacha
  //    volume_usd, union-summed BY DAY (client-side). A day with only one lane
  //    contributes that lane alone, so gacha-only platforms (Phygitals: no
  //    volume_usd) surface honestly at their gacha value rather than dropping out.
  //    Its own `total_volume` series so /platforms can compare venues on one
  //    comparable total; the separate volume_usd / gacha_volume_usd metrics above
  //    stay in the picker untouched.
  const platVol = fam.find((x) => x.f.entity === "platform" && x.f.metric === "volume_usd")?.series ?? {};
  const platGac = fam.find((x) => x.f.entity === "platform" && x.f.metric === "gacha_volume_usd")?.series ?? {};
  const totals: { key: string; points: SeriesPoint[] }[] = [];
  for (const key of new Set([...Object.keys(platVol), ...Object.keys(platGac)])) {
    const byDay = new Map<string, number>();
    for (const p of platVol[key] ?? []) if (Number.isFinite(p.value)) byDay.set(p.ts, (byDay.get(p.ts) ?? 0) + p.value);
    for (const p of platGac[key] ?? []) if (Number.isFinite(p.value)) byDay.set(p.ts, (byDay.get(p.ts) ?? 0) + p.value);
    const points = [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([ts, value]) => ({ ts, value }));
    if (points.length >= 2) totals.push({ key, points });
  }
  // Biggest latest value first, so the reconcile picks the largest platform as the
  // primary (area + glow) — same rule the raw spine families use above.
  totals.sort((a, b) => (b.points.at(-1)?.value ?? 0) - (a.points.at(-1)?.value ?? 0));
  for (const { key, points } of totals) {
    const id = `sp:platform:${key}:total_volume`;
    data.set(id, points);
    items.push({
      id,
      ticker: `${platShort(key)}·TOT`,
      name: `${PLATFORM_NAME[key] ?? titleize(key)} Total Vol`,
      group: "Volume",
      unit: "usd",
      color: nextColor(),
      flow: true,
    });
  }

  // 5. Derived ratios — built the same client-side way, from the series above.
  //    Both are LEVELS (lines): a share and an average don't accumulate, so
  //    absolute mode draws them as lines, not bars.
  const platTrades = fam.find((x) => x.f.entity === "platform" && x.f.metric === "trades")?.series ?? {};

  // Share of Market % — each platform's TOTAL volume as a share of the whole
  // market that day (Σ all platform totals). Days with no market total carry no
  // share — an honest gap, not a fabricated 0%.
  const marketByDay = new Map<string, number>();
  for (const t of totals) for (const p of t.points) if (Number.isFinite(p.value)) marketByDay.set(p.ts, (marketByDay.get(p.ts) ?? 0) + p.value);
  for (const { key, points } of totals) {
    const share = points
      .map((p) => {
        const mkt = marketByDay.get(p.ts) ?? 0;
        return mkt > 0 ? { ts: p.ts, value: (p.value / mkt) * 100 } : null;
      })
      .filter((p): p is SeriesPoint => p != null);
    if (share.length < 2) continue;
    const id = `sp:platform:${key}:share_pct`;
    data.set(id, share);
    items.push({
      id,
      ticker: `${platShort(key)}·SHR`,
      name: `${PLATFORM_NAME[key] ?? titleize(key)} Share of Market`,
      group: "Ratios",
      unit: "percent",
      color: nextColor(),
    });
  }

  // Avg Trade — marketplace volume_usd ÷ trades per day. A day with 0 (or missing)
  // trades has NO average (NaN) and is dropped, never fabricated as $0.
  for (const key of new Set([...Object.keys(platVol), ...Object.keys(platTrades)])) {
    const trd = new Map((platTrades[key] ?? []).map((p) => [p.ts, p.value] as const));
    const avg = (platVol[key] ?? [])
      .map((p) => {
        const t = trd.get(p.ts);
        return t != null && t > 0 && Number.isFinite(p.value) ? { ts: p.ts, value: p.value / t } : null;
      })
      .filter((p): p is SeriesPoint => p != null);
    if (avg.length < 2) continue;
    const id = `sp:platform:${key}:avg_trade`;
    data.set(id, avg);
    items.push({
      id,
      ticker: `${platShort(key)}·AVG`,
      name: `${PLATFORM_NAME[key] ?? titleize(key)} Avg Trade`,
      group: "Ratios",
      unit: "usd",
      color: nextColor(),
    });
  }

  return { items, data };
}

// ── formatting ──────────────────────────────────────────────────────────────
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (ms: number) => `${MON[new Date(ms).getUTCMonth()]} ${new Date(ms).getUTCDate()}`;
const fmtDateY = (ms: number) => `${fmtDate(ms)}, ${new Date(ms).getUTCFullYear()}`;
function fmtVal(unit: Unit, v: number): string {
  if (!Number.isFinite(v)) return "—";
  return unit === "usd"
    ? formatCompactUsd(v)
    : unit === "count"
      ? formatCompactNumber(v)
      : unit === "percent"
        ? `${v.toFixed(1)}%`
        : v.toFixed(1);
}

// ── URL hash state ────────────────────────────────────────────────────────────
// The hash carries the studio's whole state PLUS an `sc` page tag. That tag is
// what keeps the studios isolated across client-side navigation: a hash written by
// the /ips market studio (sc=market) lingers in window.location.hash after a soft
// nav to /platforms (Next changes the pathname but never clears the fragment), so
// the /platforms studio would otherwise read /ips's config as its own. It instead
// sees sc=market ≠ its own sc=platform and ignores the whole hash, mounting its
// default. A genuine deep-link still works — it carries the tag of the page it
// points at, so on arrival the tags match.
type UrlState = { active: string[]; mode: Mode; win: [number, number] | null; sc: string };
/** Stable per-page tag: "market" (/ips), "platform" (/platforms), or
 *  "platform:<key>" (/platform/[key]). */
function scopeTag(scope?: StudioScope): string {
  if (!scope) return "market";
  return scope.key ? `${scope.entity}:${scope.key}` : scope.entity;
}
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
    const sc = h.get("sc");
    if (sc) out.sc = sc;
    return out;
  } catch {
    return {};
  }
}

// ── geometry ──────────────────────────────────────────────────────────────────
const PAD = { t: 18, r: 60, b: 24, l: 12 };
const PH = 360;
const BH = 54;

export function IndexStudio({ scope }: { scope?: StudioScope } = {}) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [seriesData, setSeriesData] = useState<Map<string, SeriesPoint[]>>(() => new Map());
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Only honor a hash written for THIS page. One left in the URL by a client-side
  // nav from another studio carries a different `sc` and is discarded, so the page
  // mounts its own default; a matching deep-link (or the browser back/forward to a
  // page this studio itself wrote) is honored.
  const pageTag = scopeTag(scope);
  const initial = useMemo<Partial<UrlState>>(() => {
    const h = parseHash();
    return h.sc === pageTag ? h : {};
  }, [pageTag]);
  const [active, setActive] = useState<string[]>(
    initial.active ?? (scope ? scopedDefaultActive(scope) : DEFAULT_ACTIVE),
  );
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  // Scoped studios open in ABSOLUTE: one platform's own volume in dollars is the
  // question being asked. Rebasing a single series to 100 answers nothing until
  // you add something to compare it against (which the picker still offers).
  const [mode, setMode] = useState<Mode>(initial.mode ?? (scope ? "abs" : "rebase"));
  const [win, setWin] = useState<[number, number] | null>(initial.win ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [embedOpen, setEmbedOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<SVGSVGElement>(null);
  const [w, setW] = useState(920);

  // Fetch catalog + all series once. The fetch itself is scope-independent (the
  // /series reads are bulk + cached per metric family either way); scoping only
  // narrows what the picker OFFERS, so /platform/beezie isn't a menu of every
  // other platform's series.
  useEffect(() => {
    let alive = true;
    buildCatalog()
      .then(({ items, data }) => {
        if (!alive) return;
        const scoped = scope ? items.filter((it) => inScope(it.id, scope)) : items;
        setSeriesData(data);
        setCatalog(scoped);
        // Reconcile the pre-catalog seed against what actually exists.
        //   • Ids with no series are dropped — that's the honest-absence rule,
        //     not a bug (Phygitals has no volume_usd, so it isn't a line here).
        //   • The survivors are re-ordered into CATALOG order, which buildCatalog
        //     already sorts biggest-latest-value first. This matters: the FIRST
        //     active line is the "primary" — it names the chart and gets the area
        //     fill and glow — and seeding from PLATFORM_SOURCES order made tiny
        //     Courtyard ($312) lead over Collector Crypt ($27.9K).
        //   • If nothing survives, fall back to anything this scope does have
        //     rather than opening on an empty plot.
        // Skipped entirely when the hash chose the set: a shared link's own
        // order is the author's, and re-sorting it would move their primary.
        if (scope && !initial.active) {
          setActive((cur) => {
            const keep = new Set(cur);
            const ordered = scoped.filter((c) => keep.has(c.id)).map((c) => c.id);
            if (ordered.length) return ordered;
            const prefix = scope.key
              ? `sp:${scope.entity}:${scope.key}:`
              : `sp:${scope.entity}:`;
            const own = scoped.find((c) => c.id.startsWith(prefix));
            return own ? [own.id] : cur;
          });
        }
        setLoaded(true);
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
    // `scope` is a page-level constant; re-fetching on identity change would be
    // a wasted round-trip, so key the effect on its contents.
  }, [scope?.entity, scope?.key]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Tag the hash with this page's identity so it can't be adopted by another
    // studio after a client-side nav (see parseHash / scopeTag). Also self-heals a
    // leftover foreign hash: once this page loads its default, this write replaces
    // the stale fragment with sc=<thisPage>.
    p.set("sc", pageTag);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${p.toString()}`);
  }, [activeValid, mode, win, loaded, pageTag]);

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

  /**
   * Every series' timestamps parsed ONCE, window-independent.
   *
   * ⚠️ This is load-bearing for the wheel, not a micro-optimisation. The model
   * below re-runs on every window change, and it used to `Date.parse` each point
   * TWICE (once to filter in-window, once to project) — so a trackpad, which
   * fires wheel events at ~100/sec, re-parsed every timestamp of every visible
   * series ~200 times a second on the main thread. That is what took the tab
   * down. Parsing is hoisted here; the per-frame work is now numeric compares.
   */
  const parsed = useMemo(() => {
    const m = new Map<string, { ms: number; value: number }[]>();
    for (const [id, pts] of seriesData) {
      m.set(
        id,
        pts
          .map((p) => ({ ms: Date.parse(p.ts), value: p.value }))
          // Finite + ascending ONCE here, not per-window: the model's boundary
          // interpolation (interpAt) needs sorted input, and doing it in this
          // seriesData-keyed memo keeps it off the wheel's per-frame path.
          .filter((p) => Number.isFinite(p.ms) && Number.isFinite(p.value))
          .sort((a, b) => a.ms - b.ms),
      );
    }
    return m;
  }, [seriesData]);

  // Project every visible series onto the current window.
  //
  // ⚠️ ONE common rebase anchor: the WINDOW START, for every series. It used to
  // rebase each series at its own FIRST IN-WINDOW point — fine for a daily series
  // (whose first in-window point sits ~a day after the window edge) but wrong for
  // a weekly one, whose first in-window point can be a week in. So "V-MKT vs S&P"
  // anchored the two at different DATES: V-MKT read 100.0 on Jun 22 next to an S&P
  // already at 100.7 from its Jun 17 anchor. Now both divide by their value AT the
  // window start — interpolated between the bracketing real points for a sparse
  // series — so 100 means the same date for all of them, which is what "100 at
  // window start" always claimed.
  //
  // The line is ALSO extended to the window edge: a synthetic boundary point at
  // (s, anchor) is prepended to the PATH so a weekly line spans the full window
  // instead of starting a week in. That point is GEOMETRY ONLY — it never enters
  // `pts`, so the crosshair, tooltip, dots, endpoint label and CSV still see real
  // readings exclusively. Interpolation touches the anchor and the boundary
  // segment, nothing the user can hover.
  const model = useMemo(() => {
    if (!window0 || !visible.length) return null;
    const [s, e] = window0;
    const span = e - s || 1;
    const plotW = w - PAD.l - PAD.r;
    const plotH = PH - PAD.t - PAD.b;

    const cols = visible.map((id) => {
      const item = byId.get(id)!;
      const raw = parsed.get(id) ?? []; // finite + ascending (see `parsed`)
      const inWin = raw.filter((p) => p.ms >= s && p.ms <= e);

      // Value at the window start — the common anchor. `interpAt` returns null
      // when s predates the whole series (a young series that simply has no
      // reading at the window start); we then fall back to its first in-window
      // point and add no boundary, which is the honest "starts mid-window".
      const anchorV = interpAt(raw, s);
      let base = 1;
      let boundaryRaw: number | null = null;
      if (mode === "rebase") {
        if (anchorV != null && anchorV > 0) {
          base = anchorV;
          boundaryRaw = anchorV;
        } else {
          const first = inWin.find((p) => p.value > 0);
          base = first ? first.value : NaN;
        }
      } else if (anchorV != null) {
        boundaryRaw = anchorV; // absolute mode still extends the line to the edge
      }

      const rebase = (val: number) =>
        mode === "rebase" ? (Number.isFinite(base) ? (val / base) * 100 : NaN) : val;

      // Real in-window points — the ONLY points anything interactive reads.
      const pts = inWin.map((p) => ({ ms: p.ms, v: rebase(p.value), raw: p.value }));

      // Path points = the boundary (when we have one and the first real point is
      // strictly inside the window) followed by the real points. Drawn, not read.
      let pathPts = pts;
      if (boundaryRaw != null && inWin.length > 0 && inWin[0].ms > s) {
        const b = boundaryRaw;
        pathPts = [{ ms: s, v: rebase(b), raw: b }, ...pts];
      }

      return { id, item, pts, pathPts, step: medianStep(pts) };
    });

    // Flow series (volume / trades / gacha rips) render as grouped BARS in
    // absolute mode; indices, benchmarks and levels stay lines, and rebased mode
    // is lines-only for everything. Their presence pins the domain floor to 0
    // below, because a bar is drawn up from zero.
    const barCols = mode === "abs" ? cols.filter((c) => c.item.flow) : [];
    const hasBars = barCols.length > 0;

    // Domain over the PATH points (boundary included): a rising sparse series'
    // interpolated anchor can sit below every in-window point, so excluding it
    // would clip the boundary segment beneath the plot floor.
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of cols) for (const p of c.pathPts) if (Number.isFinite(p.v)) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
    if (!Number.isFinite(lo)) { lo = 0; hi = 100; }
    if (mode === "rebase") { lo = Math.min(lo, 100); hi = Math.max(hi, 100); }
    const padv = (hi - lo) * 0.1 || 1;
    // In absolute mode the pad must not manufacture a floor below zero when every
    // visible value is ≥ 0 — a volume axis reading "$-25.1K" asserts a negative
    // volume that cannot exist. A genuinely negative series keeps the padded floor.
    const clampAtZero = mode === "abs" && lo >= 0;
    lo -= padv;
    hi += padv;
    if (clampAtZero && lo < 0) lo = 0;
    // Bars grow up from zero — if the padded floor sat above 0 (every value large)
    // the bar bottoms would fall off-plot, so pin the floor to 0 when bars show.
    if (hasBars && lo > 0) lo = 0;

    const X = (ms: number) => PAD.l + ((ms - s) / span) * plotW;
    const Y = (v: number) => PAD.t + plotH - ((v - lo) / (hi - lo || 1)) * plotH;

    const lines = cols.map((c) => ({
      ...c,
      path: monotonePath(c.pathPts.filter((p) => Number.isFinite(p.v)).map((p) => [X(p.ms), Y(p.v)] as [number, number])),
    }));

    // Grouped-bar geometry for the flow columns — one rect per in-window point,
    // keyed by series id so the render draws them in place of that series' line.
    // At a shared date the N bar columns sit side by side within a band whose
    // width is the median day-step in pixels (so daily bars nearly touch and a
    // sparse/long window just gets thinner bars). Baseline = Y(0).
    const bars = new Map<string, { ms: number; x: number; y: number; w: number; h: number }[]>();
    if (hasBars) {
      const y0 = Y(Math.max(0, lo)); // lo is pinned to 0 when bars are present
      const dates = [
        ...new Set(barCols.flatMap((c) => c.pts.filter((p) => Number.isFinite(p.v)).map((p) => p.ms))),
      ].sort((a, b) => a - b);
      const gaps = dates.slice(1).map((d, i) => d - dates[i]).filter((g) => g > 0).sort((a, b) => a - b);
      const stepMs = gaps.length ? gaps[Math.floor(gaps.length / 2)] : span;
      const bandPx = Math.max(1.5, Math.min((stepMs / span) * plotW * 0.82, plotW));
      const slotW = bandPx / barCols.length;
      const rectW = Math.max(0.6, slotW * 0.86);
      barCols.forEach((c, ci) => {
        bars.set(
          c.id,
          c.pts
            .filter((p) => Number.isFinite(p.v))
            .map((p) => {
              const yv = Y(p.v);
              return { ms: p.ms, x: X(p.ms) - bandPx / 2 + ci * slotW, y: yv, w: rectW, h: Math.max(0, y0 - yv) };
            }),
        );
      });
    }

    // Union of REAL in-window dates (sorted) for crosshair snapping + x-ticks —
    // pts, not pathPts, so the synthetic boundary is never a snap target.
    const tsSet = new Set<number>();
    for (const c of cols) for (const p of c.pts) tsSet.add(p.ms);
    const unionTs = [...tsSet].sort((a, b) => a - b);

    return { s, e, span, plotW, plotH, lo, hi, X, Y, lines, bars, hasBars, unionTs, primary: lines[0] ?? null };
  }, [window0, visible, byId, mode, w, parsed]);

  // Live mirrors for the rAF flush and the native wheel listener. Both are
  // attached/created once per mount and would otherwise close over a stale
  // render — and re-attaching the listener on every window change would put us
  // straight back to per-event work.
  const modelRef = useRef(model);
  const window0Ref = useRef(window0);
  const fullRangeRef = useRef(fullRange);
  // Synced after commit, not during render: the wheel handler and the rAF flush
  // both read these only in response to user input, which is always after a
  // commit, so post-render is soon enough and keeps the render itself pure.
  useEffect(() => {
    modelRef.current = model;
    window0Ref.current = window0;
    fullRangeRef.current = fullRange;
  });
  /** Whether the <svg> the wheel binds to is mounted at all. */
  const hasPlot = loaded && !loadError && model != null;

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
    const [lo, hi] = fullRange;
    const [ws, we] = window0;
    // ⚠️ EXACT match, not the old `|days - preset| <= 2` span comparison. That
    // fuzz lit 90D for any window within two days of 90 — a hand-brushed ~89-day
    // window, or a preset window left stale after `fullRange` grew mid-load so it
    // no longer even ends at "now". A pill should light ONLY for the window
    // clicking it produces. EPS = 1h absorbs float; it's far tighter than a
    // brush's day-scale granularity, so only a real preset click matches.
    const EPS = 3_600_000;
    // Every preset ends at "now" (hi). If this window doesn't, none is active.
    if (Math.abs(we - hi) > EPS) return null;
    // ALL = the whole range.
    if (Math.abs(ws - lo) <= EPS) return "all";
    // A day-preset lights only if the window START is exactly hi − days, AND that
    // start sits inside the range (a preset clamped to `lo` is the ALL case above,
    // already returned).
    for (const r of RANGES) {
      if (r.days == null) continue;
      const start = hi - r.days * DAY;
      if (start > lo && Math.abs(ws - start) <= EPS) return r.key;
    }
    return null;
  }, [fullRange, window0]);

  /**
   * ⚠️ Wheel and mousemove are FIRE-HOSES — coalesce to one state commit per
   * frame, and never do per-event React work here again.
   *
   * A trackpad emits wheel events at ~100/sec and mousemove faster still. Both
   * handlers used to call setState on EVERY event, and each commit re-ran the
   * model (re-projecting and re-pathing every visible series). The main thread
   * couldn't retire a frame before the next ten events landed, the queue ran
   * away, and the tab died — which users hit as a crash and our own audits kept
   * hitting as unexplained "pane blackouts".
   *
   * The pending intent lives in a ref and one rAF applies it. Zoom is
   * ACCUMULATED (factors multiply) rather than last-write-wins, so coalescing a
   * flurry of ticks still zooms the full amount the user asked for — it just
   * arrives in a single render.
   */
  const wheelPending = useRef<{ factor: number; frac: number } | null>(null);
  const hoverPending = useRef<number | null>(null);
  const frame = useRef<number | null>(null);

  const flush = useCallback(() => {
    frame.current = null;

    const hv = hoverPending.current;
    hoverPending.current = null;
    if (hv != null) setHoverMs(hv);

    const wp = wheelPending.current;
    wheelPending.current = null;
    if (wp) {
      setWin((cur) => {
        // Read the window from state rather than a closure: several frames can
        // land between renders, and each must zoom from the PREVIOUS result or
        // the gesture stalls.
        const range = fullRangeRef.current;
        const base = cur ?? window0Ref.current;
        if (!range || !base) return cur;
        const [s, e] = base;
        const span = e - s;
        const focus = s + wp.frac * span;
        const ns = Math.max(3 * DAY, Math.min(range[1] - range[0], span * wp.factor));
        let na = focus - wp.frac * ns;
        let nb = na + ns;
        if (na < range[0]) { na = range[0]; nb = na + ns; }
        if (nb > range[1]) { nb = range[1]; na = nb - ns; }
        return [na, nb];
      });
    }
  }, [window0Ref, fullRangeRef]);

  const schedule = useCallback(() => {
    if (frame.current == null) frame.current = requestAnimationFrame(flush);
  }, [flush]);

  useEffect(() => {
    return () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, []);

  /**
   * The wheel listener is attached NATIVELY, non-passive, because React's
   * onWheel is registered passive at the root — preventDefault there is a no-op,
   * so the page scrolled *and* the chart zoomed at the same time.
   *
   * ⚠️ preventDefault ONLY when this event will actually zoom. Cancelling
   * unconditionally means that any time the chart can't zoom (no model yet, data
   * still loading) the wheel is swallowed and the page cannot be scrolled at all
   * — the cursor resting over a chart would wedge the whole page.
   */
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const onWheelNative = (ev: WheelEvent) => {
      if (!modelRef.current || !fullRangeRef.current || !window0Ref.current) return; // let the page scroll
      ev.preventDefault();
      const rect = el.getBoundingClientRect();
      if (!rect.width) return;
      const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const factor = ev.deltaY < 0 ? 0.82 : 1.2;
      wheelPending.current = {
        factor: (wheelPending.current?.factor ?? 1) * factor,
        frac,
      };
      schedule();
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
    // hasPlot, not `model`: the <svg> this binds to only exists while there's a
    // model, so the effect must re-run when it mounts or remounts (remove every
    // chip, add one back) — otherwise the listener stays bound to a detached node
    // and the wheel goes dead. Keyed on presence, not identity, so a zoom doesn't
    // re-attach on every frame.
  }, [schedule, hasPlot]);

  // Crosshair — same coalescing; the maths is deferred to the frame.
  const onMove = (ev: React.MouseEvent) => {
    const m = modelRef.current;
    if (!m) return;
    const rect = plotRef.current!.getBoundingClientRect();
    if (!rect.width) return;
    const frac = Math.max(
      0,
      Math.min(1, (ev.clientX - rect.left - (PAD.l / w) * rect.width) / ((m.plotW / w) * rect.width)),
    );
    hoverPending.current = m.s + frac * m.span;
    schedule();
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

  /**
   * Each visible series' own reading at the crosshair — the NEAREST FINITE point,
   * snapped per series and returned whole, so the dot can be drawn where that
   * point actually lives.
   *
   * ⚠️ The crosshair does NOT resolve to one shared date, and must not go back to
   * doing so. V-MKT is weekly (and NaN-gapped) while the spine series are daily,
   * so "this series' value at the crosshair's date" had to borrow a neighbouring
   * bucket's value — and the dot, drawn at the crosshair's x with that borrowed
   * y, floated off its own line. A dot is only ever truthful at a point the line
   * genuinely passes through, which is why this returns the point, not a number.
   * (The paths are monotone-cubic, an interpolating spline: it passes exactly
   * through its inputs, so a dot at a real point's (x,y) is on the curve by
   * construction. Any y computed some other way floats.)
   *
   * Reach is the series' OWN sampling step, so "nearest" can't stretch across a
   * real hole: ~0.75d for a daily series, ~5d for a weekly one. Beyond it the
   * series has no reading here and gets no dot and no tooltip row.
   */
  const snapped = useMemo(() => {
    const out = new Map<string, { ms: number; v: number; raw: number }>();
    if (hoverTs == null || !model) return out;
    for (const L of model.lines) {
      let best: { ms: number; v: number; raw: number } | null = null;
      let bd = Infinity;
      for (const p of L.pts) {
        if (!Number.isFinite(p.v)) continue;
        const d = Math.abs(p.ms - hoverTs);
        if (d < bd) { bd = d; best = p; }
      }
      if (best && bd <= L.step * 0.75) out.set(L.id, best);
    }
    return out;
  }, [hoverTs, model]);

  const title =
    visible.length === 0
      ? "No metrics"
      : `${byId.get(visible[0])?.name ?? "—"}${visible.length > 1 ? ` + ${visible.length - 1} more` : ""}`;
  /** The mode line the header shows — and, verbatim, what the PNG must say about
   *  itself: a rebased chart read as absolute dollars is a real misreading. */
  const modeLine = mode === "rebase" ? "rebased · 100 at window start" : "absolute values";

  /**
   * The date a series' latest reading is FROM, but only when that's meaningfully
   * behind the window edge — else null (the number is current, no date needed).
   * A daily series lagging the spine by a day stays undated; a weekly one, days
   * behind by construction, gets its own date so its value isn't misread as today.
   */
  const endpointDate = (lastMs: number): string | null =>
    model && model.e - lastMs > 1.5 * DAY ? fmtDate(lastMs) : null;

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
      // Exact date matches only. This used to carry a weekly series' value across
      // the ~7 daily rows around it, which exported V-MKT as if it were sampled
      // daily; a blank says "no reading that day", which is what's true.
      const cells = cols.map((c) => {
        const p = c.pts.find((q) => q.ms === ms);
        if (!p || !Number.isFinite(p.v)) return "";
        return mode === "rebase" ? p.v.toFixed(3) : p.raw.toFixed(2);
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
  /**
   * PNG export — a SELF-DESCRIBING image, not a screenshot of the plot.
   *
   * The plot alone travels badly: pasted into a deck or a group chat it's a set
   * of unlabelled lines with no scale, no dates, and no way back to the source.
   * So the export wraps the live plot in chrome that only exists in the file:
   * what it is, whether it's rebased, what window it covers, which line is which
   * and where each one ended, plus the mark and the URL.
   *
   * ⚠️ The chrome is drawn into the EXPORT svg only — never into the live DOM,
   * which must keep rendering exactly as it does now.
   *
   * ⚠️ Everything added here uses LITERAL colours. This SVG is rasterized through
   * an <img>, which is its own document with no access to this page's :root, so
   * `var(--…)` resolves to nothing — strokes vanish, fills go black. The existing
   * plot markup DOES use var(), which is why it still has to be run through
   * `inlineVars` below; new chrome shouldn't add to that debt. Same reason
   * src/lib/brand.ts keeps its palette in literal hex.
   */
  const exportPng = () => {
    const svg = plotRef.current;
    if (!svg || !model) return;
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

    // Serialize a COPY, minus its opaque background plate, so the watermark can
    // sit under the series rather than being buried by it. Cloning keeps the live
    // chart untouched; selecting by data attribute keeps this from silently
    // grabbing the wrong rect if the markup order ever changes.
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.querySelector("[data-plot-bg]")?.remove();
    const plotXml = inlineVars(new XMLSerializer().serializeToString(clone))
      .replace(/^<svg[^>]*>/, "")
      .replace(/<\/svg>$/, "");

    // Legend: every VISIBLE series (model.lines is already the visible set), each
    // with the value it ends the window on — the same figure its chip shows.
    const legend = model.lines.map((L) => {
      const last = L.pts.filter((p) => Number.isFinite(p.v)).at(-1);
      return {
        color: L.item.color,
        text: `${L.item.ticker} ${
          last ? (mode === "rebase" ? last.v.toFixed(1) : fmtVal(L.item.unit, last.raw)) : "—"
        }`,
      };
    });
    // Flow the legend onto as many rows as it needs and let the header grow —
    // a dozen added metrics must not spill off the canvas. Width is estimated
    // from the character count because there's nothing to measure against in a
    // document that doesn't exist yet; MONO_CH is deliberately generous.
    const MONO_CH = 6.2;
    const SWATCH = 7;
    let cx = EXPORT_PAD;
    let row = 0;
    const placed = legend.map((item) => {
      const wide = SWATCH + 4 + item.text.length * MONO_CH;
      if (cx > EXPORT_PAD && cx + wide > w - EXPORT_PAD) {
        cx = EXPORT_PAD;
        row += 1;
      }
      const at = { ...item, x: cx, row };
      cx += wide + 13;
      return at;
    });
    const headH = LEGEND_TOP + (row + 1) * LEGEND_ROW_H + 6;
    const exportH = headH + PH + FOOTER_H;

    const wm = watermark(w, headH + PH / 2);
    const chrome = `
      <text x="${EXPORT_PAD}" y="21" fill="#f2f2f3" font-size="15" font-weight="700" font-family="'Inter', sans-serif">${esc(title)}</text>
      <text x="${EXPORT_PAD}" y="36" fill="#8a8a92" font-size="10.5" font-family="'JetBrains Mono', monospace">${esc(
        `${modeLine} · ${fmtDateY(model.s)} – ${fmtDateY(model.e)}`,
      )}</text>
      ${placed
        .map(
          (p) =>
            `<rect x="${p.x}" y="${LEGEND_TOP + p.row * LEGEND_ROW_H - SWATCH}" width="${SWATCH}" height="${SWATCH}" fill="${p.color}"/>` +
            `<text x="${p.x + SWATCH + 4}" y="${LEGEND_TOP + p.row * LEGEND_ROW_H}" fill="#c9c9cf" font-size="10.5" font-family="'JetBrains Mono', monospace">${esc(p.text)}</text>`,
        )
        .join("")}
      <text x="${w - EXPORT_PAD}" y="${exportH - 9}" fill="#5a5a63" font-size="10" text-anchor="end" font-family="'JetBrains Mono', monospace">${esc(EXPORT_HOST)}</text>`;

    const data = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 2}" height="${exportH * 2}" viewBox="0 0 ${w} ${exportH}">` +
        `<rect width="${w}" height="${exportH}" fill="#0a0a0c"/>` +
        wm +
        `<g transform="translate(0 ${headH})">${plotXml}</g>` +
        chrome +
        `</svg>`,
    )}`;

    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = w * 2;
      cv.height = exportH * 2;
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
          // The value is "as of" the last point, which for a weekly line (or any
          // series the spine hasn't caught up on) is behind the window edge. Date
          // it so 139.6 doesn't read as today's number.
          const asOf = last ? endpointDate(last.ms) : null;
          const off = hidden.has(id);
          const title = `${item.name}${item.weekly ? " · weekly series" : ""}${asOf ? ` · latest ${asOf}` : ""}`;
          return (
            <span
              key={id}
              title={title}
              className={`inline-flex items-center gap-1.5 rounded-none border border-line bg-bg-2 px-2 py-1 text-[12px] transition-opacity ${off ? "opacity-40" : ""}`}
            >
              <span className="h-2 w-2 shrink-0 rounded-md" style={{ background: item.color }} />
              <button type="button" className="font-mono font-semibold tracking-[0.01em] text-ink-2 hover:text-ink" onClick={() => toggleMetric(id)}>
                {item.ticker}
              </button>
              {item.weekly && (
                <span className="rounded-sm bg-bg-3 px-1 py-px font-mono text-[8.5px] uppercase leading-none tracking-[0.08em] text-ink-4">
                  wk
                </span>
              )}
              <span className="font-mono text-[11px] text-ink-3">
                {cur}
                {asOf && <span className="text-ink-4"> · {asOf}</span>}
              </span>
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
          // No onWheel prop: React registers wheel PASSIVE at the root, so
          // preventDefault there silently does nothing and the page scrolled
          // while the chart zoomed. The listener is attached natively above.
          <svg ref={plotRef} viewBox={`0 0 ${w} ${PH}`} width="100%" height={PH} className="block" onMouseMove={onMove}>
            {/* data-plot-bg: the PNG export drops THIS rect from its copy so the
                watermark can sit under the series instead of being painted over
                by an opaque plate. Renders identically either way. */}
            <rect data-plot-bg="" x={0} y={0} width={w} height={PH} fill="#0a0a0c" />
            {/* Grid gradients: the boards fade their hairline grid out at the
                edges rather than butting it against the frame.
                ⚠️ gradientUnits MUST be userSpaceOnUse — the default
                objectBoundingBox degenerates on a horizontal <line> (zero-height
                bbox) and the stroke would not paint at all. */}
            <defs>
              <linearGradient id="is-grid" gradientUnits="userSpaceOnUse" x1={PAD.l} y1={0} x2={w - PAD.r} y2={0}>
                <stop offset="0%" stopColor="var(--color-line)" stopOpacity={0} />
                <stop offset="10%" stopColor="var(--color-line)" stopOpacity={1} />
                <stop offset="90%" stopColor="var(--color-line)" stopOpacity={1} />
                <stop offset="100%" stopColor="var(--color-line)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="is-grid-base" gradientUnits="userSpaceOnUse" x1={PAD.l} y1={0} x2={w - PAD.r} y2={0}>
                <stop offset="0%" stopColor="var(--color-line-2)" stopOpacity={0} />
                <stop offset="8%" stopColor="var(--color-line-2)" stopOpacity={1} />
                <stop offset="92%" stopColor="var(--color-line-2)" stopOpacity={1} />
                <stop offset="100%" stopColor="var(--color-line-2)" stopOpacity={0} />
              </linearGradient>
              {/* Soft bloom under the primary series, in its own colour (lime for
                  V-MKT). Drawn as a shadow so the crisp line still reads on top. */}
              {model.primary && (
                <filter id="is-glow" x="-10%" y="-25%" width="120%" height="150%">
                  <feDropShadow
                    dx="0"
                    dy="0"
                    stdDeviation="3"
                    floodColor={model.primary.item.color}
                    floodOpacity="0.5"
                  />
                </filter>
              )}
              {/* Bar hover bloom — self-coloured: blur the bar and merge it under a
                  crisp copy, so it glows in each series' OWN colour (a fixed
                  floodColor can't match grouped bars). Applied to the hovered
                  date's whole bar group, the MetricBarCard emphasis idiom. */}
              {model.hasBars && (
                <filter id="is-bar-glow" x="-80%" y="-45%" width="260%" height="190%">
                  <feGaussianBlur in="SourceGraphic" stdDeviation="2.4" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              )}
            </defs>
            {/* grid + y labels */}
            {Array.from({ length: 6 }, (_, g) => {
              const v = model.lo + ((model.hi - model.lo) * g) / 5;
              const y = model.Y(v);
              const is100 = mode === "rebase" && Math.abs(v - 100) < (model.hi - model.lo) / 10;
              return (
                <g key={g}>
                  <line x1={PAD.l} x2={w - PAD.r} y1={y} y2={y} stroke={is100 ? "url(#is-grid-base)" : "url(#is-grid)"} strokeDasharray={is100 ? "4 3" : "2 5"} />
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
            {/* primary area — lines only; a bar primary (e.g. a platform total in
                absolute mode) gets no area fill, it's already a solid bar. */}
            {model.primary?.path && !(mode === "abs" && model.primary.item.flow) && (
              <>
                <defs>
                  <linearGradient id="is-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={model.primary.item.color} stopOpacity={0.16} />
                    <stop offset="100%" stopColor={model.primary.item.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                {(() => {
                  // Close under the PATH points (boundary included) so the fill
                  // reaches the window edge with the line, not the first real point.
                  const fp = model.primary.pathPts.filter((p) => Number.isFinite(p.v));
                  if (fp.length < 2) return null;
                  const area = `${model.primary.path}L${model.X(fp[fp.length - 1].ms).toFixed(1)} ${(PAD.t + model.plotH).toFixed(1)}L${model.X(fp[0].ms).toFixed(1)} ${(PAD.t + model.plotH).toFixed(1)}Z`;
                  return <path d={area} fill="url(#is-area)" />;
                })()}
              </>
            )}
            {/* series — flow columns as grouped bars in absolute mode, everything
                else as a line with an endpoint dot */}
            {model.lines.map((L) => {
              if (mode === "abs" && L.item.flow) {
                const rects = model.bars.get(L.id) ?? [];
                return (
                  <g key={L.id}>
                    {rects.map((r, i) => {
                      // The hovered DATE's bars (across every bar series) brighten
                      // to full opacity + a self-coloured bloom — the group glows.
                      const on = hoverTs != null && r.ms === hoverTs;
                      return (
                        <rect
                          key={i}
                          x={r.x}
                          y={r.y}
                          width={r.w}
                          height={r.h}
                          fill={L.item.color}
                          opacity={on ? 1 : 0.9}
                          filter={on ? "url(#is-bar-glow)" : undefined}
                          shapeRendering="crispEdges"
                        />
                      );
                    })}
                  </g>
                );
              }
              const fp = L.pts.filter((p) => Number.isFinite(p.v));
              const end = fp[fp.length - 1];
              const isPrim = L.id === model.primary?.id;
              return (
                <g key={L.id}>
                  <path d={L.path} fill="none" stroke={L.item.color} strokeWidth={isPrim ? 2.3 : 1.7} strokeDasharray={L.item.dash ? "5 4" : undefined} strokeOpacity={L.item.dash ? 0.9 : 1} strokeLinejoin="round" strokeLinecap="round" filter={isPrim ? "url(#is-glow)" : undefined} />
                  {end && <circle cx={model.X(end.ms)} cy={model.Y(end.v)} r={isPrim ? 3.2 : 2.5} fill={L.item.color} stroke="#0a0a0c" strokeWidth={1.3} />}
                </g>
              );
            })}
            {/* primary end-value label */}
            {model.primary && (() => {
              const end = model.primary.pts.filter((p) => Number.isFinite(p.v)).at(-1);
              if (!end) return null;
              const y = model.Y(end.v);
              // Same honesty as the chip: if the primary's last point is behind
              // the window edge, print the date it's actually from under the value.
              const asOf = endpointDate(end.ms);
              return (
                <g>
                  <rect x={w - PAD.r + 2} y={y - 8} width={PAD.r - 4} height={asOf ? 26 : 16} fill="#0a0a0c" />
                  <text x={w - PAD.r + 6} y={y + 3} fontSize={11} fontWeight={700} fill={model.primary.item.color} fontFamily="var(--font-jetbrains-mono), monospace">
                    {mode === "rebase" ? end.v.toFixed(1) : fmtVal(model.primary.item.unit, end.raw)}
                  </text>
                  {asOf && (
                    <text x={w - PAD.r + 6} y={y + 15} fontSize={8.5} fill="var(--color-ink-4)" fontFamily="var(--font-jetbrains-mono), monospace">
                      {asOf}
                    </text>
                  )}
                </g>
              );
            })()}
            {/* crosshair — the line marks the hovered DATE; each dot sits on its own
                series' nearest real point, which for a weekly series means slightly
                off the line. That offset is the honest reading: it's where the line
                actually has a value. */}
            {hoverTs != null && (
              <g>
                <line x1={model.X(hoverTs)} x2={model.X(hoverTs)} y1={PAD.t} y2={PAD.t + model.plotH} stroke="var(--color-line-2)" strokeDasharray="3 3" />
                {model.lines.map((L) => {
                  // Bar series brighten their own hovered group instead of carrying
                  // a floating crosshair dot — dots are for line series only.
                  if (mode === "abs" && L.item.flow) return null;
                  const p = snapped.get(L.id);
                  return p == null ? null : <circle key={L.id} cx={model.X(p.ms)} cy={model.Y(p.v)} r={3.2} fill={L.item.color} stroke="#0a0a0c" strokeWidth={1.3} />;
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
              .map((L) => ({ L, p: snapped.get(L.id) }))
              .filter((r): r is { L: (typeof model.lines)[number]; p: { ms: number; v: number; raw: number } } => r.p != null)
              .sort((a, b) => b.p.v - a.p.v)
              .map(({ L, p }) => (
                <div key={L.id} className="flex items-center justify-between gap-3 py-0.5">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-none" style={{ background: L.item.color }} />
                    <span className="font-mono text-[11px] text-ink-2">{L.item.ticker}</span>
                    {/* A weekly line has no reading on most daily crosshair dates.
                        Name the day this number IS from rather than letting the
                        header's date imply it. */}
                    {p.ms !== hoverTs ? (
                      <span className="font-mono text-[10px] text-ink-4">{fmtDate(p.ms)}</span>
                    ) : null}
                  </span>
                  <span className="font-mono font-semibold tabular text-ink">
                    {mode === "rebase" ? p.v.toFixed(1) : fmtVal(L.item.unit, p.raw)}
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
                // For index-unit rows (our indices AND the benchmarks) the bare
                // "index" tag said nothing — both groups carried it, and it read
                // as if BTC were one of our indices. Show the CADENCE instead,
                // which is the useful distinction there; usd/count rows keep their
                // unit, which is more informative than "daily".
                const tag = on
                  ? "added"
                  : c.unit === "index"
                    ? c.weekly
                      ? "weekly"
                      : "daily"
                    : c.unit;
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
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-ink-4">{tag}</span>
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

// ── PNG export chrome ─────────────────────────────────────────────────────────
// Geometry for the band above the plot and the strip below it. Only the export
// uses these; the live chart has its own header in the DOM.
const EXPORT_PAD = 14;
const LEGEND_TOP = 55;
const LEGEND_ROW_H = 15;
const FOOTER_H = 24;

/** The host, derived — never hardcoded. Moving the domain is an env change
 *  (see src/lib/site.ts); an export that hardcoded it would keep pointing at the
 *  old one long after the site moved. */
const EXPORT_HOST = SITE_ORIGIN.replace(/^https?:\/\//, "");

/** XML-escape text bound for the export SVG. Load-bearing, not defensive: the
 *  DEFAULT chart carries "S&P 500", and a bare & makes the whole document
 *  unparseable — the image fails to decode and the download silently dies. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The VARIBLE lockup, ghosted into the plot's background — the mark and wordmark
 * straight from the brand SSOT, so a revision to the artwork reaches the exports
 * without anyone remembering this file exists.
 *
 * Colours are literal (lime mark, white wordmark — the on-dark lockup) because
 * this is rasterized where var() resolves to nothing. The paths live in the
 * artwork's own coordinate space, so they're scaled and re-origined off the
 * SSOT's viewBox rather than any number copied out of it.
 */
function watermark(plotW: number, centerY: number): string {
  const [vx, vy, vw] = BRAND_LOCKUP_VIEWBOX.split(/\s+/).map(Number);
  const targetW = plotW * 0.42;
  const s = targetW / vw;
  const targetH = targetW / BRAND_LOCKUP_ASPECT;
  const tx = (plotW - targetW) / 2;
  const ty = centerY - targetH / 2;
  return (
    `<g opacity="0.07" transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(5)}) translate(${-vx} ${-vy})">` +
    `<path d="${BRAND_LOCKUP_MARK_PATH}" fill="${BRAND_LIME}"/>` +
    `<path d="${BRAND_LOCKUP_WORDMARK_PATH}" fill="#ffffff"/>` +
    `</g>`
  );
}

// ── pure helpers ──────────────────────────────────────────────────────────────
/**
 * Linear value of a series at `target` ms, interpolated between the two real
 * points that bracket it. The common rebase anchor: it lets a weekly series be
 * valued at the window start (which falls BETWEEN its points) on the same date as
 * the daily series around it.
 *
 * `pts` must be finite + ascending (the `parsed` memo guarantees both). Returns:
 *   • null when `target` is before the first point — a series with no reading at
 *     the window start can't be anchored there; the caller degrades to its first
 *     in-window point and draws no boundary segment.
 *   • the last value when `target` is at/after the last point (a flat carry, but
 *     that case doesn't arise for the anchor: if the series ended before the
 *     window start it has no in-window points to draw).
 * This is used ONLY for the anchor and the boundary segment — never surfaced as a
 * data point, so no interpolated value is ever hoverable or exported.
 */
function interpAt(pts: { ms: number; value: number }[], target: number): number | null {
  const n = pts.length;
  if (!n || target < pts[0].ms) return null;
  if (target >= pts[n - 1].ms) return pts[n - 1].value;
  for (let i = 1; i < n; i++) {
    if (pts[i].ms === target) return pts[i].value;
    if (pts[i].ms > target) {
      const a = pts[i - 1];
      const b = pts[i];
      const dt = b.ms - a.ms;
      return dt > 0 ? a.value + ((target - a.ms) / dt) * (b.value - a.value) : a.value;
    }
  }
  return pts[n - 1].value;
}

/** A series' own sampling step: the MEDIAN gap between consecutive points (~1d
 *  for the daily spine, ~7d for the weekly indices). Median, not mean, so one
 *  long hole in an otherwise-daily series doesn't inflate the crosshair's reach
 *  and let it snap across that hole. */
function medianStep(pts: { ms: number }[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const g = pts[i].ms - pts[i - 1].ms;
    if (g > 0) gaps.push(g);
  }
  if (!gaps.length) return DAY;
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1] || DAY;
}

function xTicks(s: number, e: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < 5; k++) out.push(s + ((e - s) * k) / 4);
  return out;
}
function axisLabel(lines: { item: CatalogItem }[], v: number): string {
  const units = new Set(lines.map((l) => l.item.unit));
  if (units.size === 1) {
    const u = [...units][0];
    return u === "usd"
      ? formatCompactUsd(v)
      : u === "count"
        ? formatCompactNumber(v)
        : u === "percent"
          ? `${v.toFixed(0)}%`
          : v.toFixed(0);
  }
  return Math.abs(v) >= 1000 ? formatCompactUsd(v) : formatCompactNumber(v);
}
