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

type SortKey = "vol24" | "vol7" | "primary" | "active" | "cards" | "holders" | "avgTrade";

function valueFor(p: PlatformRow, key: SortKey): number {
  switch (key) {
    case "vol24":
      return p.vol24Usd;
    case "vol7":
      return p.vol7Usd;
    case "primary":
      return p.primaryUsd ?? NaN;
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
  const [sortKey, setSortKey] = useState<SortKey>("vol24");
  const [dir, setDir] = useState<1 | -1>(-1);

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
        <table className="w-full min-w-[1000px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line">
              <Th>#</Th>
              <Th>Platform</Th>
              <Th>Chain</Th>
              <Th>Vault</Th>
              <SortTh align="right" {...sp("vol24")}>24h Vol</SortTh>
              <SortTh align="right" {...sp("vol7")}>7d Vol</SortTh>
              <SortTh align="right" title="Primary-market revenue (gacha / tokenization), 24h" {...sp("primary")}>
                Primary 24h
              </SortTh>
              <SortTh align="right" title="Unique wallets (buyers ∪ sellers) active in 24h" {...sp("active")}>
                Active 24h
              </SortTh>
              <SortTh align="right" title="Unique cards traded in 24h" {...sp("cards")}>
                Cards 24h
              </SortTh>
              <SortTh align="right" {...sp("holders")}>Holders</SortTh>
              <SortTh align="right" {...sp("avgTrade")}>Avg Trade</SortTh>
              <Th>24h Chart</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr key={p.key} className="group relative cursor-pointer transition-colors hover:bg-bg-1">
                <Td className="w-[44px] text-ink-3">{String(i + 1).padStart(2, "0")}</Td>
                <Td>
                  <Link
                    href={`/platform/${p.key}`}
                    className="flex items-center gap-2.5 font-semibold before:absolute before:inset-0 before:content-['']"
                  >
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-bg-2 text-[11px] font-bold">
                      {p.short}
                    </span>
                    <span className="group-hover:text-yellow">{p.name}</span>
                  </Link>
                </Td>
                <Td>
                  <span className="inline-flex h-[22px] items-center gap-1.5 text-[12px] text-ink-2">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: CHAIN_DOT[p.chain] }} />
                    {p.chain}
                  </span>
                </Td>
                <Td muted>{p.vault ?? "—"}</Td>
                <Td align="right" strong>{p.vol24Usd > 0 ? formatCompactUsd(p.vol24Usd) : "—"}</Td>
                <Td align="right" muted>
                  {Number.isFinite(p.vol7Usd) ? formatCompactUsd(p.vol7Usd) : "—"}
                </Td>
                <Td align="right">{p.primaryUsd != null ? formatCompactUsd(p.primaryUsd) : "—"}</Td>
                <Td align="right">{formatInt(p.active24h)}</Td>
                <Td align="right">
                  {Number.isFinite(p.cards) && p.cards > 0 ? formatCompactNumber(p.cards) : "—"}
                </Td>
                <Td align="right">{formatInt(p.holders)}</Td>
                <Td align="right">{p.avgTradeUsd > 0 ? formatCompactUsd(p.avgTradeUsd) : "—"}</Td>
                <Td>{p.spark.length > 0 ? <Sparkline data={p.spark} trend={p.trend} /> : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Th({
  children,
  align,
  title,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  title?: string;
}) {
  return (
    <th
      title={title}
      className={`px-4 py-3 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 ${
        align === "right" ? "text-right" : "text-left"
      } ${title ? "cursor-help" : ""}`}
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
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  title?: string;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
}) {
  return (
    <th
      onClick={onClick}
      title={title}
      aria-sort={active ? (dir === -1 ? "descending" : "ascending") : "none"}
      className={`cursor-pointer select-none px-4 py-3 text-[11px] font-medium uppercase tracking-[0.06em] transition-colors ${
        active ? "text-ink" : "text-ink-3 hover:text-ink-2"
      } ${align === "right" ? "text-right" : "text-left"}`}
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
    <td className={`tabular whitespace-nowrap border-b border-line/60 px-4 py-4 ${alignCls} ${weightCls} ${className}`}>
      {children}
    </td>
  );
}
