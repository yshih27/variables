import type { Trend } from "@/lib/types";

type Props = {
  data: number[];
  trend: Trend;
  width?: number;
  height?: number;
};

const TREND_STROKE: Record<Trend, string> = {
  up: "var(--color-green)",
  down: "var(--color-red)",
  flat: "var(--color-ink-3)",
};

export function Sparkline({ data, trend, width = 88, height = 26 }: Props) {
  if (!data || data.length < 2) {
    return <svg width={width} height={height} aria-hidden />;
  }
  const pad = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const xs = data.map((_, i) => pad + (i / (data.length - 1)) * (width - 2 * pad));
  const ys = data.map((v) => pad + (1 - (v - min) / range) * (height - 2 * pad));
  const d = xs
    .map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${ys[i].toFixed(1)}`)
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path
        d={d}
        fill="none"
        stroke={TREND_STROKE[trend]}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
