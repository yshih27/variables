/**
 * Weekly report engine (B9-2) — the movers ranker + report composer behind the
 * `weekly-report` snapshot (written Mondays by scripts/warm-weekly-report.ts,
 * rendered by the /report page and distributed as the GTM Phase-1 artifact).
 *
 * The report covers the just-COMPLETED Mon→Mon UTC week ([weekStart, weekEnd)),
 * compared against the week before. Everything is a pure derivation over data
 * that already exists:
 *   • index WoW        — the constant-quality PRICE index (weekly Monday points;
 *                        the point AT weekStart aggregates the completed week).
 *   • vs benchmarks    — BTC/ETH/SP500/NASDAQ/GOLD closes from the spine;
 *                        spread = index WoW − benchmark WoW over the same week.
 *   • top movers       — spine bulk reads: per-IP / per-set volume (flow: week
 *                        sum vs prior-week sum), per-platform total activity
 *                        (marketplace volume_usd + gacha_volume_usd), per-IP
 *                        market cap (stock: last reading in week vs prior week).
 *   • biggest sales    — the cached row-level feeds (CC 30d Dune, Beezie 30d
 *                        /activity, Courtyard full Dune), named via `cards`.
 *   • notable pulls    — gacha-dune bigHits that landed inside the week.
 *
 * Movers with no prior-week base (new entrants) are skipped — a percent rank
 * needs a denominator; they'd otherwise dominate every list with fake ∞%.
 */
import {
  readMetricSeries,
  readMetricSeriesBulk,
  type SeriesPoint,
} from "./metricSnapshots";
import { readIndexSeries } from "./indices";
import { weekStartUtc } from "./priceIndex";
import { IP_CATALOG, OTHER_IP } from "./ipCatalog";
import { PLATFORM_SOURCES } from "./sources";
import { fetchCCSecondarySales, fetchCourtyardSecondarySales } from "./warmers/core";
import { readSecondarySales } from "./secondarySalesCache";
import { readCardMeta, type CardPlatform } from "./cards";
import { readGachaDune } from "./gachaDuneCache";
import { readSnapshot } from "../db/snapshots";
import type { NormalizedSale } from "../rarible/queries";

const DAY = 86_400_000;

export const WEEKLY_REPORT_SNAPSHOT_KEY = "weekly-report";

export type ReportMover = {
  key: string;
  name: string;
  /** Completed-week figure (volume sum, or last mcap reading in the week). */
  currentUsd: number;
  /** Prior-week figure — always > 0 (new entrants are skipped, see header). */
  previousUsd: number;
  pct: number;
};

export type MoverBoard = { gainers: ReportMover[]; losers: ReportMover[] };

export type ReportBenchmark = {
  symbol: "BTC" | "ETH" | "SP500" | "NASDAQ" | "GOLD";
  wowPct: number | null;
  /** Index WoW − benchmark WoW (percentage points); null when either leg is missing. */
  spreadPct: number | null;
};

export type ReportSale = {
  platform: string;
  tokenId: string;
  name: string;
  ip: string;
  priceUsd: number;
  date: string;
};

export type ReportPull = {
  platform: string;
  name: string;
  valueUsd: number;
  at: string;
  pack: string | null;
};

export type WeeklyReport = {
  generatedAt: string;
  /** Inclusive Monday-00:00-UTC start of the completed week the report covers. */
  weekStart: string;
  /** Exclusive end (= Monday 00:00 UTC of the running week). */
  weekEnd: string;
  /** Constant-quality price index: completed-week level (rebased, 100 = inception) + WoW. */
  index: { level: number | null; wowPct: number | null; asOf: string | null };
  mcap: { totalUsd: number | null; wowPct: number | null };
  /** Total tracked activity (marketplace + gacha) for the week vs the prior week. */
  volume: { weekUsd: number; prevWeekUsd: number; wowPct: number | null };
  benchmarks: ReportBenchmark[];
  movers: {
    ipVolume: MoverBoard;
    ipMcap: MoverBoard;
    platformVolume: MoverBoard;
    setVolume: MoverBoard;
  };
  biggestSales: ReportSale[];
  notablePulls: ReportPull[];
};

