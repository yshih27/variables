import { formatCompactUsd } from "@/lib/format";

type Props = {
  /** 24 hourly buckets, oldest → newest. */
  hourlyVol: number[];
  /** Display name (used for empty-state aria). */
  name: string;
  height?: number;
  /** Authoritative 24h volume — the same figure shown in the page hero, so the
   *  big "24h total" can never contradict it. Falls back to the sum of the
   *  hourly buckets when omitted. */
  total?: number;
};

const TIMEFRAMES = ["24H", "7D", "30D", "All"] as const;

/**
 * Big stacked-area volume chart for an IP detail page.
 * 24H is the only active timeframe today; 7D / 30D placeholders are
 * shown disabled until we add per-IP hourly history backfill.
 */
export function IPVolumeChart({ hourlyVol, name, height = 280, total }: Props) {
  const bucketSum = hourlyVol.reduce((a, b) => a + b, 0);
  const displayTotal =
    total != null && Number.isFinite(total) ? total : bucketSum;
  const max = Math.max(...hourlyVol, 0.01);
  const peak = max;
  const peakIdx = hourlyVol.indexOf(peak);

  return (
    <section className="mb-12">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-semibold tracking-[-0.005em]">Volume</h2>
          <div className="mt-1 text-[12px] text-ink-3">
            {hourlyVol.length}h history · peak hour {peakIdx >= 0 ? `${formatCompactUsd(peak)}` : "—"}
          </div>
        </div>
        <div className="flex gap-0.5 rounded-lg border border-line bg-bg-1 p-[3px]">
          {TIMEFRAMES.map((t) => {
            const active = t === "24H";
            return (
              <span
                key={t}
                className={`select-none rounded-md px-3 py-1.5 text-[12px] ${
                  active
                    ? "bg-bg-3 text-yellow"
                    : "cursor-not-allowed text-ink-4"
                }`}
                title={active ? "" : "Available once 7d+ IP-level history is backfilled"}
              >
                {t}
              </span>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-bg-1 p-6">
        <div className="mb-4 flex items-baseline gap-4">
          <span className="text-[26px] font-semibold tabular tracking-[-0.01em]">
            {formatCompactUsd(displayTotal)}
          </span>
          <span className="text-[11px] uppercase tracking-[0.06em] text-ink-3">
            24h total
          </span>
        </div>
        <AreaChart data={hourlyVol} height={height} aria-label={`${name} 24h volume`} />
      </div>
    </section>
  );
}

function AreaChart({
  data,
  height,
}: {
  data: number[];
  height: number;
  "aria-label"?: string;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-[12px] text-ink-3">
        No volume data
      </div>
    );
  }
  const width = 1200; // viewBox width; SVG scales to container
  const pad = { top: 12, right: 12, bottom: 32, left: 12 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const max = Math.max(...data, 1);

  // X positions for each bucket center
  const step = chartW / Math.max(1, data.length - 1);
  const xs = data.map((_, i) => pad.left + i * step);
  const ys = data.map((v) => pad.top + chartH - (v / max) * chartH);

  // Build smooth-ish path using line segments
  const linePath = xs
    .map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${ys[i].toFixed(1)}`)
    .join(" ");
  const areaPath =
    `M${xs[0].toFixed(1)} ${(pad.top + chartH).toFixed(1)} ` +
    xs.map((x, i) => `L${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ") +
    ` L${xs[xs.length - 1].toFixed(1)} ${(pad.top + chartH).toFixed(1)} Z`;

  // Y-axis grid lines (4 ticks)
  const gridYs = [0.25, 0.5, 0.75, 1.0].map((p) => pad.top + chartH * (1 - p));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height }}
      aria-hidden
    >
      <defs>
        <linearGradient id="vol-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6cf48a" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#6cf48a" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* horizontal gridlines */}
      {gridYs.map((y, i) => (
        <line
          key={i}
          x1={pad.left}
          x2={width - pad.right}
          y1={y}
          y2={y}
          stroke="#1f1f1f"
          strokeDasharray="2 4"
        />
      ))}

      {/* area fill */}
      <path d={areaPath} fill="url(#vol-fill)" />

      {/* line */}
      <path
        d={linePath}
        fill="none"
        stroke="#6cf48a"
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* x-axis labels: a few hour-ago markers */}
      {[0, 6, 12, 18, 23].map((i) => {
        if (i >= xs.length) return null;
        const hoursAgo = data.length - 1 - i;
        const label = hoursAgo === 0 ? "now" : `${hoursAgo}h ago`;
        return (
          <text
            key={i}
            x={xs[i]}
            y={height - 10}
            fontSize={11}
            fill="#707070"
            textAnchor="middle"
            fontFamily="JetBrains Mono, monospace"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}
