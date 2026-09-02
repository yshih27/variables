/**
 * The Index Studio's CATALOG — what series exist, what they are called, and the
 * numbers behind them. Extracted from the component so ONE implementation serves
 * two callers with different transports:
 *
 *   • the browser, over /api/internal/chart/* (the original path), and
 *   • the warmer, calling the readers directly to precompute a seed bundle.
 *
 * ⚠️ SHARED ON PURPOSE — DO NOT FORK IT. The precomputed bundle and the live
 * route must agree to the last gated day. Every honesty rule this catalog encodes
 * — the <2-point cull, "populated keys only", days with no market total carrying
 * no share rather than a fabricated 0%, an average trade that is dropped rather
 * than shown as $0 — lives here once. A second copy in the warmer would drift,
 * and the first symptom would be a chart that disagrees with itself depending on
 * whether the page was served warm or cold.
 *
 * Transport enters through `ChartLoader` and nothing else: this module performs no
 * I/O and imports nothing server-only, so the client bundle can keep importing it.
 */
import { indexRegistry } from "@/lib/indices/naming";
import { IP_CATALOG, OTHER_IP } from "@/lib/data/ipCatalog";
import { PLATFORM_SOURCES } from "@/lib/data/sources";

export type Unit = "index" | "usd" | "count" | "percent";
export type SeriesPoint = { ts: string; value: number };
export type CatalogItem = {
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

export const DEFAULT_ACTIVE = ["idx:market:total", "bench:BTC", "bench:ETH", "bench:SOL", "bench:SP500"];

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
export const SCOPE_KEEP = new Set(["idx:market:total"]);

export function inScope(id: string, scope: StudioScope): boolean {
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
export function scopedDefaultActive(scope: StudioScope): string[] {
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

// The picker iterates whatever keys come back (so a backend-added symbol like SOL
// shows up with zero FE edits) and looks each up here; an unknown symbol falls
// back to itself for ticker/name and a palette colour. SOL is pre-seeded because
// it's the known incoming one — a courtesy, not a requirement for it to appear.
export const BENCH_COLOR: Record<string, string> = {
  BTC: "#e8993a",
  ETH: "#8b93c9",
  SP500: "#9aa0ab",
  NASDAQ: "#6fb0c9",
  GOLD: "#c8a951",
  SOL: "#14f195", // Solana green
};
export const BENCH_TICKER: Record<string, string> = { SP500: "S&P 500", NASDAQ: "NASDAQ" };
export const BENCH_NAME: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SP500: "S&P 500",
  NASDAQ: "Nasdaq Composite",
  GOLD: "Gold",
  SOL: "Solana",
};
export const PALETTE = [
  "#5fa3ff", "#2bd6a0", "#ff6b9d", "#a18cff", "#4ade80", "#22d3ee",
  "#fb7185", "#c084fc", "#38bdf8", "#fbbf24", "#f97316", "#a3e635", "#e879f9", "#7dd3fc",
];

export const IP_NAME: Record<string, string> = Object.fromEntries(
  [...IP_CATALOG, OTHER_IP].map((ip) => [ip.key, ip.name]),
);
export const PLATFORM_NAME: Record<string, string> = Object.fromEntries(
  PLATFORM_SOURCES.map((p) => [p.key, p.name]),
);

/** IP short code (PKM, OP…) derived from the naming SSOT ticker (strip the V- prefix). */
export function ipShort(key: string): string {
  const reg = indexRegistry().find((r) => r.entity === "ip" && r.key === key);
  return (reg?.ticker ?? key).replace(/^V-/, "");
}
export function platShort(key: string): string {
  return key.split("-").map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 3) || key.slice(0, 3).toUpperCase();
}
export function titleize(key: string): string {
  return key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
/** Lowercase + strip diacritics so a search for "pokemon" matches "Pokémon". */
export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");



/**
 * How the catalog gets its numbers. The browser implements this over HTTP; the
 * warmer implements it against the readers. Both return the SAME shapes the
 * /api/internal/chart/* routes return, because those routes are thin wrappers
 * over exactly these reads.
 */
export type ChartLoader = {
  index(params: { entity: string; key: string; kind: string; from: string; freq: string }): Promise<Record<string, unknown>>;
  benchmarks(params: { from: string; freq: string }): Promise<Record<string, unknown>>;
  series(params: { entity: string; metric: string; from: string }): Promise<Record<string, unknown>>;
};

/**
 * Map with bounded concurrency, preserving input order.
 *
 * Only the HTTP loader needs the bound — the direct loader is already sequential
 * against Postgres — but the builder is transport-agnostic, so the cap lives here
 * and costs the server nothing.
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
export const SPINE_FAMILIES: { entity: string; metric: string; group: string; unit: Unit; short: string; label: string }[] = [
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
export const FLOW_METRICS = new Set(["volume_usd", "gacha_volume_usd", "cards_traded", "trades", "active_wallets"]);


/** Build the picker catalog from real availability + prefetch every series' data. */
export async function buildStudioCatalog(load: ChartLoader): Promise<{ items: CatalogItem[]; data: Map<string, SeriesPoint[]> }> {
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
      const d = await load.index({
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
    const bd = await load.benchmarks({ from: "2000-01-01", freq: "daily" });
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
        const d = await load.series({ entity: f.entity, metric: f.metric, from: "2000-01-01" });
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