/** Ignore weekly figures below this — thin IPs/sets flap ±hundreds of % on noise. */
const MIN_WEEK_USD = 250;
const TOP_N = 5;

/** Last point strictly BEFORE `ms`, or null. Series are oldest→newest. */
function lastBefore(series: SeriesPoint[], ms: number): SeriesPoint | null {
  let out: SeriesPoint | null = null;
  for (const p of series) {
    const t = Date.parse(p.ts);
    if (!Number.isFinite(t)) continue; // skip a malformed point, don't truncate
    if (t >= ms) break;
    if (Number.isFinite(p.value)) out = p;
  }
  return out;
}

/** Sum of points with ts in [fromMs, toMs). */
function sumWindow(series: SeriesPoint[], fromMs: number, toMs: number): number {
  let sum = 0;
  for (const p of series) {
    const t = Date.parse(p.ts);
    if (!Number.isFinite(t) || t < fromMs || t >= toMs) continue;
    if (Number.isFinite(p.value)) sum += p.value;
  }
  return sum;
}

/** A stock (point-in-time) reading for a window: the LAST value inside it, or null. */
function lastInWindow(series: SeriesPoint[], fromMs: number, toMs: number): number | null {
  const p = lastBefore(series, toMs);
  if (!p) return null;
  const t = Date.parse(p.ts);
  return t >= fromMs && p.value > 0 ? p.value : null;
}

type Totals = Map<string, { cur: number; prev: number }>;

/** Flow totals (window sums) per entity, accumulated across one or more bulk maps
 *  (e.g. platform volume_usd + gacha_volume_usd add into one activity figure). */
function flowTotals(
  bulks: Map<string, SeriesPoint[]>[],
  weekStartMs: number,
  weekEndMs: number,
): Totals {
  const out: Totals = new Map();
  for (const bulk of bulks) {
    for (const [key, series] of bulk) {
      const acc = out.get(key) ?? { cur: 0, prev: 0 };
      acc.cur += sumWindow(series, weekStartMs, weekEndMs);
      acc.prev += sumWindow(series, weekStartMs - 7 * DAY, weekStartMs);
      out.set(key, acc);
    }
  }
  return out;
}

/** Stock totals (last-reading-in-window) per entity. Entities missing a reading
 *  in either week are dropped — carrying an old level would fake a flat WoW. */
function stockTotals(
  bulk: Map<string, SeriesPoint[]>,
  weekStartMs: number,
  weekEndMs: number,
): Totals {
  const out: Totals = new Map();
  for (const [key, series] of bulk) {
    const cur = lastInWindow(series, weekStartMs, weekEndMs);
    const prev = lastInWindow(series, weekStartMs - 7 * DAY, weekStartMs);
    if (cur == null || prev == null) continue;
    out.set(key, { cur, prev });
  }
  return out;
}

/** Rank totals into top-N gainers/losers by % change (prior week as the base). */
function pickMovers(totals: Totals, nameOf: (key: string) => string): MoverBoard {
  const rows: ReportMover[] = [];
  for (const [key, { cur, prev }] of totals) {
    if (cur < MIN_WEEK_USD && prev < MIN_WEEK_USD) continue; // noise floor
    if (!(prev > 0)) continue; // new entrant — no base for a % rank
    rows.push({
      key,
      name: nameOf(key),
      currentUsd: cur,
      previousUsd: prev,
      pct: ((cur - prev) / prev) * 100,
    });
  }
  rows.sort((a, b) => b.pct - a.pct);
  return {
    gainers: rows.filter((r) => r.pct > 0).slice(0, TOP_N),
    losers: rows.filter((r) => r.pct < 0).slice(-TOP_N).reverse(),
  };
}

const ipName = (key: string): string =>
  key === OTHER_IP.key ? OTHER_IP.name : IP_CATALOG.find((i) => i.key === key)?.name ?? key;
const platformName = (key: string): string =>
  PLATFORM_SOURCES.find((s) => s.key === key)?.name ?? key;
