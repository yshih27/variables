import type { SeriesPoint } from "@/lib/data/metricSnapshots";
import { trimTrailingZeroDays, type CategoryTrend } from "@/lib/category/rollup";
import { PLATFORM_SOURCES } from "@/lib/data/sources";

/**
 * Platform-trend helpers for the /platforms overview. The spine carries one
 * series per platform (entity_type:"platform"); here we align them into one
 * dataset per platform for the stacked trend chart (reusing CategoryTrendChart,
 * whose dataset `group` is a free string).
 */

/** One distinct color per platform — avoids the yellow accent + green/red Δ. */
export const PLATFORM_COLOR: Record<string, string> = {
  "collector-crypt": "#2bd6a0", // Solana teal
  beezie: "#5b9bff", // Base blue
  courtyard: "#a18cff", // Polygon purple
  phygitals: "#ffd23d", // amber
};

function densify(series: SeriesPoint[], labels: string[], idx: Map<string, number>, fill: "zero" | "hold"): number[] {
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
}

/**
 * Align per-platform spine series into one daily dataset per platform.
 * `fill`: "zero" for flow metrics (volume/gacha), "hold" for stock (market cap).
 */
export function buildPlatformTrend(seriesByKey: Record<string, SeriesPoint[]>, fill: "zero" | "hold"): CategoryTrend {
  const tsSet = new Set<string>();
  for (const key of Object.keys(seriesByKey)) for (const p of seriesByKey[key] ?? []) tsSet.add(p.ts);
  const labels = [...tsSet].sort();
  const idx = new Map(labels.map((ts, i) => [ts, i]));

  const datasets: CategoryTrend["datasets"] = [];
  // PLATFORM_SOURCES order keeps colors/legend stable across views.
  for (const s of PLATFORM_SOURCES) {
    const series = seriesByKey[s.key] ?? [];
    if (series.length === 0) continue;
    datasets.push({ group: s.name, color: PLATFORM_COLOR[s.key] ?? "#707070", points: densify(series, labels, idx, fill) });
  }
  return trimTrailingZeroDays({ labels, datasets });
}

/** Sum several keyed series maps by ts (e.g. marketplace + gacha → total volume). */
export function mergeSeriesByKey(maps: Record<string, SeriesPoint[]>[]): Record<string, SeriesPoint[]> {
  const acc: Record<string, Map<string, number>> = {};
  for (const m of maps) {
    for (const key of Object.keys(m)) {
      acc[key] ??= new Map();
      for (const p of m[key] ?? []) acc[key].set(p.ts, (acc[key].get(p.ts) ?? 0) + p.value);
    }
  }
  const out: Record<string, SeriesPoint[]> = {};
  for (const key of Object.keys(acc)) {
    out[key] = [...acc[key].entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([ts, value]) => ({ ts, value }));
  }
  return out;
}
