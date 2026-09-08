import { unstable_cache } from "next/cache";
import { PLATFORM_SOURCES } from "./sources";
import { fetchHomepage } from "./fetchHomepage";
import {
  readMetricSeriesBulk,
  readMetricSeries,
  lastNDays,
  dropIncompleteTail,
  latestCompleteDay,
  sumLastCompleteDays,
  type SeriesPoint,
} from "./metricSnapshots";
import { platformVolumeBands } from "./platformSeries";

/**
 * Everything `/stats` and `/embed/[chart]` render, assembled once.
 *
 * ZERO new reads: the same per-platform spine bulks `/platforms` already pulls,
 * plus the precomputed homepage payload. Shared between the page and the embed
 * route SO THEY CANNOT DISAGREE — an embed that showed different numbers from the
 * page it was copied off would be worse than no embed.
 *
 * ⚠️ RESALE AND GACHA STAY SEPARATE SERIES FAMILIES, never one blended "volume".
 * Gacha is ~99% of the market's daily turnover, so a single line labelled volume
 * is a gacha chart wearing a market label — the 24h-volume trap this codebase has
 * already been burned by once.
 */

const DAYS = 90;

export type StatsBand = { key: string; label: string; color: string; points: SeriesPoint[] };

export type StatsBoard = {
  windowDays: number;
  /** Newest COMPLETE day across the venue series, or null. */
  asOf: string | null;
  /** Per-venue total daily turnover (marketplace + gacha). */
  venueBands: StatsBand[];
  /** The two families, market-wide, for the share chart. */
  resaleVsGacha: StatsBand[];
  /** Deduped union of holders across platforms, daily. */
  holdersDaily: SeriesPoint[];
  /** Headline figures, each with the window it was measured over. */
  kpis: {
    resale30d: number;
    gacha30d: number;
    holders: number;
    cardsTracked: number;
  };
  generatedAt: string;
};

const RESALE_COLOR = "var(--color-blue)";
const GACHA_COLOR = "var(--color-yellow)";

/** Σ a per-entity bulk into one market-wide daily series, source-gated. */
function marketDaily(bulk: Map<string, SeriesPoint[]>): SeriesPoint[] {
  const byTs = new Map<string, number>();
  for (const [, series] of bulk) {
    for (const p of series) {
      if (!Number.isFinite(p.value)) continue;
      byTs.set(p.ts, (byTs.get(p.ts) ?? 0) + p.value);
    }
  }
  const merged = [...byTs.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([ts, value]) => ({ ts, value }));
  // Drop a SOURCE-INCOMPLETE trailing day (a Dune-lagged partial) so the newest
  // column never craters to a fake cliff.
  return dropIncompleteTail(merged, bulk);
}

async function build(): Promise<StatsBoard> {
  const [home, mktBulk, gachaBulk, holdersS] = await Promise.all([
    fetchHomepage(),
    readMetricSeriesBulk("platform", "volume_usd").catch(() => new Map<string, SeriesPoint[]>()),
    readMetricSeriesBulk("platform", "gacha_volume_usd").catch(() => new Map<string, SeriesPoint[]>()),
    readMetricSeries("market", "total", "holders").catch(() => [] as SeriesPoint[]),
  ]);

  const mkt = Object.fromEntries(mktBulk);
  const gacha = Object.fromEntries(gachaBulk);

  // Venue order = the payload's rank (total 24h activity), so the stack reads the
  // same way the leaderboard does.
  const ranked = home.platforms.length
    ? home.platforms.map((p) => ({ key: p.key, name: p.name }))
    : PLATFORM_SOURCES.map((p) => ({ key: p.key, name: p.name }));
  const venueBands = platformVolumeBands(ranked, mkt, gacha, DAYS);

  const resale = lastNDays(marketDaily(mktBulk), DAYS);
  const gachaDaily = lastNDays(marketDaily(gachaBulk), DAYS);

  const asOf =
    [...venueBands.flatMap((b) => b.points.map((p) => p.ts)), ...resale.map((p) => p.ts)].sort().at(-1) ?? null;

  return {
    windowDays: DAYS,
    asOf,
    venueBands,
    resaleVsGacha: [
      { key: "gacha", label: "Gacha", color: GACHA_COLOR, points: gachaDaily },
      { key: "resale", label: "Marketplace resale", color: RESALE_COLOR, points: resale },
    ],
    holdersDaily: lastNDays(holdersS, DAYS),
    kpis: {
      resale30d: sumLastCompleteDays(resale, 30),
      gacha30d: sumLastCompleteDays(gachaDaily, 30),
      holders: home.hero.holders,
      cardsTracked: home.hero.totalCards,
    },
    generatedAt: home.hero.updatedAt,
  };
}

const EMPTY: StatsBoard = {
  windowDays: DAYS,
  asOf: null,
  venueBands: [],
  resaleVsGacha: [],
  holdersDaily: [],
  kpis: { resale30d: NaN, gacha30d: NaN, holders: NaN, cardsTracked: NaN },
  generatedAt: "",
};

/** Cached, total. A public page built to be cited must not be able to 500. */
export const buildStatsBoard: () => Promise<StatsBoard> = unstable_cache(
  async () => {
    try {
      return await build();
    } catch {
      return EMPTY;
    }
  },
  ["stats-board:v1"],
  { revalidate: 1800, tags: ["platform-buckets"] },
);

/** `latestCompleteDay` re-exported for the embed route's as-of line. */
export { latestCompleteDay };
