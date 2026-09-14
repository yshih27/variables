/**
 * Per-platform daily series, shared by /platforms and the homepage.
 *
 * Extracted when the homepage grew its own stacked-area lead chart: both pages
 * need the same "one platform's daily total" and the same completeness gate, and
 * two copies of that arithmetic is exactly how two surfaces start disagreeing
 * about the same day.
 */
import { unstable_cache } from "next/cache";
import {
  dropIncompleteTail,
  lastNDays,
  readMetricSeriesBulk,
  type SeriesPoint,
} from "./metricSnapshots";
import { PLATFORM_SOURCES } from "./sources";

export const getPlatformSeries = unstable_cache(
  async (metric: string) => Object.fromEntries(await readMetricSeriesBulk("platform", metric)),
  ["platforms-series:v2"],
  { revalidate: 3600, tags: ["homepage"] },
);

/**
 * One platform's daily TOTAL — its marketplace and gacha series added per day.
 * Mirrors the total24Usd the rails and tables rank by, so a chart under a
 * platform's name measures the same thing its row does. Non-finite points are
 * SKIPPED rather than zeroed: a day with no reading isn't a day worth $0.
 */
export function totalDaily(...sources: (SeriesPoint[] | undefined)[]): SeriesPoint[] {
  const byTs = new Map<string, number>();
  for (const series of sources) {
    for (const p of series ?? []) {
      if (!Number.isFinite(p.value)) continue;
      byTs.set(p.ts, (byTs.get(p.ts) ?? 0) + p.value);
    }
  }
  return [...byTs.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([ts, value]) => ({ ts, value }));
}

/** Band palette for per-platform stacks. House categorical ramp, no new colours. */
export const PLATFORM_BAND_COLORS = [
  "#2bd6a0",
  "#5fa3ff",
  "#ff6b9d",
  "#a18cff",
  "#22d3ee",
  "#fbbf24",
];

/**
 * A venue's colour wherever a surface colours BY VENUE rather than by rank —
 * the identity page's sale dots and venue bars. Assigned by the venue's position
 * in the platform catalog, so Beezie is the same colour on every identity page
 * and a reader who learned it once keeps it. The homepage bands above colour by
 * rank on purpose (the ranking is the picture there); this is the other case.
 * Same ramp, no new colours; an unknown key takes the last swatch.
 */
export function venueColor(platform: string): string {
  const i = PLATFORM_SOURCES.findIndex((p) => p.key === platform);
  return PLATFORM_BAND_COLORS[(i < 0 ? PLATFORM_BAND_COLORS.length - 1 : i) % PLATFORM_BAND_COLORS.length];
}

/**
 * Ranked platforms → stacked bands of daily total volume.
 *
 * Carries the SAME completeness gate the 14d cards use: a Dune-lagged partial
 * trailing day is dropped per platform, so the newest edge of the stack can't dip
 * on streams that simply haven't landed yet (INV-8).
 */
export function platformVolumeBands(
  ranked: { key: string; name: string }[],
  mktSeries: Record<string, SeriesPoint[]>,
  gachaSeries: Record<string, SeriesPoint[]>,
  days: number,
): { key: string; label: string; color: string; points: SeriesPoint[]; href: string }[] {
  return ranked
    .map((p, i) => {
      const mkt = mktSeries[p.key];
      const gacha = gachaSeries[p.key];
      const streams = new Map<string, SeriesPoint[]>([
        ["mkt", mkt ?? []],
        ["gacha", gacha ?? []],
      ]);
      return {
        key: p.key,
        label: p.name,
        color: PLATFORM_BAND_COLORS[i % PLATFORM_BAND_COLORS.length],
        // The band hands off to its venue (nav r3): the homepage's chart is the
        // first place a reader sees Beezie, and it could not be clicked.
        href: `/platform/${p.key}`,
        points: lastNDays(dropIncompleteTail(totalDaily(mkt, gacha), streams), days),
      };
    })
    .filter((s) => s.points.some((pt) => Number.isFinite(pt.value)));
}
