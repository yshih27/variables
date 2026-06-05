import type { PlatformDetail } from "@/lib/data/fetchPlatform";
import type { Chain } from "@/lib/types";
import { Sparkline } from "./Sparkline";
import { formatCompactUsd, formatPct, formatInt } from "@/lib/format";

const CHAIN_DOT: Record<Chain, string> = {
  Polygon: "var(--color-purple)",
  Solana: "var(--color-solana)",
  Base: "var(--color-blue)",
  Ethereum: "#9aa6ff",
};

type Props = { detail: PlatformDetail };

export function PlatformDetailHero({ detail }: Props) {
  const trendCls =
    detail.trend === "up" ? "text-green" : detail.trend === "down" ? "text-red" : "text-ink-3";
  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-center gap-3 text-[12px] text-ink-3">
        <a href="/" className="hover:text-ink-2">Rankings</a>
        <span>›</span>
        <span className="text-ink-2">{detail.source.name}</span>
      </div>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <div className="flex items-center gap-4">
          <span
            className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-bg-2 text-[20px] font-bold tracking-[0.04em]"
            aria-label={detail.source.name}
          >
            {detail.source.short}
          </span>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[32px] font-bold leading-none tracking-[-0.01em]">
                {detail.source.name}
              </h1>
              <span className="inline-flex h-6 items-center rounded-md bg-bg-2 px-2 text-[11px] font-semibold text-ink-2">
                #{detail.rank}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
              <span className="inline-flex h-[22px] items-center gap-1.5 text-[12px] text-ink-2">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: CHAIN_DOT[detail.chain] }}
                />
                {detail.chain}
              </span>
              <span>·</span>
              <span>Vault: <span className="text-ink-2">{detail.source.vault}</span></span>
              <span>·</span>
              <span>{formatInt(detail.holders)} holders</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.06em] text-ink-3">24h Volume</span>
          <div className="flex items-baseline gap-3">
            <span className="text-[42px] font-semibold leading-none tracking-[-0.01em] tabular text-yellow">
              {formatCompactUsd(detail.vol24Usd)}
            </span>
            {detail.vol24Pct != null && (
              <span className={`text-[14px] font-semibold tabular ${trendCls}`}>
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

export function PlatformDetailStats({ detail }: { detail: PlatformDetail }) {
  return (
    <section className="mb-10 grid grid-cols-2 gap-x-10 gap-y-7 md:grid-cols-3 lg:grid-cols-6">
      <Cell
        label="Market Cap"
        value={detail.mcapUsd > 0 ? formatCompactUsd(detail.mcapUsd) : "—"}
        sub="across this platform"
      />
      <Cell label="7d Volume" value={formatCompactUsd(detail.vol7Usd)} sub="from disk history" />
      <Cell
        label="Primary"
        value={detail.primaryUsd != null ? formatCompactUsd(detail.primaryUsd) : "—"}
        sub={
          detail.primaryUsd != null && detail.source.key === "courtyard"
            ? "tokenization (24h, est)"
            : "n/a"
        }
      />
      <Cell label="24h Trades" value={formatInt(detail.trades24h)} sub="secondary sales" />
      <Cell
        label="Active Wallets"
        value={formatInt(detail.uniqueWallets)}
        sub={`${formatInt(detail.uniqueBuyers)} buyers · ${formatInt(detail.uniqueSellers)} sellers`}
      />
      <Cell label="Avg Trade" value={formatCompactUsd(detail.avgTradeUsd)} sub="per sale" />
    </section>
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
