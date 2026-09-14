import { unstable_cache } from "next/cache";
import {
  readIndexSeries,
  readIndexMeta,
  completeMonthsOnly,
  type IndexPoint,
} from "./indices";
import { indexReceipt } from "@/lib/indices/naming";
import { formatMonthDayUtc } from "@/lib/format";

/**
 * The homepage index chart's three inputs — points, cap anchor, receipt — as ONE
 * cached read.
 *
 * ⚠️ EXISTS SO THE EMBED CANNOT DISAGREE WITH THE PAGE. `/embed/home-index` shows
 * the same chart on someone else's site; if it recomputed the series, the rebase
 * base or the receipt on its own, the two could drift apart and the embed would
 * be worse than no embed. The page and the route now call the same accessor, and
 * the rebase helper below is the single implementation both use.
 *
 * Zero new reads: `readIndexSeries` and `readIndexMeta` both resolve against the
 * one `price-index` snapshot the homepage was already reading.
 */

/**
 * Window to `fromTs` and rescale so the first point is 100, CARRYING the band.
 *
 * ⚠️ NOT `rebaseWithBands` from indices.ts, which additionally drops non-positive
 * points. This one keeps every finite value, which is what the homepage hero has
 * always drawn — swapping estimators here would silently move the published
 * level, so the difference is preserved deliberately rather than tidied away.
 */
export function rebaseIndexWithBands(series: IndexPoint[], fromTs: string): IndexPoint[] {
  const base = series.find((p) => p.ts >= fromTs && Number.isFinite(p.value) && p.value > 0)?.value ?? null;
  if (!base) return [];
  const f = 100 / base;
  return series
    .filter((p) => p.ts >= fromTs && Number.isFinite(p.value))
    .map((p) => ({
      ts: p.ts,
      value: p.value * f,
      n: p.n,
      lo: p.lo != null ? p.lo * f : undefined,
      hi: p.hi != null ? p.hi * f : undefined,
      thin: p.thin,
    }));
}

export type HomeIndexChart = {
  /** Rebased monthly points with the bootstrap band. */
  points: IndexPoint[];
  /** Tracked market cap on the same base — the reader's check on the index. */
  anchor: IndexPoint[];
  /**
   * The disclosure receipt, every clause read from the blob.
   *
   * ⚠️ THE EXPORT CARRIES THIS. The index runs warmer than the whole market by
   * construction, and this line is where that is disclosed; a PNG of the index
   * without it is a level with no stated bias.
   */
  receipt: string;
  /** Month-end of the latest published point, or null. */
  asOf: string | null;
};

const EMPTY: HomeIndexChart = { points: [], anchor: [], receipt: "", asOf: null };

async function build(): Promise<HomeIndexChart> {
  const raw = await readIndexSeries("market", "total", { kind: "price", from: "2000-01-01" });
  const fromTs = raw[0]?.ts ?? null;
  if (!fromTs) return EMPTY;

  const [meta, anchor] = await Promise.all([
    readIndexMeta("market", "total").catch(() => null),
    readIndexSeries("market", "total", { kind: "mcap", from: fromTs }).catch(() => [] as IndexPoint[]),
  ]);

  const complete = completeMonthsOnly(raw);
  const latestMonthEnd = complete.length ? formatMonthDayUtc(complete[complete.length - 1].ts) : null;

  return {
    points: rebaseIndexWithBands(raw, fromTs),
    anchor,
    receipt: indexReceipt({
      latestMonthEnd,
      skewPP: meta?.selectionPremiumPP ?? null,
      anchorPct: meta?.anchorPct ?? null,
      anchorSince: meta?.anchorSince ?? null,
    }),
    asOf: complete.at(-1)?.ts ?? raw.at(-1)?.ts ?? null,
  };
}

/** NEVER THROWS — an embed that 500s on someone else's page is worse than a gap. */
export const getHomeIndexChart: () => Promise<HomeIndexChart> = unstable_cache(
  async () => {
    try {
      return await build();
    } catch {
      return EMPTY;
    }
  },
  ["home-index-chart:v1"],
  { revalidate: 1800, tags: ["homepage"] },
);
