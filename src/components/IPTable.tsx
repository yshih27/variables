"use client";

import { useState } from "react";
import Link from "next/link";
import type { IPRow } from "@/lib/types";
import { Sparkline } from "./Sparkline";
import { IPIcon } from "./IPIcon";
import { formatCompactUsd, formatCompactNumber, formatInt } from "@/lib/format";

type Props = {
  rows: IPRow[];
  /** Cap visible rows; remaining ones surface via the See all link. */
  maxRows?: number;
  /** Where the See all link points. Omit to hide the link. */
  seeAllHref?: string;
};

type SortKey = "mcap" | "dom" | "d1" | "d7" | "d30" | "cards" | "holders" | "avgTrade" | "vol" | "buyers";
type VolWindow = "24h" | "7d";

function mcapValue(ip: IPRow): number {
  // Mirror the display rule so the sort matches what's shown ("—" sinks).
  if (!Number.isFinite(ip.mcapUsd) || ip.mcapUsd < 1000 || ip.cards < 5) return NaN;
  return ip.mcapUsd;
}

function valueFor(ip: IPRow, key: SortKey, vw: VolWindow): number {
  switch (key) {
    case "mcap":
    case "dom":
      return mcapValue(ip); // dominance ranks identically to market cap
    case "d1":
      return ip.pct1d ?? NaN;
    case "d7":
      return ip.pct7d ?? NaN;
    case "d30":
      return ip.pct30d ?? NaN;
    case "cards":
      return ip.cards;
    case "holders":
      return ip.holders;
    case "avgTrade":
      return ip.trades24h > 0 ? ip.vol24Usd / ip.trades24h : NaN;
    case "vol":
      return vw === "24h" ? ip.vol24Usd : ip.vol7Usd;
    case "buyers":
      return ip.buyers24h;
  }
}

/** Numeric compare; non-finite values always sink to the bottom. */
function cmp(a: number, b: number, dir: 1 | -1): number {
  const an = !Number.isFinite(a);
  const bn = !Number.isFinite(b);
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  return (a - b) * dir;
}

// Category-type facet — derived from the IP key (no catalog field for it).
const CATEGORY_GROUPS = ["TCG", "Sports", "Other"] as const;
const TCG_KEYS = new Set(["pokemon", "one_piece", "yugioh", "magic", "lorcana", "dragon_ball", "veefriends"]);
const SPORTS_KEYS = new Set(["basketball", "baseball", "football", "soccer", "hockey", "f1"]);
function categoryGroup(key: string): string {
  if (TCG_KEYS.has(key)) return "TCG";
  if (SPORTS_KEYS.has(key)) return "Sports";
  return "Other";
}

