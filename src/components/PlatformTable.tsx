"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PlatformRow, Chain } from "@/lib/types";
import { Section } from "./Section";
import { Sparkline } from "./Sparkline";
import { MetricInfo } from "./MetricInfo";
import type { MetricKey } from "@/lib/metrics/glossary";
import { formatCompactUsd, formatCompactNumber, formatInt } from "@/lib/format";

const CHAIN_DOT: Record<Chain, string> = {
  Polygon: "var(--color-purple)",
  Solana: "var(--color-solana)",
  Base: "var(--color-blue)",
  Ethereum: "#9aa6ff",
};

type Props = {
  rows: PlatformRow[];
  /** Cap visible rows; the rest surface via the See all link (homepage teaser). */
  maxRows?: number;
  /** Where the See all link points. Omit to hide the link. */
  seeAllHref?: string;
  /** Show the chain facet tabs above the table (F4) — the full /platforms page. */
  chainFacets?: boolean;
  /** Homepage teaser: only # · Platform · Chain · Total 24h · Share · Δ7d — the
   *  marketplace/gacha/direct split + wallets/cards/holders live on /platforms
   *  (that deeper breakdown is the reason to click through). */
  teaser?: boolean;
  /** Override the section title (default "Top Platforms"). Watchlist passes "Platforms". */
  title?: string;
};

type SortKey = "total" | "dom" | "vol24" | "gacha" | "primary" | "vol7" | "active" | "cards" | "holders" | "avgTrade" | "pct7";

/** Non-gacha primary revenue (tokenization mints, e.g. Courtyard). Marketplace +
 *  Gacha + Primary = Total; folds into Gacha once Courtyard is reclassified. */
function otherPrimary(p: PlatformRow): number {
  if (p.primaryUsd == null) return NaN;
  return Math.max(0, p.primaryUsd - (p.gachaVol24Usd ?? 0));
}

