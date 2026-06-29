import type { IPDetail } from "@/lib/data/fetchIP";
import { IPIcon } from "./IPIcon";
import { Sparkline } from "./Sparkline";
import { formatCompactUsd, formatPct, formatInt } from "@/lib/format";

/**
 * Sticky left rail for the IP detail page: identity, the headline 24h volume,
 * and the key per-IP stats stacked as a scannable list. Pins on desktop while
 * the right column (chart + trait breakdowns) scrolls.
 */
export function IPSidebar({ detail }: { detail: IPDetail }) {
  // Colour the % change by its own sign (not the sparkline trend, which can
  // disagree and paint a decline green).
  const pctCls =
    detail.vol24Pct == null || detail.vol24Pct === 0
      ? "text-ink-3"
      : detail.vol24Pct > 0
        ? "text-green"
        : "text-red";

  const mcap = detail.totalMcapUsd > 0 ? formatCompactUsd(detail.totalMcapUsd) : "—";

  return (
    <div className="rounded-2xl border border-line bg-bg-1 p-6">
      {/* Identity */}
      <div className="flex items-center gap-3">
        <IPIcon
          name={detail.ip.name}
          short={detail.ip.short}
          color={detail.ip.color}
          logo={detail.ip.logo}
          iconBlendMode={detail.ip.iconBlendMode}
          emoji={detail.ip.emoji}
          size={44}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[22px] font-bold leading-tight tracking-[-0.01em]">
              {detail.ip.name}
            </h1>
            <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-bg-2 px-1.5 text-[10px] font-semibold text-ink-2">
              #{detail.rank}
            </span>
          </div>
          <div className="text-[11.5px] text-ink-3">
            {detail.uniqueCards.toLocaleString()} card{detail.uniqueCards === 1 ? "" : "s"} ·{" "}
            {detail.uniquePlatforms} platform{detail.uniquePlatforms === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {/* Headline 24h volume */}
      <div className="mt-6">
        <div className="text-[11px] uppercase tracking-[0.06em] text-ink-3">24h Volume</div>
        <div className="mt-1.5 flex items-baseline gap-2.5">
          <span className="text-[34px] font-semibold leading-none tabular tracking-[-0.01em] text-yellow">
            {formatCompactUsd(detail.vol24Usd)}
          </span>
          {detail.vol24Pct != null && (
            <span className={`text-[13px] font-semibold tabular ${pctCls}`}>
              {detail.vol24Pct > 0 ? "▲" : detail.vol24Pct < 0 ? "▼" : "·"}{" "}
              {formatPct(detail.vol24Pct).replace(/^[+−]/, "")}
            </span>
          )}
        </div>
        <div className="mt-3">
          <Sparkline data={detail.spark24h} trend={detail.trend} width={290} height={44} />
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-3">
          <span className="tabular text-ink-2">{formatCompactUsd(detail.lowSaleUsd)}</span>
          <RangeBar low={detail.lowSaleUsd} high={detail.highSaleUsd} avg={detail.avgTradeUsd} />
          <span className="tabular text-ink-2">{formatCompactUsd(detail.highSaleUsd)}</span>
        </div>
      </div>

      {/* Key stats */}
      <div className="mt-6 border-t border-line/60">
        <StatRow label="Market Cap" sub="insured value" value={mcap} />
        <StatRow label="24h Trades" sub="secondary sales" value={formatInt(detail.trades24h)} />
        <StatRow
          label="Active Wallets"
          sub={`${formatInt(detail.uniqueBuyers)} buyer${detail.uniqueBuyers === 1 ? "" : "s"} · ${formatInt(detail.uniqueSellers)} seller${detail.uniqueSellers === 1 ? "" : "s"}`}
          value={formatInt(detail.uniqueWallets)}
        />
        <StatRow label="Cards Traded" sub="distinct tokens" value={formatInt(detail.uniqueCards)} />
        <StatRow label="Avg Trade" sub="per sale" value={formatCompactUsd(detail.avgTradeUsd)} />
        <StatRow label="Highest Sale" sub="last 24h" value={formatCompactUsd(detail.highSaleUsd)} />
      </div>
    </div>
  );
}

function StatRow({ label, sub, value }: { label: string; sub?: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/40 py-3 last:border-0">
      <div className="flex min-w-0 flex-col">
        <span className="text-[12.5px] text-ink-3">{label}</span>
        {sub && <span className="truncate text-[10.5px] text-ink-4">{sub}</span>}
      </div>
      <span className="shrink-0 tabular text-[15px] font-semibold text-ink">{value}</span>
    </div>
  );
}

function RangeBar({ low, high, avg }: { low: number; high: number; avg: number }) {
  if (high <= low) return <span className="h-1 flex-1 rounded-full bg-bg-2" />;
  const pct = Math.max(0, Math.min(1, (avg - low) / (high - low))) * 100;
  return (
    <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-bg-2">
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-yellow"
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

/**
 * Data-quality caveat shown above the volume chart when a single market-maker
 * wallet dominates buy-side volume.
 */
export function BuybackNote({ detail }: { detail: IPDetail }) {
  if (detail.buybackConcentration < 0.7) return null;
  const pct = Math.round(detail.buybackConcentration * 100);
  return (
    <div className="mb-8 flex items-start gap-3 rounded-xl border border-line bg-bg-1 p-4 text-[12.5px]">
      <span className="text-[16px] leading-none">⚠</span>
      <div className="text-ink-2">
        <span className="font-semibold text-ink">Buyback-bot concentration: </span>
        one wallet absorbs <span className="font-semibold text-yellow">{pct}%</span> of buy-side
        volume in this window. Trade counts and volume reflect real listings, but buyer diversity is
        artificially low — a single market-maker contract is sweeping listings.
      </div>
    </div>
  );
}
