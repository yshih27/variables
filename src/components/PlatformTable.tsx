"use client";

import { useState } from "react";
import Link from "next/link";
import type { PlatformRow, Chain } from "@/lib/types";
import { Sparkline } from "./Sparkline";
import { formatCompactUsd, formatCompactNumber, formatInt } from "@/lib/format";

const CHAIN_DOT: Record<Chain, string> = {
  Polygon: "var(--color-purple)",
  Solana: "var(--color-solana)",
  Base: "var(--color-blue)",
  Ethereum: "#9aa6ff",
};

type Props = { rows: PlatformRow[] };

type SortKey = "total" | "dom" | "vol24" | "gacha" | "vol7" | "active" | "cards" | "holders" | "avgTrade";

function valueFor(p: PlatformRow, key: SortKey): number {
  switch (key) {
    case "total":
    case "dom":
      return p.total24Usd; // share ranks identically to total activity
    case "vol24":
      return p.vol24Usd;
    case "gacha":
      return p.gachaVol24Usd ?? NaN;
    case "vol7":
      return p.vol7Usd;
    case "active":
      return p.active24h;
    case "cards":
      return p.cards;
    case "holders":
      return p.holders;
    case "avgTrade":
      return p.avgTradeUsd;
  }
}

function cmp(a: number, b: number, dir: 1 | -1): number {
  const an = !Number.isFinite(a);
  const bn = !Number.isFinite(b);
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  return (a - b) * dir;
}