function valueFor(p: PlatformRow, key: SortKey): number {
  switch (key) {
    case "total":
    case "dom":
      return p.total24Usd; // share ranks identically to total activity
    case "vol24":
      return p.vol24Usd;
    case "gacha":
      return p.gachaVol24Usd ?? NaN;
    case "primary":
      return otherPrimary(p);
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
    case "pct7":
      return p.pct7d ?? NaN;
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

export function PlatformTable({ rows, maxRows, seeAllHref, chainFacets, teaser, title }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [chain, setChain] = useState<Chain | "all">("all");
  const full = !teaser;

  // Chain facets (F4) — one tab per chain present, in activity order, + All.
  const chains = useMemo(() => {
    const seen = new Map<Chain, number>();
    for (const p of rows) seen.set(p.chain, (seen.get(p.chain) ?? 0) + Math.max(0, p.total24Usd));
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [rows]);
  const showFacets = !!chainFacets && chains.length > 1;
  const activeChain = showFacets ? chain : "all";
  const scoped = activeChain === "all" ? rows : rows.filter((p) => p.chain === activeChain);

  // Any primary-only (tokenization) revenue in scope → show the Primary column.
  const showPrimary = scoped.some((p) => Number.isFinite(otherPrimary(p)) && otherPrimary(p) > 0);

  const totalActivity = scoped.reduce((s, p) => s + (p.total24Usd > 0 ? p.total24Usd : 0), 0) || 1;
  const sorted = [...scoped].sort((a, b) => cmp(valueFor(a, sortKey), valueFor(b, sortKey), dir));
  const visible = maxRows ? sorted.slice(0, maxRows) : sorted;
  const overflow = scoped.length - visible.length;

  function onSort(key: SortKey) {
    if (key === sortKey) setDir((d) => (d === -1 ? 1 : -1));
    else {
      setSortKey(key);
      setDir(-1);
    }
  }
  const sp = (key: SortKey) => ({ active: sortKey === key, dir, onClick: () => onSort(key) });

  return (
    <Section
      title={title ?? "Top Platforms"}
      subtitle="Where the trading happens."
      right={
        seeAllHref && overflow > 0 ? (
          <Link href={seeAllHref} className="text-[12px] text-ink-3 transition-colors hover:text-yellow">
            See all {rows.length} platforms →
          </Link>
        ) : undefined
      }
      flush
    >
      {showFacets && (
        <div className="flex flex-wrap gap-1 px-4 pb-1 pt-1 sm:px-4">
          {(["all", ...chains] as const).map((c) => {
            const on = activeChain === c;
            const n = c === "all" ? rows.length : rows.filter((p) => p.chain === c).length;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setChain(c)}
                aria-pressed={on}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] transition-colors ${
                  on ? "bg-bg-3 font-semibold text-ink" : "text-ink-3 hover:text-ink"
                }`}
              >
                {c !== "all" && (
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: CHAIN_DOT[c] }} />
                )}
                {c === "all" ? "All chains" : c}
                <span className="tabular text-[11px] text-ink-4">{n}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="scroll-x">
        <table className={`w-full min-w-0 border-collapse text-[13px] ${full ? "md:min-w-[1180px]" : ""}`}>
          <thead>
            <tr className="border-b border-line">
              <Th>#</Th>
              <Th>Platform</Th>
              <Th className={full ? "hidden md:table-cell" : "hidden sm:table-cell"}>Chain</Th>
              <SortTh align="right" info="total24h" {...sp("total")}>Total 24h</SortTh>
              <SortTh align="right" className={full ? "hidden md:table-cell" : "hidden sm:table-cell"} info="share" {...sp("dom")}>Share</SortTh>
              <SortTh align="right" className={full ? "hidden md:table-cell" : "hidden sm:table-cell"} info="momentum7d" {...sp("pct7")}>Δ 7d</SortTh>
              {full && <SortTh align="right" className="hidden md:table-cell" info="marketplace" {...sp("vol24")}>Marketplace</SortTh>}
              {full && <SortTh align="right" className="hidden md:table-cell" info="gacha" {...sp("gacha")}>Gacha</SortTh>}
              {full && showPrimary && (
                <SortTh align="right" className="hidden md:table-cell" info="directSales" {...sp("primary")}>Direct sales</SortTh>
              )}
              {full && <SortTh align="right" className="hidden md:table-cell" info="volume7d" {...sp("vol7")}>7d Vol</SortTh>}
              {full && <SortTh align="right" className="hidden md:table-cell" info="avgTrade" {...sp("avgTrade")}>Avg Trade</SortTh>}
              {full && (
              <SortTh align="right" className="hidden md:table-cell" info="activeWallets" {...sp("active")}>
                Active 24h
              </SortTh>
              )}
              {full && (
              <SortTh align="right" className="hidden md:table-cell" info="cardsTraded" {...sp("cards")}>
                Cards 24h
              </SortTh>
              )}
              {full && <SortTh align="right" className="hidden md:table-cell" info="holders" {...sp("holders")}>Holders</SortTh>}
              {full && <Th className="hidden md:table-cell">24h Chart</Th>}
            </tr>
          </thead>
          <tbody>
            {visible.map((p, i) => {
              // Primary-market venues (gacha / tokenization) can post real revenue
              // with no secondary trades — tag them so the dashed row reads as
              // intentional rather than broken data.
              const primaryOnly = !(p.vol24Usd > 0) && p.primaryUsd != null && p.primaryUsd > 0;
              return (
              <tr key={p.key} className="group relative cursor-pointer transition-colors hover:bg-bg-2 [&:last-child>td]:border-b-0">
                <Td className="w-[44px] text-ink-3">{String(i + 1).padStart(2, "0")}</Td>
                <Td>
                  <div className="flex items-center gap-2.5">
                    <Link
                      href={`/platform/${p.key}`}
                      className="flex items-center gap-2.5 font-semibold before:absolute before:inset-0 before:content-['']"
                    >
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-bg-2 text-[11px] font-bold">
                        {p.short}
                      </span>
                      <span className="font-sans group-hover:text-yellow">{p.name}</span>
                    </Link>
                    {/* Coverage disclosure — sits above the row-link overlay (z-10) so its
                        ⓘ is clickable; explains we track primary but not secondary yet. */}
                    {primaryOnly && (
                      <span className="relative z-10 inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.06em] text-ink-3">
                        primary only
                        <MetricInfo metric="primaryOnly" />
                      </span>
                    )}
                  </div>
                </Td>
                <Td className={full ? "hidden md:table-cell" : "hidden sm:table-cell"}>
                  <span className="inline-flex h-[22px] items-center gap-1.5 text-[12px] text-ink-2">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: CHAIN_DOT[p.chain] }} />
                    {p.chain}
                  </span>
                </Td>
                <Td align="right" strong>{p.total24Usd > 0 ? formatCompactUsd(p.total24Usd) : "—"}</Td>
                <Td align="right" muted className={full ? "hidden md:table-cell" : "hidden sm:table-cell"}>{shareCell(p, totalActivity)}</Td>
                <Td align="right" className={full ? "hidden md:table-cell" : "hidden sm:table-cell"}><DeltaCell pct={p.pct7d} /></Td>
                {full && <Td align="right" className="hidden md:table-cell">{p.vol24Usd > 0 ? formatCompactUsd(p.vol24Usd) : "—"}</Td>}
                {full && <Td align="right" className="hidden md:table-cell">{p.gachaVol24Usd != null && p.gachaVol24Usd > 0 ? formatCompactUsd(p.gachaVol24Usd) : "—"}</Td>}
                {full && showPrimary && (
                  <Td align="right" className="hidden md:table-cell">
                    {Number.isFinite(otherPrimary(p)) && otherPrimary(p) > 0 ? formatCompactUsd(otherPrimary(p)) : "—"}
                  </Td>
                )}
                {full && (
                <Td align="right" muted className="hidden md:table-cell">
                  {Number.isFinite(p.vol7Usd) ? formatCompactUsd(p.vol7Usd) : "—"}
                </Td>
                )}
                {full && <Td align="right" muted className="hidden md:table-cell">{p.avgTradeUsd > 0 ? formatCompactUsd(p.avgTradeUsd) : "—"}</Td>}
                {full && <Td align="right" className="hidden md:table-cell">{formatInt(p.active24h)}</Td>}
                {full && (
                <Td align="right" className="hidden md:table-cell">
                  {Number.isFinite(p.cards) && p.cards > 0 ? formatCompactNumber(p.cards) : "—"}
                </Td>
                )}
                {full && <Td align="right" className="hidden md:table-cell">{formatInt(p.holders)}</Td>}
                {full && <Td className="hidden md:table-cell">{p.spark.length > 0 ? <Sparkline data={p.spark} trend={p.trend} /> : "—"}</Td>}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** A platform's share of total 24h activity across all platforms. */
function shareCell(p: PlatformRow, total: number): string {
  if (!(p.total24Usd > 0)) return "—";
  return `${((p.total24Usd / total) * 100).toFixed(1)}%`;
}

/** Colored 7-day % change ("—" when the bucket history can't reach back a week). */
function DeltaCell({ pct }: { pct?: number | null }) {
  if (pct == null || !Number.isFinite(pct)) return <span className="text-ink-4">—</span>;
  const cls = pct > 0.05 ? "text-green" : pct < -0.05 ? "text-red" : "text-ink-3";
  return (
    <span className={`font-semibold ${cls}`}>
      {pct > 0 ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
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
  info,
  active,
  dir,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  /** Glossary key → an ⓘ MetricInfo affordance next to the label (R5-3). */
  info?: MetricKey;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
  className?: string;
}) {
  return (
    <th
      onClick={onClick}
      aria-sort={active ? (dir === -1 ? "descending" : "ascending") : "none"}
      className={`select-none px-3 py-3 text-[11px] font-medium uppercase tracking-[0.06em] transition-colors sm:px-4 ${
        active ? "text-ink" : "text-ink-3 hover:text-ink-2"
      } ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <button type="button" onClick={onClick} className="inline-flex cursor-pointer items-center gap-1">
          <span className={active ? "text-yellow" : "text-ink-4"}>
            {active ? (dir === -1 ? "▼" : "▲") : "↕"}
          </span>
          {children}
        </button>
        {info && <MetricInfo metric={info} />}
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
