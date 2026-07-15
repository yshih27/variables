import type { SeriesPoint } from "@/lib/data/metricSnapshots";
import { trimTrailingZeroDays, buildSeriesTrend, type CategoryTrend } from "@/lib/category/rollup";
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

/** Sum every platform's series into one total series by ts. */
function sumAllByTs(byKey: Record<string, SeriesPoint[]>): SeriesPoint[] {
  const acc = new Map<string, number>();
  for (const key of Object.keys(byKey)) for (const p of byKey[key] ?? []) acc.set(p.ts, (acc.get(p.ts) ?? 0) + (p.value || 0));
  return [...acc.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([ts, value]) => ({ ts, value }));
}

/**
 * Total 24h volume split by TYPE — Marketplace (secondary resale) + Gacha
 * (primary) — as two stacked bands (R2-F3). This is the honest decomposition of
 * the "Volume" metric; on these platforms gacha/primary dwarfs secondary resale,
 * so marketplace reads as the thinner band. Flow metric ⇒ "zero" fill.
 */
export function buildVolumeSplitTrend(
  mktByKey: Record<string, SeriesPoint[]>,
  gachaByKey: Record<string, SeriesPoint[]>,
): CategoryTrend {
  return trimTrailingZeroDays(
    buildSeriesTrend(
      [
        { group: "Marketplace", color: "#5fa3ff", series: sumAllByTs(mktByKey) },
        { group: "Gacha", color: "#bfef01", series: sumAllByTs(gachaByKey) },
      ],
      "zero",
    ),
  );
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
