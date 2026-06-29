import type { IPDetail } from "@/lib/data/fetchIP";
import { IPIcon } from "./IPIcon";
import { formatCompactUsd, formatInt } from "@/lib/format";

type Props = {
  detail: IPDetail;
  /** Real per-IP market cap from the marketcap snapshot (0 → not available). */
  mcapUsd: number;
  /** Market-cap 24h change %, or null when history isn't available yet. */
  mcapPct: number | null;
};

/**
 * Pinned left rail for the IP/category page — the key live stats. Sticky under
 * the nav on desktop (only the right column scrolls); stacks on top on mobile.
 * Display text is Space Grotesk; every number is mono + tabular.
 */
export function IPRail({ detail, mcapUsd, mcapPct }: Props) {
  const rows = [
    { k: "24h Trades", sub: "secondary sales", v: formatInt(detail.trades24h) },
    {
      k: "Active Wallets",
      sub: `${formatInt(detail.uniqueBuyers)} buyer${detail.uniqueBuyers === 1 ? "" : "s"} · ${formatInt(detail.uniqueSellers)} seller${detail.uniqueSellers === 1 ? "" : "s"}`,
      v: formatInt(detail.uniqueWallets),
    },
    { k: "Cards Traded", sub: "distinct tokens", v: formatInt(detail.uniqueCards) },
    { k: "Avg Trade", sub: "per sale", v: formatCompactUsd(detail.avgTradeUsd) },
    { k: "Highest Sale", sub: "last 24h", v: formatCompactUsd(detail.highSaleUsd) },
    { k: "Platforms", sub: "marketplaces tracked", v: formatInt(detail.uniquePlatforms) },
  ];

  return (
    <aside className="font-sans min-[860px]:h-full min-[860px]:min-h-0 min-[860px]:overflow-hidden min-[860px]:border-r min-[860px]:border-line min-[860px]:pr-7">
      <div className="flex min-h-full flex-col pb-6 pt-7">
        {/* Identity */}
        <div className="mb-6 flex items-center gap-3.5">
          <IPIcon
            name={detail.ip.name}
            short={detail.ip.short}
            color={detail.ip.color}
            logo={detail.ip.logo}
            iconBlendMode={detail.ip.iconBlendMode}
            emoji={detail.ip.emoji}
            size={48}
          />
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[25px] font-bold leading-none tracking-[-0.02em]">
              {detail.ip.name}
            </h1>
            <span className="rounded-[7px] border border-yellow/30 bg-yellow/10 px-[7px] py-0.5 font-mono text-[12px] font-semibold text-yellow">
              #{detail.rank}
            </span>
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
              value={mcapUsd > 0 ? formatCompactUsd(mcapUsd) : "—"}
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
              className="flex items-baseline justify-between gap-3 border-b border-line py-[15px]"
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
        <div className="mt-auto flex gap-2 pt-[22px]">
          <RailButton>★ Watchlist</RailButton>
          <RailButton>↗ Share</RailButton>
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

function RailButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="flex h-[38px] flex-1 items-center justify-center gap-2 rounded-[11px] border border-line-2 bg-transparent text-[13px] font-semibold text-ink transition-colors hover:bg-bg-2"
    >
      {children}
    </button>
  );
}