export function IPTable({ rows, maxRows, seeAllHref }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("mcap");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [vw, setVw] = useState<VolWindow>("24h");
  const [facet, setFacet] = useState<string>("All");

  if (rows.length === 0) return null;

  // Dominance = each IP's market cap as a share of the total market — always
  // across ALL rows, not just the current facet.
  const totalMcap =
    rows.reduce((s, ip) => {
      const v = mcapValue(ip);
      return s + (Number.isFinite(v) ? v : 0);
    }, 0) || 1;

  // Category-type facet (TCG / Sports / Other) — only offer tabs that have rows.
  const facets = ["All", ...CATEGORY_GROUPS.filter((g) => rows.some((r) => categoryGroup(r.key) === g))];
  const activeFacet = facets.includes(facet) ? facet : "All";
  const facetRows = activeFacet === "All" ? rows : rows.filter((r) => categoryGroup(r.key) === activeFacet);

  const sorted = [...facetRows].sort((a, b) => cmp(valueFor(a, sortKey, vw), valueFor(b, sortKey, vw), dir));
  const visible = maxRows ? sorted.slice(0, maxRows) : sorted;
  const overflow = facetRows.length - visible.length;

  function onSort(key: SortKey) {
    if (key === sortKey) setDir((d) => (d === -1 ? 1 : -1));
    else {
      setSortKey(key);
      setDir(-1);
    }
  }

  const sortProps = (key: SortKey) => ({
    active: sortKey === key,
    dir,
    onClick: () => onSort(key),
  });

  return (
    <section className="mt-14">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.005em]">
            Top {visible.length} IPs <span className="font-normal text-ink-3">/ Categories</span>
          </h2>
          <div className="mt-1 text-[12px] text-ink-3">
            Breakdown by IP across tracked platforms.
          </div>
        </div>
        <div className="flex items-center gap-4">
          <WindowToggle value={vw} onChange={setVw} />
          {seeAllHref && overflow > 0 && (
            <Link href={seeAllHref} className="text-[12px] text-ink-3 transition-colors hover:text-yellow">
              See all {rows.length} IPs →
            </Link>
          )}
        </div>
      </div>

      {facets.length > 2 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {facets.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setFacet(g)}
              aria-pressed={activeFacet === g}
              className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                activeFacet === g
                  ? "border-line-2 bg-bg-2 text-ink"
                  : "border-line text-ink-3 hover:border-line-2 hover:text-ink"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      <div className="scroll-x">
        <table className="w-full min-w-0 border-collapse text-[13px] md:min-w-[1320px]">
          <thead>
            <tr className="border-b border-line">
              <Th>#</Th>
              <Th>IP / Category</Th>
              <SortTh align="right" {...sortProps("mcap")}>Market Cap</SortTh>
              <SortTh align="right" className="hidden lg:table-cell" {...sortProps("dom")}>Dom %</SortTh>
              <SortTh align="right" className="hidden md:table-cell" {...sortProps("d1")}>1d</SortTh>
              <SortTh align="right" className="hidden md:table-cell" {...sortProps("d7")}>7d</SortTh>
              <SortTh align="right" className="hidden md:table-cell" {...sortProps("d30")}>30d</SortTh>
              <SortTh align="right" className="hidden md:table-cell" {...sortProps("cards")}>Cards</SortTh>
              <SortTh align="right" className="hidden md:table-cell" {...sortProps("holders")}>Holders</SortTh>
              <SortTh align="right" className="hidden md:table-cell" {...sortProps("avgTrade")}>Avg Trade</SortTh>
              <SortTh align="right" className="hidden md:table-cell" {...sortProps("vol")}>{vw} Vol</SortTh>
              <SortTh align="right" className="hidden md:table-cell" {...sortProps("buyers")}>24h Buyers</SortTh>
              <Th className="hidden md:table-cell">24h Chart</Th>
              <Th className="hidden md:table-cell">Top Card</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((ip, i) => {
              const vol = vw === "24h" ? ip.vol24Usd : ip.vol7Usd;
              // Δ is a market-cap change — only meaningful when the mcap itself is
              // (a tiny/suppressed IP would show a wild % off a near-zero base).
              const hasMcap = Number.isFinite(mcapValue(ip));
              return (
                <tr key={ip.key} className="group relative cursor-pointer transition-colors hover:bg-bg-2">
                  <Td className="w-[44px] text-ink-3">{String(i + 1).padStart(2, "0")}</Td>
                  <Td>
                    <Link
                      href={`/ip/${ip.key}`}
                      className="flex items-center gap-3 before:absolute before:inset-0 before:content-['']"
                    >
                      <IPIcon
                        name={ip.name}
                        short={ip.short}
                        color={ip.color}
                        logo={ip.logo}
                        iconBlendMode={ip.iconBlendMode}
                        emoji={ip.emoji}
                        size={32}
                      />
                      <span className="font-sans font-semibold group-hover:text-yellow">{ip.name}</span>
                    </Link>
                  </Td>
                  <Td align="right" strong>{formatMcap(ip.mcapUsd, ip.cards)}</Td>
                  <Td align="right" muted className="hidden lg:table-cell">{domCell(ip, totalMcap)}</Td>
                  <Td align="right" className="hidden md:table-cell"><DeltaCell pct={hasMcap ? ip.pct1d : null} /></Td>
                  <Td align="right" className="hidden md:table-cell"><DeltaCell pct={hasMcap ? ip.pct7d : null} /></Td>
                  <Td align="right" className="hidden md:table-cell"><DeltaCell pct={hasMcap ? ip.pct30d : null} /></Td>
                  <Td align="right" className="hidden md:table-cell">{formatCompactNumber(ip.cards)}</Td>
                  <Td align="right" className="hidden md:table-cell">{formatInt(ip.holders)}</Td>
                  <Td align="right" muted className="hidden md:table-cell">
                    {ip.trades24h > 0 ? formatCompactUsd(ip.vol24Usd / ip.trades24h) : "—"}
                  </Td>
                  <Td align="right" className="hidden md:table-cell">{Number.isFinite(vol) ? formatCompactUsd(vol) : "—"}</Td>
                  <Td align="right" muted className="hidden md:table-cell">{formatInt(ip.buyers24h)}</Td>
                  <Td className="hidden md:table-cell">
                    <Sparkline data={ip.spark} trend={ip.trend} />
                  </Td>
                  <Td className="hidden max-w-[280px] text-[12px] text-ink-2 md:table-cell">
                    {ip.topCard ? (
                      ip.topCardHref ? (
                        <Link
                          href={ip.topCardHref}
                          className="relative z-10 block truncate font-sans underline-offset-2 hover:text-yellow hover:underline"
                        >
                          {ip.topCard}
                        </Link>
                      ) : (
                        <span className="block truncate font-sans">{ip.topCard}</span>
                      )
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WindowToggle({ value, onChange }: { value: VolWindow; onChange: (v: VolWindow) => void }) {
  return (
    <div className="hidden items-center gap-0.5 rounded-lg border border-line bg-bg-1 p-[3px] text-[11px] md:inline-flex">
      {(["24h", "7d"] as VolWindow[]).map((w) => (
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

function Th({ children, align, className = "" }: { children: React.ReactNode; align?: "left" | "right"; className?: string }) {
  return (
    <th
      className={`px-3 py-3 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 sm:px-4 ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </th>
  );
}

function SortTh({
  children,
  align,
  active,
  dir,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
  className?: string;
}) {
  return (
    <th
      onClick={onClick}
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

/**
 * Suppress meaningless mcap values caused by tiny/sparse data:
 *   - NaN or non-finite → "—"
 *   - <$1,000 total mcap → "—"
 *   - <5 cards in the IP → "—" (too few to be meaningful)
 */
function formatMcap(mcap: number, cards: number): string {
  if (!Number.isFinite(mcap) || mcap < 1000 || cards < 5) return "—";
  return formatCompactUsd(mcap);
}

/** Dominance = this IP's (suppressed-rule) market cap as a % of the total. */
function domCell(ip: IPRow, total: number): string {
  const v = mcapValue(ip);
  if (!Number.isFinite(v)) return "—";
  return `${((v / total) * 100).toFixed(1)}%`;
}

/** Colored % change for the leaderboard Δ columns ("—" when the spine can't reach back). */
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
