"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PlatformRow, Chain } from "@/lib/types";
import { Section } from "./Section";
import { Sparkline } from "./Sparkline";
import { TableFoot } from "./TableFoot";
import { MetricInfo } from "./MetricInfo";
import { TableRowLink } from "./TableRowLink";
import type { MetricKey } from "@/lib/metrics/glossary";
import { formatCompactUsd, formatCompactNumber, formatInt, deltaDir, formatDelta } from "@/lib/format";
import { useWindowPref } from "@/lib/windowPref";

const CHAIN_DOT: Record<Chain, string> = {
  Polygon: "var(--color-purple)",
  Solana: "var(--color-solana)",
  Base: "var(--color-blue)",
  Ethereum: "#9aa6ff",
  Abstract: "#5ee6a8", // DYLI settles on Abstract (chain_id 2741)
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
  /** localStorage surface for the volume-window choice. Omit to opt out. */
  surface?: string | null;
};

type SortKey = "total" | "dom" | "vol" | "gacha" | "primary" | "active" | "cards" | "holders" | "avgTrade" | "pct7";

/**
 * The window the MARKETPLACE volume column is read at.
 *
 * ⚠️ IT WINDOWS `Marketplace`, NOT `Total 24h`. `total24Usd` is marketplace +
 * primary (gacha/tokenization) while `vol7Usd` is marketplace ONLY — swapping the
 * primary column between them would change the QUANTITY, not the window, and
 * print a resale figure under a header the reader just set to "7d" expecting the
 * same measure. So the toggle pairs vol24Usd ↔ vol7Usd, which are one measure at
 * two windows — exactly what IPTable's toggle does. `Total 24h` keeps its own
 * hardcoded window because the payload carries no 7d sibling for it.
 *
 * No 30d option: PlatformRow has no 30-day volume field of any kind.
 */
const VOL_WINDOWS = ["24h", "7d"] as const;
type VolWindow = (typeof VOL_WINDOWS)[number];

/** Non-gacha primary revenue (tokenization mints, e.g. Courtyard). Marketplace +
 *  Gacha + Primary = Total; folds into Gacha once Courtyard is reclassified. */
function otherPrimary(p: PlatformRow): number {
  if (p.primaryUsd == null) return NaN;
  return Math.max(0, p.primaryUsd - (p.gachaVol24Usd ?? 0));
}

