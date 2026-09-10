/**
 * Weekly report engine (B9-2) — the movers ranker + report composer behind the
 * `weekly-report` snapshot (written Mondays by scripts/warm-weekly-report.ts,
 * rendered by the /report page and distributed as the GTM Phase-1 artifact).
 *
 * The report covers the just-COMPLETED Mon→Mon UTC week ([weekStart, weekEnd)),
 * compared against the week before. Everything is a pure derivation over data
 * that already exists:
 *   • index WoW        — the constant-quality PRICE index (weekly points stamped at
 *                        each week's END/Sunday; lastBefore the running week's Monday
 *                        picks the completed week).
 *   • vs benchmarks    — BTC/ETH/SP500/NASDAQ/GOLD closes from the spine;
 *                        spread = index WoW − benchmark WoW over the same week.
 *   • top movers       — spine bulk reads: per-IP / per-set volume (flow: week
 *                        sum vs prior-week sum), per-platform total activity
 *                        (marketplace volume_usd + gacha_volume_usd), per-IP
 *                        market cap (stock: last reading in week vs prior week).
 *   • biggest sales    — the secondary-sales store (CC/Courtyard rows written by
 *                        runCoreWarm, Beezie by warm-secondary-sales), named via `cards`.
 *   • notable pulls    — gacha-dune bigHits that landed inside the week.
 *
 * Movers with no prior-week base (new entrants) are skipped — a percent rank
 * needs a denominator; they'd otherwise dominate every list with fake ∞%.
 */
import {
  readMetricSeries,
  readMetricSeriesBulk,
  DELTA_MIN_BASE_USD,
  type SeriesPoint,
} from "./metricSnapshots";
import { readIndexSeries } from "./indices";
import { weekStartUtc } from "./priceIndex";
import { IP_CATALOG, OTHER_IP } from "./ipCatalog";
import { PLATFORM_SOURCES } from "./sources";

import { readSecondarySales } from "./secondarySalesCache";
import { readCardMeta, type CardPlatform } from "./cards";
import { readGachaDune } from "./gachaDuneCache";
import { readSnapshot } from "../db/snapshots";
import { tickerOf, indexDisplayName } from "../indices/naming";
import type { NormalizedSale } from "../rarible/queries";

const DAY = 86_400_000;

export const WEEKLY_REPORT_SNAPSHOT_KEY = "weekly-report";

export type ReportMover = {
  key: string;
  name: string;
  /** Index ticker (e.g. "V-PKM") for IP movers; null for platform/set boards,
   *  which aren't indices. From the naming SSOT (src/lib/indices/naming.ts). */
  ticker: string | null;
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
  /** Display names for the subtitle — the report renders these, never the raw
   *  slugs ("one_piece · collector-crypt"). From ipCatalog / PLATFORM_SOURCES. */
  ipName: string;
  platformName: string;
  priceUsd: number;
  date: string;
  /** Card art for the row thumbnail. OPTIONAL: report snapshots written before
   *  this field existed simply have none, and the row renders its placeholder —
   *  a stored report must never fail to render because it predates a column. */
  image?: string | null;
};