/** Set entity keys are composite "{ip}:{setName}" (IP keys carry no ":"). */
const setName = (key: string): string => {
  const i = key.indexOf(":");
  return i < 0 ? key : `${ipName(key.slice(0, i))} · ${key.slice(i + 1)}`;
};

/** Top single sales inside the week, named via the `cards` table. */
async function buildBiggestSales(weekStartMs: number, weekEndMs: number): Promise<ReportSale[]> {
  const [cc, bz, cy] = await Promise.all([
    fetchCCSecondarySales({ cachedOnly: true }).catch(() => [] as NormalizedSale[]),
    readSecondarySales("beezie"),
    fetchCourtyardSecondarySales({ cachedOnly: true }).catch(() => [] as NormalizedSale[]),
  ]);
  const feeds: [CardPlatform, NormalizedSale[]][] = [
    ["collector-crypt", cc],
    ["beezie", bz],
    ["courtyard", cy],
  ];

  type Candidate = { platform: CardPlatform; tokenId: string; priceUsd: number; date: string };
  const candidates: Candidate[] = [];
  for (const [platform, sales] of feeds) {
    for (const s of sales) {
      const t = Date.parse(s.date);
      if (!Number.isFinite(t) || t < weekStartMs || t >= weekEndMs) continue;
      if (!(s.priceUsd > 0) || !s.tokenId) continue;
      if (s.buyer && s.seller && s.buyer === s.seller) continue; // wash
      candidates.push({ platform, tokenId: s.tokenId, priceUsd: s.priceUsd, date: s.date });
    }
  }
  candidates.sort((a, b) => b.priceUsd - a.priceUsd);

  // Dedupe by token (a card that sold twice keeps its highest sale) and resolve
  // names for a small head of candidates only.
  const seen = new Set<string>();
  const head: Candidate[] = [];
  for (const c of candidates) {
    const k = `${c.platform}:${c.tokenId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    head.push(c);
    if (head.length >= TOP_N * 3) break;
  }

  const metaByPlatform = new Map<CardPlatform, Awaited<ReturnType<typeof readCardMeta>>>();
  for (const platform of new Set(head.map((c) => c.platform))) {
    const ids = head.filter((c) => c.platform === platform).map((c) => c.tokenId);
    metaByPlatform.set(platform, await readCardMeta(platform, ids).catch(() => new Map()));
  }

  return head.slice(0, TOP_N).map((c) => {
    const m = metaByPlatform.get(c.platform)?.get(c.tokenId);
    return {
      platform: c.platform,
      tokenId: c.tokenId,
      name: (m?.cardName || m?.name || `${c.tokenId.slice(0, 8)}…`).trim(),
      ip: m?.ip ?? "other",
      priceUsd: c.priceUsd,
      date: c.date,
    };
  });
}

/** Top gacha hits (by realized FMV) that landed inside the week. */
async function buildNotablePulls(weekStartMs: number, weekEndMs: number): Promise<ReportPull[]> {
  const gacha = await readGachaDune();
  return (gacha?.bigHits ?? [])
    .filter((h) => {
      const t = Date.parse(h.at);
      return Number.isFinite(t) && t >= weekStartMs && t < weekEndMs && h.valueUsd > 0;
    })
    .sort((a, b) => b.valueUsd - a.valueUsd)
    .slice(0, TOP_N)
    .map((h) => ({
      platform: h.platform,
      name: h.name,
      valueUsd: h.valueUsd,
      at: h.at,
      pack: h.pack ?? null,
    }));
}

export async function buildWeeklyReport(nowMs: number = Date.now()): Promise<WeeklyReport> {
  // weekEnd = Monday 00:00 UTC of the RUNNING week → the report covers the
  // completed week [weekEnd − 7d, weekEnd).
  const weekEnd = weekStartUtc(nowMs);
  const weekEndMs = Date.parse(weekEnd);
  const weekStartMs = weekEndMs - 7 * DAY;
  const weekStart = new Date(weekStartMs).toISOString();

  // ── Index WoW (price index is weekly, Monday-keyed: the point AT weekStart
  //    aggregates the completed week; the point at weekEnd is the partial
  //    running week and is excluded by the strict `< weekEnd` cut). ──
  const idx = await readIndexSeries("market", "total", { kind: "price", from: "2000-01-01" });
  const p1 = lastBefore(idx, weekEndMs);
  const p0 = lastBefore(idx, weekStartMs);
  // Guard against a stale price-index snapshot: a "current" point older than the
  // report week would silently compare two old weeks.
  const p1Fresh = p1 && Date.parse(p1.ts) >= weekStartMs;
  const index = {
    level: p1Fresh ? p1.value : null,
    wowPct: p1Fresh && p0 && p0.value > 0 ? (p1.value / p0.value - 1) * 100 : null,
    asOf: p1Fresh ? p1.ts : null,
  };

  // ── Benchmarks WoW + spread vs the index, over the same week ──
  const benchmarks: ReportBenchmark[] = [];
  for (const symbol of ["BTC", "ETH", "SP500", "NASDAQ", "GOLD"] as const) {
    const closes = await readMetricSeries("benchmark", symbol, "close");
    const b1 = lastBefore(closes, weekEndMs);
    const b0 = lastBefore(closes, weekStartMs);
    const wowPct = b1 && b0 && b0.value > 0 ? (b1.value / b0.value - 1) * 100 : null;
    benchmarks.push({
      symbol,
      wowPct,
      spreadPct: index.wowPct != null && wowPct != null ? index.wowPct - wowPct : null,
    });
  }

  // ── Market cap WoW (stock: last reading in each week) ──
  const mcapSeries = await readMetricSeries("market", "total", "mcap_usd");
  const mcapCur = lastInWindow(mcapSeries, weekStartMs, weekEndMs);
  const mcapPrev = lastInWindow(mcapSeries, weekStartMs - 7 * DAY, weekStartMs);
  const mcap = {
    totalUsd: mcapCur,
    wowPct: mcapCur != null && mcapPrev != null ? (mcapCur / mcapPrev - 1) * 100 : null,
  };

  // ── Movers (one bulk spine read per board) ──
  const [ipVolBulk, ipMcapBulk, setVolBulk, platVolBulk, platGachaBulk] = await Promise.all([
    readMetricSeriesBulk("ip", "volume_usd"),
    readMetricSeriesBulk("ip", "mcap_usd"),
    readMetricSeriesBulk("set", "volume_usd"),
    readMetricSeriesBulk("platform", "volume_usd"),
    readMetricSeriesBulk("platform", "gacha_volume_usd"),
  ]);
  const platTotals = flowTotals([platVolBulk, platGachaBulk], weekStartMs, weekEndMs);
  const movers = {
    ipVolume: pickMovers(flowTotals([ipVolBulk], weekStartMs, weekEndMs), ipName),
    ipMcap: pickMovers(stockTotals(ipMcapBulk, weekStartMs, weekEndMs), ipName),
    platformVolume: pickMovers(platTotals, platformName),
    setVolume: pickMovers(flowTotals([setVolBulk], weekStartMs, weekEndMs), setName),
  };

  // ── Total tracked activity for the week (marketplace + gacha, all platforms) ──
  let weekUsd = 0;
  let prevWeekUsd = 0;
  for (const { cur, prev } of platTotals.values()) {
    weekUsd += cur;
    prevWeekUsd += prev;
  }
  const volume = {
    weekUsd,
    prevWeekUsd,
    wowPct: prevWeekUsd > 0 ? ((weekUsd - prevWeekUsd) / prevWeekUsd) * 100 : null,
  };

  const [biggestSales, notablePulls] = await Promise.all([
    buildBiggestSales(weekStartMs, weekEndMs),
    buildNotablePulls(weekStartMs, weekEndMs),
  ]);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    weekStart,
    weekEnd,
    index,
    mcap,
    volume,
    benchmarks,
    movers,
    biggestSales,
    notablePulls,
  };
}

/** The frontend read path (/report, F9-2): one snapshot row, never throws. */
export async function readWeeklyReport(): Promise<WeeklyReport | null> {
  return readSnapshot<WeeklyReport>(WEEKLY_REPORT_SNAPSHOT_KEY);
}
