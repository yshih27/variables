import type { IPRow, Trend } from "@/lib/types";
import type { SeriesPoint } from "@/lib/data/metricSnapshots";

/**
 * Category rollups for the /ips overview.
 *
 * The backend is per-IP only — there are no category-level aggregates yet — so
 * we fold the IP rows into TCG / Sports / Other here. The taxonomy below mirrors
 * IPTable's facet map VERBATIM; it's the one thing that should later move into
 * ipCatalog.ts as the single source of truth, at which point this reads an
 * `ip.category` field instead. Until then, keep the two maps in sync.
 *
 * Pure + dependency-light (type-only imports) so it can run anywhere; the page
 * supplies the per-IP spine series for trends + momentum.
 */

export type CategoryGroup = "TCG" | "Sports" | "Other";
export const CATEGORY_GROUPS: CategoryGroup[] = ["TCG", "Sports", "Other"];

const TCG_KEYS = new Set(["pokemon", "one_piece", "yugioh", "magic", "lorcana", "dragon_ball", "veefriends"]);
const SPORTS_KEYS = new Set(["basketball", "baseball", "football", "soccer", "hockey", "f1"]);

export function categoryGroup(key: string): CategoryGroup {
  if (TCG_KEYS.has(key)) return "TCG";
  if (SPORTS_KEYS.has(key)) return "Sports";
  return "Other";
}

/** Brand color per group — avoids yellow (UI accent) and green (positive Δ). */
export const CATEGORY_COLOR: Record<CategoryGroup, string> = {
  TCG: "#5fa3ff",
  Sports: "#2bd6a0",
  Other: "#a18cff",
};

export type CategoryAggregate = {
  group: CategoryGroup;
  color: string;
  /** IPs with real data (qualified market cap or any 24h volume). */
  ipCount: number;
  cards: number;
  mcapUsd: number;
  /** Share of total qualified market cap, percent. */
  sharePct: number;
  vol24Usd: number;
  vol7Usd: number;
  trades24h: number;
  holders: number;
  /** 24h volume ÷ market cap, percent — the liquidity read. null when mcap 0. */
  turnoverPct: number | null;
  /** 7d change in daily volume from the spine, percent. null without enough
   *  history OR when the look-back base is too small to be meaningful. */
  mom7dPct: number | null;
  /** Category daily volume, last ~30d (oldest→newest) for the row sparkline. */
  spark: number[];
  trend: Trend;
};

/**
 * Suppress meaningless market caps (mirrors IPTable's `mcapValue`) so category
 * totals match the treemap + leaderboard exactly: a finite value ≥ $1k and ≥ 5
 * cards, else it contributes 0.
 */
function qualifiedMcap(ip: IPRow): number {
  if (!Number.isFinite(ip.mcapUsd) || ip.mcapUsd < 1000 || ip.cards < 5) return 0;
  return ip.mcapUsd;
}

const fin = (n: number) => (Number.isFinite(n) ? n : 0);

/** Sum several daily series by UTC-day ts → one series (oldest→newest). */
function sumSeriesByDay(lists: SeriesPoint[][]): SeriesPoint[] {
  const acc = new Map<string, number>();
  for (const s of lists) for (const p of s) acc.set(p.ts, (acc.get(p.ts) ?? 0) + p.value);
  return [...acc.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([ts, value]) => ({ ts, value }));
}

/**
 * % change vs the point nearest `daysAgo` days back (by ts, tolerates gaps).
 * `minBase` floors the look-back value so a near-zero base can't print a garbage
 * percentage (e.g. $1 → $159 reading as +15,800%). Mirrors metricSnapshots.pctChange.
 */
function pctChangeDays(series: SeriesPoint[], daysAgo: number, minBase = 0): number | null {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  if (!Number.isFinite(last.value)) return null;
  const targetMs = Date.parse(last.ts) - daysAgo * 86_400_000;
  let prev: SeriesPoint | null = null;
  for (const p of series) {
    if (Date.parse(p.ts) <= targetMs) prev = p;
    else break;
  }
  if (!prev || !Number.isFinite(prev.value) || prev.value < minBase || prev.value === 0) return null;
  return ((last.value - prev.value) / prev.value) * 100;
}

/** $/day look-back floor for category volume momentum. */
const MOMENTUM_MIN_BASE = 1000;

