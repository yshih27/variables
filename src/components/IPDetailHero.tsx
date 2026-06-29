import type { IPDetail } from "@/lib/data/fetchIP";
import { IPIcon } from "./IPIcon";
import { Sparkline } from "./Sparkline";
import { formatCompactUsd, formatPct, formatInt } from "@/lib/format";

type Props = { detail: IPDetail };

export function IPDetailHero({ detail }: Props) {
  // Colour the % change by its own sign — not by detail.trend (the sparkline's
  // shape), which can disagree and paint a decline green.
  const pctCls =
    detail.vol24Pct == null || detail.vol24Pct === 0
      ? "text-ink-3"
      : detail.vol24Pct > 0
        ? "text-green"
        : "text-red";

  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-center gap-3 text-[12px] text-ink-3">
        <a href="/" className="hover:text-ink-2">Rankings</a>
        <span>›</span>
        <span className="text-ink-2">{detail.ip.name}</span>
      </div>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <div className="flex items-center gap-4">
          <IPIcon
            name={detail.ip.name}
            short={detail.ip.short}
            color={detail.ip.color}
            logo={detail.ip.logo}
            iconBlendMode={detail.ip.iconBlendMode}
            emoji={detail.ip.emoji}
            size={56}
          />
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="text-[32px] font-bold leading-none tracking-[-0.01em]">
                {detail.ip.name}
              </h1>
              <span className="inline-flex h-6 items-center rounded-md bg-bg-2 px-2 text-[11px] font-semibold text-ink-2">
                #{detail.rank}
              </span>
            </div>
            <span className="text-[12px] text-ink-3">
              {detail.uniqueCards.toLocaleString()} card{detail.uniqueCards === 1 ? "" : "s"} traded ·{" "}
              {detail.uniquePlatforms} platform{detail.uniquePlatforms === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.06em] text-ink-3">24h Volume</span>
          <div className="flex items-baseline gap-3">
            <span className="text-[42px] font-semibold leading-none tracking-[-0.01em] tabular text-yellow">
              {formatCompactUsd(detail.vol24Usd)}
            </span>
            {detail.vol24Pct != null && (
              <span className={`text-[14px] font-semibold tabular ${pctCls}`}>
                {detail.vol24Pct > 0 ? "▲" : detail.vol24Pct < 0 ? "▼" : "·"}{" "}
                {formatPct(detail.vol24Pct).replace(/^[+−]/, "")}
              </span>
            )}
          </div>
        </div>

        <div className="ml-auto">
          <Sparkline data={detail.spark24h} trend={detail.trend} width={220} height={48} />
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-3">
        <span>24h Range</span>
        <span className="tabular text-ink-2">{formatCompactUsd(detail.lowSaleUsd)}</span>
        <RangeBar low={detail.lowSaleUsd} high={detail.highSaleUsd} avg={detail.avgTradeUsd} />
        <span className="tabular text-ink-2">{formatCompactUsd(detail.highSaleUsd)}</span>
      </div>
    </section>
  );
}

function RangeBar({ low, high, avg }: { low: number; high: number; avg: number }) {
  if (high <= low) return <span className="h-1 flex-1 rounded-full bg-bg-2" />;
  const pct = Math.max(0, Math.min(1, (avg - low) / (high - low))) * 100;
  return (
    <span className="relative h-1 w-44 flex-shrink-0 overflow-hidden rounded-full bg-bg-2">
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-yellow"
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

export function IPDetailStats({ detail }: { detail: IPDetail }) {
  const mcapValue = detail.totalMcapUsd > 0 ? formatCompactUsd(detail.totalMcapUsd) : "—";
  const mcapSub =
    detail.totalMcapUsd > 0
      ? "of cards traded · 24h"
      : "needs insured-value trait";
  const buybackPct = Math.round(detail.buybackConcentration * 100);
  const isBuybackDominated = detail.buybackConcentration >= 0.7;

  return (
    <>
      <section className="mb-10 grid grid-cols-2 gap-x-10 gap-y-7 md:grid-cols-3 lg:grid-cols-6">
        <Cell label="Insured Value" value={mcapValue} sub={mcapSub} />
        <Cell
          label="24h Trades"
          value={formatInt(detail.trades24h)}
          sub={`${detail.uniquePlatforms} platform${detail.uniquePlatforms === 1 ? "" : "s"}`}
        />
        <Cell
          label="Active Wallets"
          value={formatInt(detail.uniqueWallets)}
          sub={`${formatInt(detail.uniqueBuyers)} buyers · ${formatInt(detail.uniqueSellers)} sellers`}
        />
        <Cell
          label="Cards Traded"
          value={formatInt(detail.uniqueCards)}
          sub="distinct tokens"
        />
        <Cell
          label="Avg Trade"
          value={formatCompactUsd(detail.avgTradeUsd)}
          sub="per sale"
        />
        <Cell
          label="High Sale"
          value={formatCompactUsd(detail.highSaleUsd)}
          sub="last 24h"
        />
      </section>
      {isBuybackDominated && (
        <div className="mb-10 flex items-start gap-3 rounded-xl border border-line bg-bg-1 p-4 text-[12.5px]">
          <span className="text-[16px]">⚠</span>
          <div className="text-ink-2">
            <span className="font-semibold text-ink">Buyback-bot concentration: </span>
            one wallet absorbs <span className="font-semibold text-yellow">{buybackPct}%</span>{" "}
            of buy-side volume in this window. Trade counts and volume reflect real listings,
            but buyer diversity is artificially low — a single market-maker contract is
            sweeping listings.
          </div>
        </div>
      )}
    </>
  );
}

function Cell({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] uppercase tracking-[0.06em] text-ink-3">{label}</span>
      <span className="text-[24px] font-semibold tracking-[-0.01em] tabular">{value}</span>
      <span className="text-[11.5px] text-ink-3">{sub}</span>
    </div>
  );
}
