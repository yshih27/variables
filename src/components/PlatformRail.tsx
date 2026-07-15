import Link from "next/link";
import type { PlatformDetail } from "@/lib/data/fetchPlatform";
import type { Chain } from "@/lib/types";
import { RailActions } from "./RailActions";
import { FreshnessChips } from "./FreshnessChip";
import { formatCompactUsd, formatInt } from "@/lib/format";

const CHAIN_DOT: Record<Chain, string> = {
  Polygon: "var(--color-purple)",
  Solana: "var(--color-solana)",
  Base: "var(--color-blue)",
  Ethereum: "#9aa6ff",
};

type Props = {
  detail: PlatformDetail;
  /** Market-cap 24h change %, or null when history isn't available yet. */
  mcapPct: number | null;
};

/**
 * Pinned left rail for the platform page — mirrors IPRail. Identity + dual hero
 * (24h volume + market cap) + the platform's key live stats, including the
 * signals an IP page can't show: primary-market revenue and market share.
 * Static under the nav on desktop (only the right column scrolls); stacks on
 * mobile. Display text is Inter; every number is mono + tabular.
 */
export function PlatformRail({ detail, mcapPct }: Props) {
  const rows = [
    { k: "7d Volume", sub: "rolling 7 days", v: formatCompactUsd(detail.vol7Usd) },
    {
      k: "Primary 24h",
      sub: detail.primaryUsd == null ? "not tracked" : "gacha / primary",
      v: detail.primaryUsd != null ? formatCompactUsd(detail.primaryUsd) : "—",
    },
    {
      k: "Market Share",
      sub: "of tracked 24h vol",
      v: `${Math.round(detail.marketSharePct * 100)}%`,
    },
    { k: "24h Trades", sub: "secondary sales", v: formatInt(detail.trades24h) },
    {
      k: "Active Wallets",
      sub: `${formatInt(detail.uniqueBuyers)} buyer${detail.uniqueBuyers === 1 ? "" : "s"} · ${formatInt(detail.uniqueSellers)} seller${detail.uniqueSellers === 1 ? "" : "s"}`,
      v: formatInt(detail.uniqueWallets),
    },
    { k: "Avg Trade", sub: "per sale", v: formatCompactUsd(detail.avgTradeUsd) },
    { k: "Holders", sub: "unique owners", v: formatInt(detail.holders) },
  ];

  return (
    <aside className="font-sans min-[860px]:h-full min-[860px]:min-h-0 min-[860px]:overflow-hidden min-[860px]:border-r min-[860px]:border-line min-[860px]:pr-7">
      <div className="flex min-h-full flex-col pb-6 pt-7">
        {/* Identity */}
        <div className="mb-5 flex items-center gap-3.5">
          <span
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-bg-2 text-[17px] font-bold tracking-[0.04em]"
            aria-label={detail.source.name}
          >
            {detail.source.short}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[25px] font-bold leading-none tracking-[-0.02em]">
                {detail.source.name}
              </h1>
              <span className="rounded-xl border border-yellow/30 bg-yellow/10 px-[7px] py-0.5 font-mono text-[12px] font-semibold text-yellow">
                #{detail.rank}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11.5px] text-ink-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-none" style={{ background: CHAIN_DOT[detail.chain] }} />
                {detail.chain}
              </span>
              <span>·</span>
              <span>Vault: <span className="text-ink-2">{detail.source.vault}</span></span>
            </div>
          </div>
        </div>

        {/* Dual hero: 24h Volume + Market Cap */}
        <div className="grid grid-cols-2">
          <HeroStat
            label="24h Volume"
            value={formatCompactUsd(detail.vol24Usd)}
            valueClass="text-yellow"
            pct={detail.vol24Pct}
          />
          <div className="border-l border-line pl-[18px]">
            <HeroStat
              label="Market Cap"
              value={detail.mcapUsd > 0 ? formatCompactUsd(detail.mcapUsd) : "—"}
              valueClass="text-ink"
              pct={mcapPct}
            />
          </div>
        </div>

        {/* Stat list */}
        <div className="mt-[22px] border-t border-line">
          {rows.map((r) => (
            <div
              key={r.k}
              className="flex items-baseline justify-between gap-3 border-b border-line py-[14px]"
            >
              <div className="text-[14px] font-medium text-ink">
                {r.k}
                <span className="mt-[3px] block font-mono text-[11.5px] font-normal tracking-[0.02em] text-ink-4">
                  {r.sub}
                </span>
              </div>
              <div className="whitespace-nowrap text-right font-mono text-[18px] font-semibold tabular">
                {r.v}
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <RailActions name={detail.source.name} />

        {/* X7 — honest per-source freshness for what this page reads; /status
            stays the deep view (no global "data as of" banner). */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <FreshnessChips sources={["core-volume", "marketcap", "listings", "holders"]} />
          <Link href="/status" className="text-[11px] text-ink-4 transition-colors hover:text-yellow">
            /status →
          </Link>
        </div>
      </div>
    </aside>
  );
}

function HeroStat({
  label,
  value,
  valueClass,
  pct,
}: {
  label: string;
  value: string;
  valueClass: string;
  pct: number | null;
}) {
  return (
    <div>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">{label}</div>
      <div
        className={`mt-2.5 font-mono text-[29px] font-semibold leading-none tracking-[-0.03em] tabular ${valueClass}`}
      >
        {value}
      </div>
      {pct != null && Number.isFinite(pct) ? (
        <div
          className={`mt-2 font-mono text-[11.5px] font-semibold ${pct > 0 ? "text-green" : pct < 0 ? "text-red" : "text-ink-4"}`}
        >
          {pct > 0 ? "▲" : pct < 0 ? "▼" : "·"} {Math.abs(pct).toFixed(1)}%
        </div>
      ) : (
        <div className="mt-2 h-[14px]" />
      )}
    </div>
  );
}
