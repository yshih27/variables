import Link from "next/link";
import type { GachaPlatformRow } from "@/lib/data/fetchGacha";
import type { Chain } from "@/lib/types";
import { formatCompactUsd, formatInt } from "@/lib/format";

const CHAIN_DOT: Record<Chain, string> = {
  Polygon: "var(--color-purple)",
  Solana: "var(--color-solana)",
  Base: "var(--color-blue)",
  Ethereum: "#9aa6ff",
};

/**
 * Per-platform deep-dive: one block per platform with its pack-price
 * distribution as horizontal bars, plus key stats and a link out.
 */
export function GachaPlatformDeepDive({ rows }: { rows: GachaPlatformRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="mb-5 text-[22px] font-semibold tracking-[-0.005em]">
        Pulls by Price · 24h
      </h2>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {rows.map((row) => (
          <PlatformBlock key={row.key} row={row} />
        ))}
      </div>
    </section>
  );
}

function PlatformBlock({ row }: { row: GachaPlatformRow }) {
  const hasData = row.byAmount24h.length > 0;
  const max = hasData ? Math.max(...row.byAmount24h.map((b) => b.vol)) : 0;
  return (
    <div className="flex flex-col rounded-xl border border-line/70 bg-bg-1 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[15px] font-semibold">{row.name}</span>
            <span className="inline-flex items-center gap-1 rounded-md border border-line/50 bg-bg-2 px-1.5 py-0.5 text-[10px] text-ink-2">
              <span
                className="h-1 w-1 rounded-full"
                style={{ background: CHAIN_DOT[row.chain] }}
              />
              {row.chain}
            </span>
          </div>
          <div className="text-[11px] text-ink-3">
            {row.pulls24h > 0
              ? `${formatInt(row.pulls24h)} pulls · ${formatCompactUsd(row.vol24Usd)} volume · avg ${formatCompactUsd(row.avgPullUsd)}`
              : "No activity in the last 24h."}
          </div>
        </div>
        <Link
          href={`/platform/${row.key}`}
          className="rounded-md border border-line/60 px-2.5 py-1 text-[11px] text-ink-3 transition-colors hover:border-yellow/40 hover:text-yellow"
        >
          Platform →
        </Link>
      </div>

      {hasData ? (
        <div className="flex flex-col gap-2">
          {row.byAmount24h.map((b) => {
            const widthPct = max > 0 ? (b.vol / max) * 100 : 0;
            return (
              <div
                key={b.amount}
                className="grid grid-cols-[56px_1fr_auto] items-center gap-3"
              >
                <span className="text-[12px] font-semibold tabular text-ink">
                  ${b.amount}
                </span>
                <div className="relative h-5 overflow-hidden rounded-md bg-bg-2">
                  <div
                    className="absolute inset-y-0 left-0 bg-yellow/80"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                <span className="whitespace-nowrap text-[11px] tabular text-ink-2">
                  {formatInt(b.count)}
                  <span className="ml-1 text-ink-3">· {(b.share * 100).toFixed(1)}%</span>
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyPlatform row={row} />
      )}

      {row.odds && row.odds.length > 0 && <OddsBreakdown odds={row.odds} />}

      {row.warning && (
        <div className="mt-4 rounded-md border border-line/50 bg-bg-2 px-3 py-2 text-[11px] text-ink-3">
          {row.warning}
        </div>
      )}
    </div>
  );
}

const TIER_COLOR: Record<string, string> = {
  SPrT: "#f3ff42", // jackpot — yellow
  LGND: "#ffb84d", // legendary — gold
  Epic: "#c77dff", // epic — purple
  High: "#5fa3ff", // high — blue
  Mid: "#6cf48a", // mid — green
  Low: "#707070", // common — grey
};

function OddsBreakdown({ odds }: { odds: NonNullable<GachaPlatformRow["odds"]> }) {
  return (
    <div className="mt-4 border-t border-line/50 pt-4">
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">
          Odds · realized 7d
        </span>
        <span className="text-[10px] text-ink-4">on-chain prize delivery</span>
      </div>
      {/* Stacked distribution bar */}
      <div className="mb-3 flex h-2.5 overflow-hidden rounded-full">
        {odds.map((o) => (
          <div
            key={o.tier}
            style={{ width: `${o.pct * 100}%`, background: TIER_COLOR[o.tier] ?? "#707070" }}
            title={`${o.tier}: ${(o.pct * 100).toFixed(2)}%`}
          />
        ))}
      </div>
      {/* Per-tier legend */}
      <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
        {odds.map((o) => (
          <div key={o.tier} className="flex items-center gap-1.5 text-[11px]">
            <span
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{ background: TIER_COLOR[o.tier] ?? "#707070" }}
            />
            <span className="text-ink-2">{o.tier}</span>
            <span className="ml-auto tabular font-semibold text-ink">
              {o.pct >= 0.01 ? `${(o.pct * 100).toFixed(1)}%` : `${(o.pct * 100).toFixed(2)}%`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyPlatform({ row }: { row: GachaPlatformRow }) {
  return (
    <div className="rounded-md border border-dashed border-line/60 bg-bg-2/40 px-4 py-6 text-center text-[11.5px] text-ink-3">
      {row.packPrices.length > 0 ? (
        <>
          Pack prices: {row.packPrices.map((p) => `$${p}`).join(" · ")}
          <br />
          No pulls captured in the warmer&apos;s last run.
        </>
      ) : (
        <>No gacha mechanic tracked here yet.</>
      )}
    </div>
  );
}
