import type { EconomicsPlatform } from "@/lib/types";
import { resampleToPeriod } from "@/lib/chart/period";
import { Section } from "../Section";
import { HeldChip } from "./HeldChip";
import { VenueCountChip } from "./CoverageChip";

/**
 * Payout ÷ spend, by platform, over the last 12 COMPLETE weeks.
 *
 * ⚠️ THE RATIO IS RE-DERIVED PER WEEK FROM THE TWO LEGS, never averaged from
 * daily ratios. A mean of daily ratios weights a $200 day the same as a $2M day
 * and would drift away from the 30d figure in the KPI strip above; Σoutbound ÷
 * Σspend over the week is the same arithmetic at a coarser grain, so the two
 * surfaces agree by construction.
 *
 * ⚠️ 100% IS DRAWN, and it is the whole point of the chart. Above the line means
 * more left the gacha wallets than came in over that week — honest for a platform
 * whose spend is falling, because payouts settle earlier and larger cohorts. The
 * baseline is what lets a reader see the crossing rather than be told about it.
 *
 * Suppressed and unsourced platforms are absent, not zero: only a platform whose
 * outbound leg is published has a ratio at all.
 */
const WEEKS = 12;
const PLOT_H = 150;
const PAD_T = 10;

type Line = { key: string; name: string; color: string; points: { ts: string; v: number }[] };

const COLORS = ["var(--color-yellow)", "var(--color-blue)", "var(--color-purple)", "var(--color-teal)"];

function weeklyRatio(p: EconomicsPlatform): { ts: string; v: number }[] {
  if (p.outboundDaily.length === 0) return [];
  const spend = new Map(resampleToPeriod(p.spendDaily, "W", "sum", {}).map((x) => [x.ts, x.value]));
  const out = resampleToPeriod(p.outboundDaily, "W", "sum", {});
  return out.flatMap((o) => {
    const s = spend.get(o.ts);
    // Both legs, or no point. A week only one side covered is a gap, not a 0%.
    return s != null && s > 0 && Number.isFinite(o.value) ? [{ ts: o.ts, v: (o.value / s) * 100 }] : [];
  });
}

export function RatioTrend({
  platforms,
  scope,
}: {
  platforms: EconomicsPlatform[];
  /**
   * "1 of 5 venues" — computed by the page from the shared coverage projection,
   * not counted again here. The zone's title claims a scope ("where payouts CAN
   * be counted"), so the chip that qualifies it has to be the same arithmetic the
   * KPI label above used, or the page states two scopes for one leg.
   */
  scope: string;
}) {
  const lines: Line[] = platforms
    .map((p, i) => ({ key: p.key, name: p.name, color: COLORS[i % COLORS.length], points: weeklyRatio(p).slice(-WEEKS) }))
    .filter((l) => l.points.length >= 2);

  const held = platforms.filter((p) => p.outboundDaily.length === 0 && p.heldReason);

  if (lines.length === 0) {
    return (
      <Section
        title="Where payouts can be counted"
        readMe="payout ÷ spend, by platform, week over week"
        right={<VenueCountChip>{scope}</VenueCountChip>}
        fill
      >
        <p className="text-[12.5px] text-ink-3">
          No platform has two complete weeks with both legs published yet.
        </p>
      </Section>
    );
  }

  const all = lines.flatMap((l) => l.points.map((p) => p.v));
  // Always include 100 in the domain — the baseline IS the reading.
  const lo = Math.min(100, ...all) * 0.96;
  const hi = Math.max(100, ...all) * 1.04;
  const span = hi - lo || 1;
  const n = Math.max(...lines.map((l) => l.points.length));
  const x = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => PAD_T + (1 - (v - lo) / span) * (PLOT_H - PAD_T * 2);

  return (
    <Section
      title="Where payouts can be counted"
      readMe="payout ÷ spend, by platform, week over week"
      subtitle={`Last ${WEEKS} complete weeks · 100% marked`}
      right={<VenueCountChip>{scope}</VenueCountChip>}
      fill
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap gap-x-3 gap-y-1 pb-2 text-[11px]">
          {lines.map((l) => (
            <span key={l.key} className="inline-flex items-center gap-1.5 text-ink-3">
              <span aria-hidden className="h-0.5 w-3" style={{ background: l.color }} />
              {l.name}
              <span className="tabular text-ink-2">{l.points.at(-1)!.v.toFixed(1)}%</span>
            </span>
          ))}
        </div>

        <svg viewBox={`0 0 100 ${PLOT_H}`} preserveAspectRatio="none" className="h-[150px] w-full" role="img" aria-label="Payout to spend ratio by platform, last 12 complete weeks">
          {/* The 100% baseline — above it, more left than came in. */}
          <line x1="0" y1={y(100)} x2="100" y2={y(100)} stroke="var(--color-line-2)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          {lines.map((l) => (
            <path
              key={l.key}
              d={l.points.map((p, i) => `${i ? "L" : "M"}${x(i + (n - l.points.length)).toFixed(2)} ${y(p.v).toFixed(2)}`).join(" ")}
              fill="none"
              stroke={l.color}
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-ink-4">
          <span>{lines[0].points[0].ts.slice(0, 10)}</span>
          <span className="text-ink-3">100% = paid out what came in</span>
          <span>{lines[0].points.at(-1)!.ts.slice(0, 10)}</span>
        </div>

        {held.length > 0 && (
          <div className="mt-auto pt-2 text-[10.5px] text-ink-4">
            Not shown:{" "}
            {held.map((p) => (
              <span key={p.key} className="mr-2 inline-flex items-center gap-1">
                {p.name}
                <HeldChip reasons={[p.heldReason!]} />
              </span>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