function trendFromSpark(s: number[]): Trend {
  if (s.length < 4) return "flat";
  const mid = Math.floor(s.length / 2);
  const a = s.slice(0, mid).reduce((x, y) => x + y, 0);
  const b = s.slice(mid).reduce((x, y) => x + y, 0);
  const denom = a + b;
  if (denom === 0) return "flat";
  if (Math.abs(b - a) < denom * 0.05) return "flat";
  return b > a ? "up" : "down";
}

/**
 * Fold IP rows into category aggregates. Pass the per-IP `volume_usd` spine
 * series (keyed by IP key) to compute the sparkline + 7d momentum; omit it and
 * both are empty/null.
 */
export function rollupByCategory(
  rows: IPRow[],
  volSeriesByIp?: Record<string, SeriesPoint[]>,
): CategoryAggregate[] {
  const totalMcap = rows.reduce((s, ip) => s + qualifiedMcap(ip), 0) || 1;

  const out: CategoryAggregate[] = [];
  for (const group of CATEGORY_GROUPS) {
    const members = rows.filter((ip) => categoryGroup(ip.key) === group);
    if (members.length === 0) continue;

    const mcapUsd = members.reduce((s, ip) => s + qualifiedMcap(ip), 0);
    const vol24Usd = members.reduce((s, ip) => s + fin(ip.vol24Usd), 0);
    const vol7Usd = members.reduce((s, ip) => s + fin(ip.vol7Usd), 0);
    const trades24h = members.reduce((s, ip) => s + fin(ip.trades24h), 0);
    const holders = members.reduce((s, ip) => s + fin(ip.holders), 0);
    const cards = members.reduce((s, ip) => s + fin(ip.cards), 0);
    const ipCount = members.filter((ip) => qualifiedMcap(ip) > 0 || fin(ip.vol24Usd) > 0).length;

    let spark: number[] = [];
    let mom7dPct: number | null = null;
    if (volSeriesByIp) {
      const cs = sumSeriesByDay(members.map((ip) => volSeriesByIp[ip.key] ?? []));
      spark = cs.slice(-30).map((p) => p.value);
      mom7dPct = pctChangeDays(cs, 7, MOMENTUM_MIN_BASE);
    }
    const trend: Trend =
      mom7dPct != null ? (mom7dPct > 0.5 ? "up" : mom7dPct < -0.5 ? "down" : "flat") : trendFromSpark(spark);

    out.push({
      group,
      color: CATEGORY_COLOR[group],
      ipCount,
      cards,
      mcapUsd,
      sharePct: (mcapUsd / totalMcap) * 100,
      vol24Usd,
      vol7Usd,
      trades24h,
      holders,
      turnoverPct: mcapUsd > 0 ? (vol24Usd / mcapUsd) * 100 : null,
      mom7dPct,
      spark,
      trend,
    });
  }

  return out.sort((a, b) => b.mcapUsd - a.mcapUsd);
}

/** `group` is a free string so this shape is reusable for platform trends too.
 *  `benchmark` marks an external reference line (BTC/S&P/…) so the chart can draw
 *  it dashed and default it off (QA-6). */
export type CategoryTrendDataset = {
  group: string;
  color: string;
  points: number[];
  benchmark?: boolean;
  /** Varible Index ticker (e.g. "V-PKM") for internal index series; the legend
   *  shows this while the tooltip keeps the full `group` name. Absent on
   *  benchmarks + non-index series. */
  ticker?: string;
};
export type CategoryTrend = { labels: string[]; datasets: CategoryTrendDataset[] };

/**
 * Align per-IP spine series into one daily series per category over a shared
 * timeline (oldest→newest), ready for a stacked chart.
 *
 * `fill` controls how a category's missing days are filled:
 *   • "zero" — flow metrics (volume): a day with no trades is genuinely 0.
 *   • "hold" — stock metrics (market cap): carry forward the last reading; a gap
 *     means "unknown", never a drop to $0 (which would gut the stack).
 */