function valueFor(p: PlatformRow, key: SortKey, vw: VolWindow): number {
  switch (key) {
    case "total":
    case "dom":
      return p.total24Usd; // share ranks identically to total activity
    case "vol":
      return vw === "24h" ? p.vol24Usd : p.vol7Usd;
    case "gacha":
      return p.gachaVol24Usd ?? NaN;
    case "primary":
      return otherPrimary(p);
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

export function PlatformTable({ rows, maxRows, seeAllHref, chainFacets, teaser, title, surface }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [chain, setChain] = useState<Chain | "all">("all");
  // Persisted per surface; read after mount so a stored "7d" can't disagree with
  // the server's "24h" during hydration (see useWindowPref).
  const [vw, setVw] = useWindowPref<VolWindow>(teaser ? null : surface ?? null, VOL_WINDOWS, "24h");
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
  const sorted = [...scoped].sort((a, b) => cmp(valueFor(a, sortKey, vw), valueFor(b, sortKey, vw), dir));
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
      readMe="every tracked venue, ranked — share is of total 24h activity"
      right={
        <>
          {!teaser && <WindowToggle value={vw} onChange={setVw} />}
          {seeAllHref && overflow > 0 && (
            <Link href={seeAllHref} className="text-[12px] text-ink-3 transition-colors hover:text-yellow">
              See all {rows.length} platforms →
            </Link>
          )}
        </>
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
                  <span className="h-1.5 w-1.5 rounded-none" style={{ background: CHAIN_DOT[c] }} />
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
              {full && (
                <SortTh
                  align="right"
                  className="hidden md:table-cell"
                  info={vw === "24h" ? "marketplace" : "volume7d"}
                  {...sp("vol")}
                >
                  {`${vw} Vol`}
                </SortTh>
              )}
              {full && <SortTh align="right" className="hidden md:table-cell" info="gacha" {...sp("gacha")}>Gacha</SortTh>}
              {full && showPrimary && (
                <SortTh align="right" className="hidden md:table-cell" info="directSales" {...sp("primary")}>Direct sales</SortTh>
              )}
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
              <TableRowLink key={p.key} href={`/platform/${p.key}`} className="[&:last-child>td]:border-b-0">
                <Td className="w-[44px] text-ink-3">{String(i + 1).padStart(2, "0")}</Td>
                <Td>
                  <div className="flex items-center gap-2.5">
                    <Link
                      href={`/platform/${p.key}`}
                      className="flex items-center gap-2.5 font-semibold"
                    >
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-none bg-bg-2 text-[11px] font-bold">
                        {p.short}
                      </span>
                      <span className="font-sans group-hover:text-yellow">{p.name}</span>
                    </Link>
                    {/* Coverage disclosure: we track this platform's primary market but
                        not its secondary yet. Its ⓘ stays clickable because the row's
                        click handler defers to any nested button. */}
                    {primaryOnly && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.06em] text-ink-3">
                        primary only
                        <MetricInfo metric="primaryOnly" />
                      </span>
                    )}
                  </div>
                </Td>
                <Td className={full ? "hidden md:table-cell" : "hidden sm:table-cell"}>
                  <span className="inline-flex h-[22px] items-center gap-1.5 text-[12px] text-ink-2">
                    <span className="h-1.5 w-1.5 rounded-none" style={{ background: CHAIN_DOT[p.chain] }} />
                    {p.chain}
                  </span>
                </Td>
                <Td align="right" strong>{p.total24Usd > 0 ? formatCompactUsd(p.total24Usd) : "—"}</Td>
                <Td align="right" muted className={full ? "hidden md:table-cell" : "hidden sm:table-cell"}>{shareCell(p, totalActivity)}</Td>
                <Td align="right" className={full ? "hidden md:table-cell" : "hidden sm:table-cell"}><DeltaCell pct={p.pct7d} /></Td>
                {full && (
                  <Td align="right" className="hidden md:table-cell">
                    {(() => {
                      const v = vw === "24h" ? p.vol24Usd : p.vol7Usd;
                      return Number.isFinite(v) && v > 0 ? formatCompactUsd(v) : "—";
                    })()}
                  </Td>
                )}
                {full && <Td align="right" className="hidden md:table-cell">{p.gachaVol24Usd != null && p.gachaVol24Usd > 0 ? formatCompactUsd(p.gachaVol24Usd) : "—"}</Td>}
                {full && showPrimary && (
                  <Td align="right" className="hidden md:table-cell">
                    {Number.isFinite(otherPrimary(p)) && otherPrimary(p) > 0 ? formatCompactUsd(otherPrimary(p)) : "—"}
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
              </TableRowLink>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Row count. States what is ON SCREEN against what the filter holds, so a
          chain facet or a maxRows teaser can't read as the whole market. */}
      <TableFoot shown={visible.length} total={scoped.length} noun="platform" filtered={scoped.length !== rows.length ? rows.length : null} />
    </Section>
  );
}

/** 24H VOL / 7D VOL — the marketplace column's window. Same control, same
 *  breakpoint and same copy shape as IPTable's, so the two leaderboards read as
 *  one idiom rather than two. */
function WindowToggle({ value, onChange }: { value: VolWindow; onChange: (v: VolWindow) => void }) {
  return (
    <div className="hidden items-center gap-0.5 rounded-lg border border-line bg-bg-1 p-[3px] text-[11px] md:inline-flex">
      {VOL_WINDOWS.map((w) => (
        <button
          key={w}
          type="button"
          onClick={() => onChange(w)}
          aria-pressed={value === w}
          className={`rounded-md px-2.5 py-1 font-medium uppercase tracking-[0.04em] transition-colors ${
            value === w ? "bg-bg-3 text-yellow" : "text-ink-3 hover:text-ink"
          }`}
        >
          {w} vol
        </button>
      ))}
    </div>
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
  const dir = deltaDir(pct);
  const cls = dir === "up" ? "text-green" : dir === "down" ? "text-red" : "text-ink-3";
  return <span className={`font-semibold ${cls}`}>{formatDelta(pct)}</span>;
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
      // No onClick here — the inner button owns sorting. Carrying it on the <th>
      // too made every label click fire twice (button + bubble), so the direction
      // toggled straight back; and clicking the ⓘ re-sorted the table (D3).
      // IPTable/TrendingCards never had it.
      aria-sort={active ? (dir === -1 ? "descending" : "ascending") : "none"}
      className={`select-none px-3 py-3 text-[11px] font-medium uppercase tracking-[0.06em] transition-colors sm:px-4 ${
        active ? "text-ink" : "text-ink-3 hover:text-ink-2"
      } ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        <button type="button" onClick={onClick} className="inline-flex cursor-pointer items-center gap-1">
          {children}
          <span className={active ? "text-yellow" : "text-ink-4"}>{active ? (dir === -1 ? "▼" : "▲") : "↕"}</span>
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
