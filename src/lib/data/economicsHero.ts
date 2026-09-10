import type { EconomicsPlatform } from "@/lib/types";
import type { SeriesPoint } from "./metricSnapshots";
import type { AreaOverlay, AreaSeries } from "@/components/StackedAreaChart";

/**
 * The /economics hero, as ONE model: spend bands per platform plus the market
 * payout ÷ spend ratio drawn over them.
 *
 * ⚠️ THE PAGE AND `/embed/economics-spend` BOTH CALL THIS. The embed's readMe
 * promises "payout ÷ spend over it"; when the embed rebuilt the bands on its own
 * it dropped the overlay and the caption described a line that was not there.
 * One builder, one picture, wherever it is shown.
 */
export const ECONOMICS_BAND_COLORS = [
  "var(--color-yellow)",
  "var(--color-blue)",
  "var(--color-purple)",
  "var(--color-teal)",
  "var(--color-solana)",
];

/** Σ two same-day series into a market ratio series, day by day.
 *  ⚠️ Re-derived from the two LEGS, never averaged from per-platform ratios — a
 *  mean of ratios weights a $200 platform like a $2M one. */
export function marketRatioDaily(spend: SeriesPoint[][], outbound: SeriesPoint[][]): SeriesPoint[] {
  const sum = (rows: SeriesPoint[][]) => {
    const m = new Map<string, number>();
    for (const r of rows) for (const p of r) if (Number.isFinite(p.value)) m.set(p.ts, (m.get(p.ts) ?? 0) + p.value);
    return m;
  };
  const s = sum(spend);
  const o = sum(outbound);
  return [...o.entries()]
    .flatMap(([ts, ov]) => {
      const sv = s.get(ts);
      // Both legs or no point: a day only one side covered is a gap, not 0%.
      return sv != null && sv > 0 ? [{ ts, value: (ov / sv) * 100 }] : [];
    })
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

export function economicsHeroModel(platforms: EconomicsPlatform[]): {
  bands: AreaSeries[];
  overlay: AreaOverlay | undefined;
} {
  const bands: AreaSeries[] = platforms
    .filter((p) => p.spendDaily.length > 0)
    .map((p, i) => ({
      key: p.key,
      label: p.name,
      color: ECONOMICS_BAND_COLORS[i % ECONOMICS_BAND_COLORS.length],
      points: p.spendDaily,
    }));
  const ratio = marketRatioDaily(
    platforms.map((p) => p.spendDaily),
    platforms.map((p) => p.outboundDaily),
  );
  const overlay: AreaOverlay | undefined =
    ratio.length >= 2 ? { label: "payout ÷ spend", color: "var(--color-red)", points: ratio } : undefined;
  return { bands, overlay };
}