export function buildCategoryTrend(
  rows: IPRow[],
  seriesByIp: Record<string, SeriesPoint[]>,
  fill: "zero" | "hold",
): CategoryTrend {
  const tsSet = new Set<string>();
  for (const ip of rows) for (const p of seriesByIp[ip.key] ?? []) tsSet.add(p.ts);
  const labels = [...tsSet].sort();
  const idx = new Map(labels.map((ts, i) => [ts, i]));

  const densify = (series: SeriesPoint[]): number[] => {
    const arr = new Array<number>(labels.length).fill(NaN);
    for (const p of series) {
      const i = idx.get(p.ts);
      if (i != null && Number.isFinite(p.value)) arr[i] = p.value;
    }
    if (fill === "hold") {
      let last = 0;
      for (let i = 0; i < arr.length; i++) {
        if (Number.isFinite(arr[i])) last = arr[i];
        else arr[i] = last;
      }
    } else {
      for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) arr[i] = 0;
    }
    return arr;
  };

  const datasets: CategoryTrendDataset[] = [];
  for (const group of CATEGORY_GROUPS) {
    const members = rows.filter((ip) => categoryGroup(ip.key) === group);
    if (members.length === 0) continue;
    const points = new Array<number>(labels.length).fill(0);
    for (const ip of members) {
      const dense = densify(seriesByIp[ip.key] ?? []);
      for (let i = 0; i < points.length; i++) points[i] += dense[i];
    }
    datasets.push({ group, color: CATEGORY_COLOR[group], points });
  }
  return trimTrailingZeroDays({ labels, datasets });
}

/**
 * Drop trailing days where every dataset is 0. A flow series whose latest day
 * hasn't been recorded yet would otherwise dip the chart to zero at the right
 * edge and headline a misleading $0 in the legend. "hold"-filled stock series
 * carry their last value forward, so they're never trimmed. Keeps ≥2 points.
 */
export function trimTrailingZeroDays(trend: CategoryTrend): CategoryTrend {
  let end = trend.labels.length;
  while (end > 2 && trend.datasets.every((d) => !d.points[end - 1])) end--;
  if (end === trend.labels.length) return trend;
  return {
    labels: trend.labels.slice(0, end),
    datasets: trend.datasets.map((d) => ({ ...d, points: d.points.slice(0, end) })),
  };
}

/** Herfindahl–Hirschman index over category market-cap shares (0–1). */
export function concentrationHHI(cats: CategoryAggregate[]): number {
  return cats.reduce((s, c) => s + Math.pow(c.sharePct / 100, 2), 0);
}

/** Align labelled spine series into one dataset each over a shared timeline. */
export function buildSeriesTrend(
  items: { group: string; color: string; series: SeriesPoint[] }[],
  fill: "zero" | "hold",
): CategoryTrend {
  const tsSet = new Set<string>();
  for (const it of items) for (const p of it.series) tsSet.add(p.ts);
  const labels = [...tsSet].sort();
  const idx = new Map(labels.map((ts, i) => [ts, i]));
  const datasets: CategoryTrend["datasets"] = items
    .filter((it) => it.series.length > 0)
    .map((it) => {
      const arr = new Array<number>(labels.length).fill(NaN);
      for (const p of it.series) {
        const i = idx.get(p.ts);
        if (i != null && Number.isFinite(p.value)) arr[i] = p.value;
      }
      if (fill === "hold") {
        let last = 0;
        for (let i = 0; i < arr.length; i++) {
          if (Number.isFinite(arr[i])) last = arr[i];
          else arr[i] = last;
        }
      } else {
        for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) arr[i] = 0;
      }
      return { group: it.group, color: it.color, points: arr };
    });
  return { labels, datasets };
}

/**
 * Top IPs by market cap (that have spine history) as one mcap series each — for
 * the rebased "OP vs Pokémon" index comparison (F3). hold-filled (mcap is stock).
 */
export function buildIpComparisonTrend(
  rows: IPRow[],
  seriesByIp: Record<string, SeriesPoint[]>,
  maxIps = 5,
): CategoryTrend {
  const eligible = [...rows]
    .filter((ip) => ip.key !== "other" && (seriesByIp[ip.key] ?? []).length >= 2 && qualifiedMcap(ip) > 0)
    .sort((a, b) => b.mcapUsd - a.mcapUsd);
  // Compare IPs of broadly comparable scale: drop any under 1% of the largest so
  // a tiny, volatile IP doesn't add noise to the headline OP-vs-Pokémon view.
  const floor = (eligible[0]?.mcapUsd ?? 0) * 0.01;
  const picks = eligible.filter((ip) => ip.mcapUsd >= floor).slice(0, maxIps);
  // Distinct comparison palette — brand colors collide (Pokémon + One Piece are
  // both blue), so rebased lines stay legible against each other.
  const PALETTE = ["#5fa3ff", "#f5c451", "#2bd6a0", "#a18cff", "#ff6b9d"];
  return buildSeriesTrend(
    picks.map((ip, i) => ({ group: ip.name, color: PALETTE[i % PALETTE.length], series: seriesByIp[ip.key] ?? [] })),
    "hold",
  );
}