export type ReportPull = {
  platform: string;
  platformName: string;
  /** Prize mint — the pull's real identity. Two copies of the SAME card are two
   *  distinct mints (and two real pulls); only mint+at identifies a duplicate. */
  mint: string;
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
  /** Constant-quality price index: ticker + name (naming SSOT), completed-week level
   *  (rebased, 100 = inception) + WoW. The market index is V-MKT. */
  index: {
    ticker: string;
    name: string;
    level: number | null;
    /** Kept for consumers; ALWAYS null on the monthly index — a week-over-week
     *  number cannot be read from a monthly series. */
    wowPct: number | null;
    asOf: string | null;
    /** Month over month between the last two complete months, set only when the
     *  report week CONTAINS a month end; otherwise null and `note` says why. */
    momPct: number | null;
    note: string | null;
  };
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
/** Floor for a mover's BASE (prior-week) figure — see pickMovers. Shares the
 *  DELTA_MIN_BASE_USD convention used by the 24h deltas + rollup momentum. */
const MOVER_MIN_BASE_USD = DELTA_MIN_BASE_USD;
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

/** Rank totals into top-N gainers/losers by % change (prior week as the base).
 *  `tickerFn` supplies a ticker for index-backed boards (IPs); omit for
 *  platform/set boards, which aren't indices. */
function pickMovers(
  totals: Totals,
  nameOf: (key: string) => string,
  tickerFn?: (key: string) => string,
): MoverBoard {
  const rows: ReportMover[] = [];
  for (const [key, { cur, prev }] of totals) {
    // The BASE needs a floor, not just "both weeks are small" (M4). The old guard
    // only skipped when BOTH were tiny, so a tiny DENOMINATOR still printed an absurd
    // move — a $50 prior week against $2,356 ranked "+4,612%". Same convention as
    // pctChangeDays(…, minBase) in category/rollup.ts: below the floor a % is noise,
    // not a signal, so the entity simply isn't rankable. (A real collapse from a
    // substantial base still ranks — only the denominator is floored.)
    if (!(prev >= MOVER_MIN_BASE_USD)) continue;
    rows.push({
      key,
      name: nameOf(key),
      ticker: tickerFn ? tickerFn(key) : null,
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
    // All three from the secondary-sales store — the app/report layer never
    // reads Dune directly (each read was a billed export; see warmers/core).
    readSecondarySales("collector-crypt"),
    readSecondarySales("beezie"),
    readSecondarySales("courtyard"),
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
    const ip = m?.ip ?? "other";
    return {
      platform: c.platform,
      tokenId: c.tokenId,
      name: (m?.cardName || m?.name || `${c.tokenId.slice(0, 8)}…`).trim(),
      ip,
      // Display names for the subtitle — the page used to print the raw slugs.
      ipName: ipName(ip),
      platformName: platformName(c.platform),
      priceUsd: c.priceUsd,
      date: c.date,
      image: m?.image ?? null,
    };
  });
}

/** Top gacha hits (by realized FMV) that landed inside the week. */
async function buildNotablePulls(weekStartMs: number, weekEndMs: number): Promise<ReportPull[]> {
  const gacha = await readGachaDune();
  const inWeek = (gacha?.bigHits ?? []).filter((h) => {
    const t = Date.parse(h.at);
    return Number.isFinite(t) && t >= weekStartMs && t < weekEndMs && h.valueUsd > 0;
  });

  // Dedupe on the pull's REAL identity (platform+mint+at) — insurance against a
  // warmer re-recording one prize delivery. ⚠️ Deliberately NOT by name: two copies
  // of the same card are two DISTINCT mints and two REAL pulls. The report's
  // "duplicate Charizard" rows are exactly that — mints BfDsR82e… and 7EMYgXPK…,
  // both "Charizard HOLO R/(Thin Stamp)" Base-1st Beckett-9 at $42,700, pulled 5
  // days apart. They read as duplicates only because CC's source `name` is capped
  // at 32 chars (78% of CC names hit the cap), chopping the distinguishing tail.
  const seen = new Set<string>();
  const unique = inWeek.filter((h) => {
    const id = `${h.platform}:${h.mint}:${h.at}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const top = unique.sort((a, b) => b.valueUsd - a.valueUsd).slice(0, TOP_N);

  // Prefer the full `card_name` over the 32-char source `name` (same rule
  // buildBiggestSales already uses) so the report stops printing mid-word chops.
  const ccMints = top.filter((h) => h.platform === "collector-crypt").map((h) => h.mint);
  const meta = ccMints.length
    ? await readCardMeta("collector-crypt", ccMints).catch(() => new Map())
    : new Map();

  return top.map((h) => ({
    platform: h.platform,
    platformName: platformName(h.platform),
    mint: h.mint,
    name: (meta.get(h.mint)?.cardName || h.name).trim(),
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

  // ── Index, MONTHLY. The price index is month-end stamped, so a week-over-week
  //    number is never read from it. When the report week contains a month end,
  //    the newest point is that month's close and the line reads month over
  //    month; otherwise the level is the latest complete month and the line says
  //    when the next point lands. ──
  const idx = await readIndexSeries("market", "total", { kind: "price", from: "2000-01-01" });
  const latest = lastBefore(idx, weekEndMs);
  const monthEndInWeek = latest != null && Date.parse(latest.ts) >= weekStartMs;
  const prevMonth = latest ? lastBefore(idx, Date.parse(latest.ts)) : null;
  const index = {
    ticker: tickerOf("market", "total"), // V-MKT
    name: indexDisplayName("market", "total"),
    level: latest ? latest.value : null,
    wowPct: null,
    asOf: latest ? latest.ts : null,
    momPct: monthEndInWeek && prevMonth && prevMonth.value > 0 ? (latest.value / prevMonth.value - 1) * 100 : null,
    note: monthEndInWeek ? null : `${tickerOf("market", "total")}: monthly index, next point at month end`,
  };

  // ── Benchmarks WoW (their own weekly line) + spread vs the index over the SAME
  //    WINDOW AS THE INDEX MOVE. The index is monthly, so its spread is measured
  //    against each benchmark's month-over-month close (prev month-end → this
  //    month-end), never against the benchmark's weekly move — subtracting a
  //    week from a month is the mismatched-window error this report exists to
  //    avoid. No month end this week → no index move → no spread. ──
  const benchmarks: ReportBenchmark[] = [];
  const mEndMs = monthEndInWeek && latest ? Date.parse(latest.ts) + 1 : null;
  const mPrevMs = monthEndInWeek && prevMonth ? Date.parse(prevMonth.ts) + 1 : null;
  for (const symbol of ["BTC", "ETH", "SP500", "NASDAQ", "GOLD"] as const) {
    const closes = await readMetricSeries("benchmark", symbol, "close");
    const b1 = lastBefore(closes, weekEndMs);
    const b0 = lastBefore(closes, weekStartMs);
    const wowPct = b1 && b0 && b0.value > 0 ? (b1.value / b0.value - 1) * 100 : null;
    let spreadPct: number | null = null;
    if (index.momPct != null && mEndMs != null && mPrevMs != null) {
      const m1 = lastBefore(closes, mEndMs);
      const m0 = lastBefore(closes, mPrevMs);
      const momBench = m1 && m0 && m0.value > 0 ? (m1.value / m0.value - 1) * 100 : null;
      spreadPct = momBench != null ? index.momPct - momBench : null;
    }
    benchmarks.push({ symbol, wowPct, spreadPct });
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
  const ipTicker = (k: string) => tickerOf("ip", k);
  const movers = {
    ipVolume: pickMovers(flowTotals([ipVolBulk], weekStartMs, weekEndMs), ipName, ipTicker),
    ipMcap: pickMovers(stockTotals(ipMcapBulk, weekStartMs, weekEndMs), ipName, ipTicker),
    platformVolume: pickMovers(platTotals, platformName), // platforms aren't indices — no ticker
    setVolume: pickMovers(flowTotals([setVolBulk], weekStartMs, weekEndMs), setName), // sets aren't indices
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
