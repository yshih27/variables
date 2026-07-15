import Link from "next/link";
import type { PlatformDetail } from "@/lib/data/fetchPlatform";
import { Section } from "./Section";
import { formatCompactUsd } from "@/lib/format";
import { GACHA_ENABLED } from "@/lib/flags";

/**
 * Per-platform gacha tracker. Renders only for platforms with a gacha mechanic
 * (gachaVol24Usd != null). Every figure is realized on-chain pull spend — there
 * is no gacha series in the metric_snapshots spine yet, so instead of a sampled
 * trend line we show the honest real comparison: today's pull volume vs the 7d
 * daily average, plus the 24h revenue split (primary/gacha vs secondary resale).
 */
export function PlatformGachaPanel({ detail }: { detail: PlatformDetail }) {
  if (detail.gachaVol24Usd == null) return null;

  const g24 = detail.gachaVol24Usd;
  const g7 = detail.gachaVol7Usd ?? 0;
  const avgDay = g7 > 0 ? g7 / 7 : 0;
  const pace = avgDay > 0 ? (g24 - avgDay) / avgDay : null;

  // 24h revenue split of all on-chain activity: primary (gacha / tokenization)
  // vs secondary (resale). total24Usd already = secondary + primary.
  const primary = detail.primaryUsd ?? g24;
  const total =
    detail.total24Usd > 0 ? detail.total24Usd : detail.vol24Usd + primary;
  const secondary = Math.max(0, total - primary);
  const primaryShare = total > 0 ? primary / total : 0;

  return (
    <Section
      title="Gacha sales"
      subtitle="Pack-pull spend on this platform · realized on-chain"
      right={
        GACHA_ENABLED ? (
          <Link href="/gacha" className="text-[12px] text-ink-3 transition-colors hover:text-yellow">
            Full gacha breakdown →
          </Link>
        ) : undefined
      }
      className="mb-12 font-sans"
    >
      <div className="grid grid-cols-1 gap-6 pt-1 min-[760px]:grid-cols-[1fr_1px_1fr] min-[760px]:gap-8">
        {/* Pull volume + pace */}
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">
            24h Pull Volume
          </div>
          <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-[34px] font-semibold leading-none tracking-[-0.03em] tabular text-yellow">
              {formatCompactUsd(g24)}
            </span>
            {pace != null && Number.isFinite(pace) && (
              <span
                className={`font-mono text-[13px] font-semibold ${pace > 0 ? "text-green" : pace < 0 ? "text-red" : "text-ink-4"}`}
              >
                {pace > 0 ? "▲" : pace < 0 ? "▼" : "·"} {Math.abs(pace * 100).toFixed(0)}%{" "}
                <span className="font-normal text-ink-4">vs 7d avg</span>
              </span>
            )}
          </div>
          <div className="mt-6 grid grid-cols-2 gap-5">
            <Mini label="7d Pull Volume" value={formatCompactUsd(g7)} />
            <Mini label="7d daily avg" value={formatCompactUsd(avgDay)} />
          </div>
        </div>

        <div className="hidden bg-line min-[760px]:block" />

        {/* Revenue split */}
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">
            Revenue mix · 24h
          </div>
          <div className="mt-3.5 flex h-2.5 overflow-hidden rounded-none bg-bg-3">
            <span className="h-full bg-yellow" style={{ width: `${primaryShare * 100}%` }} />
            <span className="h-full bg-blue" style={{ width: `${(1 - primaryShare) * 100}%` }} />
          </div>
          <div className="mt-4 flex flex-col gap-2.5">
            <SplitRow color="var(--color-yellow)" label="Primary · gacha" value={formatCompactUsd(primary)} pct={primaryShare} />
            <SplitRow color="var(--color-blue)" label="Secondary · resale" value={formatCompactUsd(secondary)} pct={1 - primaryShare} />
          </div>
        </div>
      </div>
    </Section>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-4">{label}</div>
      <div className="mt-1.5 font-mono text-[18px] font-semibold tabular text-ink">{value}</div>
    </div>
  );
}

function SplitRow({
  color,
  label,
  value,
  pct,
}: {
  color: string;
  label: string;
  value: string;
  pct: number;
}) {
  return (
    <div className="flex items-center gap-2.5 text-[12.5px]">
      <span className="h-2.5 w-2.5 shrink-0 rounded-md" style={{ background: color }} />
      <span className="flex-1 text-ink-2">{label}</span>
      <span className="font-mono tabular text-ink-3">{Math.round(pct * 100)}%</span>
      <span className="w-[58px] text-right font-mono font-semibold tabular text-ink">{value}</span>
    </div>
  );
}
