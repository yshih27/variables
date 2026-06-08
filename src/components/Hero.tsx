import type { HeroStats } from "@/lib/types";
import { formatCompactUsd, formatCompactNumber, formatPct, formatInt } from "@/lib/format";
import { FreshnessChips } from "@/components/FreshnessChip";

type Props = { stats: HeroStats };

function DeltaText({ pct, suffix }: { pct: number | null; suffix?: string }) {
  if (pct == null) {
    return <span className="text-[12px] text-ink-3">—{suffix ? ` · ${suffix}` : ""}</span>;
  }
  const up = pct > 0;
  const down = pct < 0;
  const cls = up ? "text-green" : down ? "text-red" : "text-ink-3";
  const arrow = up ? "▲" : down ? "▼" : "·";
  return (
    <span className={`text-[12px] tabular ${cls}`}>
      <span className="mr-0.5">{arrow}</span>
      {formatPct(pct).replace(/^[+−]/, "")}
      {suffix ? ` · ${suffix}` : ""}
    </span>
  );
}

function Cell({
  label,
  value,
  delta,
  yellow,
}: {
  label: string;
  value: React.ReactNode;
  delta: React.ReactNode;
  yellow?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 px-1 py-1">
      <span className="text-[11px] uppercase tracking-[0.06em] text-ink-3">{label}</span>
      <span
        className={`text-[28px] font-semibold tracking-[-0.01em] tabular ${
          yellow ? "text-yellow" : "text-ink"
        }`}
      >
        {value}
      </span>
      <span className="text-[12px] text-ink-2">{delta}</span>
    </div>
  );
}

export function Hero({ stats }: Props) {
  return (
    <section className="mb-12">
      <div className="mb-7 flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-end">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-3">
            Tokenized Collectibles
          </span>
          <h1 className="text-[44px] font-bold leading-[1.05] tracking-[-0.02em]">
            The market for <span className="text-yellow">phygital</span> collectibles.
          </h1>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <FreshnessChips sources={["marketcap", "core-volume", "holders"]} />
          <div className="flex items-center gap-3 text-[12px] text-ink-3">
            <span>{stats.ipsTracked} IPs</span>
            <span>·</span>
            <span>{stats.platformsTracked} platforms</span>
            <span>·</span>
            <a href="/status" className="underline-offset-2 hover:text-ink-2 hover:underline">
              data status
            </a>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-10 gap-y-7 md:grid-cols-3 lg:grid-cols-6">
        <Cell
          label="Total Market Cap"
          value={formatCompactUsd(stats.totalMcapUsd)}
          delta={<DeltaText pct={stats.mcapPct24h} suffix="24h" />}
          yellow
        />
        <Cell
          label="24h Volume"
          value={formatCompactUsd(stats.vol24Usd)}
          delta={<DeltaText pct={stats.vol24Pct} />}
        />
        <Cell
          label="7d Volume"
          value={formatCompactUsd(stats.vol7Usd)}
          delta={<DeltaText pct={stats.vol7Pct} />}
        />
        <Cell
          label="Total Cards"
          value={formatCompactNumber(stats.totalCards)}
          delta={
            <span className="text-[12px] text-ink-3">
              {stats.ipsTracked} IPs · {stats.platformsTracked} platforms
            </span>
          }
        />
        <Cell
          label="Holders"
          value={formatInt(stats.holders)}
          delta={<DeltaText pct={stats.holdersPct7d} suffix="7d" />}
        />
        <Cell
          label="24h Trades"
          value={formatInt(stats.trades24h)}
          delta={<DeltaText pct={stats.trades24hPct} />}
        />
      </div>
    </section>
  );
}