export function PlatformTable({ rows }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [dir, setDir] = useState<1 | -1>(-1);

  const totalActivity = rows.reduce((s, p) => s + (p.total24Usd > 0 ? p.total24Usd : 0), 0) || 1;
  const sorted = [...rows].sort((a, b) => cmp(valueFor(a, sortKey), valueFor(b, sortKey), dir));

  function onSort(key: SortKey) {
    if (key === sortKey) setDir((d) => (d === -1 ? 1 : -1));
    else {
      setSortKey(key);
      setDir(-1);
    }
  }
  const sp = (key: SortKey) => ({ active: sortKey === key, dir, onClick: () => onSort(key) });

  return (
    <section className="mt-14">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.005em]">Top Platforms</h2>
          <div className="mt-1 text-[12px] text-ink-3">Where the trading happens.</div>
        </div>
      </div>

      <div className="scroll-x">
        <table className="w-full min-w-0 border-collapse text-[13px] md:min-w-[1120px]">
          <thead>
            <tr className="border-b border-line">
              <Th>#</Th>
              <Th>Platform</Th>
              <Th className="hidden md:table-cell">Chain</Th>
              <Th className="hidden md:table-cell">Vault</Th>
              <SortTh align="right" title="Total 24h activity — marketplace resale + gacha + other primary" {...sp("total")}>Total 24h</SortTh>
              <SortTh align="right" className="hidden md:table-cell" title="Share of total 24h activity across platforms" {...sp("dom")}>Share</SortTh>
              <SortTh align="right" className="hidden md:table-cell" title="Secondary-market resale volume, 24h" {...sp("vol24")}>Marketplace</SortTh>
              <SortTh align="right" className="hidden md:table-cell" title="Gacha pack-pull spend, 24h" {...sp("gacha")}>Gacha</SortTh>
              <SortTh align="right" className="hidden md:table-cell" {...sp("vol7")}>7d Vol</SortTh>
              <SortTh align="right" className="hidden md:table-cell" title="Unique wallets (buyers ∪ sellers) active in 24h" {...sp("active")}>
                Active 24h
              </SortTh>
              <SortTh align="right" className="hidden md:table-cell" title="Unique cards traded in 24h" {...sp("cards")}>
                Cards 24h
              </SortTh>
              <SortTh align="right" className="hidden md:table-cell" {...sp("holders")}>Holders</SortTh>
              <SortTh align="right" className="hidden md:table-cell" {...sp("avgTrade")}>Avg Trade</SortTh>
              <Th className="hidden md:table-cell">24h Chart</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => {
              // Primary-market venues (gacha / tokenization) can post real revenue
              // with no secondary trades — tag them so the dashed row reads as
              // intentional rather than broken data.
              const primaryOnly = !(p.vol24Usd > 0) && p.primaryUsd != null && p.primaryUsd > 0;
              return (
              <tr key={p.key} className="group relative cursor-pointer transition-colors hover:bg-bg-2">
                <Td className="w-[44px] text-ink-3">{String(i + 1).padStart(2, "0")}</Td>
                <Td>
                  <Link
                    href={`/platform/${p.key}`}
                    className="flex items-center gap-2.5 font-semibold before:absolute before:inset-0 before:content-['']"
                  >
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-bg-2 text-[11px] font-bold">
                      {p.short}
                    </span>
                    <span className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2.5">
                      <span className="font-sans group-hover:text-yellow">{p.name}</span>
                      {primaryOnly && (
                        <span className="rounded border border-line px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.06em] text-ink-3">
                          primary only
                        </span>
                      )}
                    </span>
                  </Link>
                </Td>
                <Td className="hidden md:table-cell">
                  <span className="inline-flex h-[22px] items-center gap-1.5 text-[12px] text-ink-2">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: CHAIN_DOT[p.chain] }} />
                    {p.chain}
                  </span>
                </Td>
                <Td muted className="hidden md:table-cell">{p.vault ?? "—"}</Td>
                <Td align="right" strong>{p.total24Usd > 0 ? formatCompactUsd(p.total24Usd) : "—"}</Td>
                <Td align="right" muted className="hidden md:table-cell">{shareCell(p, totalActivity)}</Td>
                <Td align="right" className="hidden md:table-cell">{p.vol24Usd > 0 ? formatCompactUsd(p.vol24Usd) : "—"}</Td>
                <Td align="right" className="hidden md:table-cell">{p.gachaVol24Usd != null && p.gachaVol24Usd > 0 ? formatCompactUsd(p.gachaVol24Usd) : "—"}</Td>
                <Td align="right" muted className="hidden md:table-cell">
                  {Number.isFinite(p.vol7Usd) ? formatCompactUsd(p.vol7Usd) : "—"}
                </Td>
                <Td align="right" className="hidden md:table-cell">{formatInt(p.active24h)}</Td>
                <Td align="right" className="hidden md:table-cell">
                  {Number.isFinite(p.cards) && p.cards > 0 ? formatCompactNumber(p.cards) : "—"}
                </Td>
                <Td align="right" className="hidden md:table-cell">{formatInt(p.holders)}</Td>
                <Td align="right" className="hidden md:table-cell">{p.avgTradeUsd > 0 ? formatCompactUsd(p.avgTradeUsd) : "—"}</Td>
                <Td className="hidden md:table-cell">{p.spark.length > 0 ? <Sparkline data={p.spark} trend={p.trend} /> : "—"}</Td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** A platform's share of total 24h activity across all platforms. */
function shareCell(p: PlatformRow, total: number): string {
  if (!(p.total24Usd > 0)) return "—";
  return `${((p.total24Usd / total) * 100).toFixed(1)}%`;
}

function Th({
  children,
  align,
  title,
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  title?: string;
  className?: string;
}) {
  return (
    <th
      title={title}
      className={`px-3 py-3 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 sm:px-4 ${
        align === "right" ? "text-right" : "text-left"
      } ${title ? "cursor-help" : ""} ${className}`}
    >
      {children}
    </th>
  );
}

function SortTh({
  children,
  align,
  title,
  active,
  dir,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  title?: string;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
  className?: string;
}) {
  return (
    <th
      onClick={onClick}
      title={title}
      aria-sort={active ? (dir === -1 ? "descending" : "ascending") : "none"}
      className={`cursor-pointer select-none px-3 py-3 text-[11px] font-medium uppercase tracking-[0.06em] transition-colors sm:px-4 ${
        active ? "text-ink" : "text-ink-3 hover:text-ink-2"
      } ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <span className={active ? "text-yellow" : "text-ink-4"}>
          {active ? (dir === -1 ? "▼" : "▲") : "↕"}
        </span>
        {children}
      </span>
    </th>
  );
}

function Td({
  children,
  align,
  className = "",
  strong,
  muted,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
  strong?: boolean;
  muted?: boolean;
}) {
  const alignCls = align === "right" ? "text-right" : "";
  const weightCls = strong ? "font-semibold text-ink" : muted ? "text-ink-2" : "";
  return (
    <td className={`tabular whitespace-nowrap border-b border-line/60 px-3 py-4 sm:px-4 ${alignCls} ${weightCls} ${className}`}>
      {children}
    </td>
  );
}
