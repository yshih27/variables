"use client";

import { useState } from "react";
import Link from "next/link";
import type { TrendingCard } from "@/lib/data/fetchTrending";
import { Section } from "./Section";
import { formatCompactUsd, formatInt } from "@/lib/format";

/**
 * TrendingCards (F6) — the homepage's card-level discovery surface: what's HOT by
 * trade velocity, ranked by the scarcity signal **hunt pressure = trades ÷ active
 * listings** ("everyone wants it, few for sale"). Default sort = hunt pressure;
 * every column is sortable; every row links to its `/card/[id]` page.
 *
 * The Δ momentum column is hidden until per-card history exists (the resolver
 * returns `momentum: null` today) — no dead column of dashes.
 */
const PLATFORM_LABEL: Record<string, string> = {
  "collector-crypt": "Collector Crypt",
  beezie: "Beezie",
  phygitals: "Phygitals",
  courtyard: "Courtyard",
};

type SortKey = "huntPressure" | "trades" | "momentum" | "activeListings" | "volumeUsd" | "topPriceUsd";

function valueFor(c: TrendingCard, key: SortKey): number {
  const v = c[key];
  return v == null || !Number.isFinite(v) ? NaN : (v as number);
}
function cmp(a: number, b: number, dir: 1 | -1): number {
  const an = !Number.isFinite(a);
  const bn = !Number.isFinite(b);
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  return (a - b) * dir;
}
function humanizeIp(key: string): string {
  if (key === "pokemon") return "Pokémon";
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function TrendingCards({
  cards,
  windowLabel = "24h",
  floatAgeLabel,
  seeAllHref,
}: {
  cards: TrendingCard[];
  /** Which trade window ranked this list — "24h", or "7d" when 24h was tie-heavy (X6). */
  windowLabel?: string;
  /** Age of the listings snapshot behind Float, precomputed server-side ("3h old"). */
  floatAgeLabel?: string | null;
  seeAllHref?: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("huntPressure");
  const [dir, setDir] = useState<1 | -1>(-1);

  if (cards.length === 0) return null;

  const hasMomentum = cards.some((c) => c.momentum != null && Number.isFinite(c.momentum));
  const maxHP = Math.max(1, ...cards.map((c) => (Number.isFinite(c.huntPressure) ? c.huntPressure : 0)));
  const sorted = [...cards].sort((a, b) => cmp(valueFor(a, sortKey), valueFor(b, sortKey), dir));

  function onSort(key: SortKey) {
    if (key === sortKey) setDir((d) => (d === -1 ? 1 : -1));
    else {
      setSortKey(key);
      setDir(-1);
    }
  }
  const sp = (key: SortKey) => ({ active: sortKey === key, dir, onClick: () => onSort(key) });

  // X6 honesty notes: which window ranked the list, momentum coverage (CC is the
  // only feed with a prior window), and how old the float snapshot is.
  const notes = [
    `hunt pressure = ${windowLabel} trades ÷ active listings`,
    hasMomentum ? "Δ mom: Collector Crypt only" : null,
    floatAgeLabel ? `float ${floatAgeLabel}` : null,
  ].filter(Boolean);

  return (
    <Section
      title="Trending cards"
      subtitle={`Selling faster than they're listed · ${notes.join(" · ")}`}
      right={
        <>
          <span className="rounded-md border border-line bg-bg-2 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-2">
            {windowLabel}
          </span>
          {seeAllHref && (
            <Link href={seeAllHref} className="text-[12px] text-ink-3 transition-colors hover:text-yellow">
              See all →
            </Link>
          )}
        </>
      }
      flush
    >
      <div className="scroll-x">
        <table className="w-full min-w-0 border-collapse text-[13px] md:min-w-[780px]">
          <thead>
            <tr className="border-b border-line">
              <Th>#</Th>
              <Th>Card</Th>
              <SortTh align="right" {...sp("trades")}>Trades</SortTh>
              <SortTh align="right" {...sp("volumeUsd")}>Vol</SortTh>
              {hasMomentum && (
                <SortTh align="right" className="hidden sm:table-cell" {...sp("momentum")}>Δ Mom</SortTh>
              )}
              <SortTh align="right" className="hidden sm:table-cell" {...sp("activeListings")}>Float</SortTh>
              <SortTh align="right" {...sp("huntPressure")}>Hunt pressure</SortTh>
              <SortTh align="right" className="hidden md:table-cell" {...sp("topPriceUsd")}>Top price</SortTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c, i) => (
              <tr key={c.cardId} className="group relative cursor-pointer transition-colors hover:bg-bg-2">
                <Td className="w-[40px] text-ink-3">{String(i + 1).padStart(2, "0")}</Td>
                <Td>
                  <Link
                    href={c.href}
                    className="flex flex-col gap-0.5 before:absolute before:inset-0 before:content-['']"
                  >
                    <span className="truncate font-sans font-semibold group-hover:text-yellow">{c.name}</span>
                    <span className="truncate font-sans text-[11.5px] text-ink-3">
                      {[humanizeIp(c.ip), c.grade, PLATFORM_LABEL[c.platform] ?? c.platform]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </Link>
                </Td>
                <Td align="right" strong>{formatInt(c.trades)}</Td>
                <Td align="right">{c.volumeUsd > 0 ? formatCompactUsd(c.volumeUsd) : "—"}</Td>
                {hasMomentum && (
                  <Td align="right" className="hidden sm:table-cell">
                    <MomentumCell m={c.momentum} />
                  </Td>
                )}
                <Td align="right" muted className="hidden sm:table-cell">{formatInt(c.activeListings)}</Td>
                <Td align="right">
                  <span className="inline-flex items-center justify-end gap-2.5">
                    <span className="hidden h-1.5 w-[48px] overflow-hidden rounded-full bg-bg-3 sm:block">
                      <span
                        className="block h-full rounded-full bg-yellow"
                        style={{ width: `${Math.max(6, (c.huntPressure / maxHP) * 100)}%` }}
                      />
                    </span>
                    <span className="font-semibold tabular text-ink">{c.huntPressure.toFixed(1)}×</span>
                  </span>
                </Td>
                <Td align="right" muted className="hidden md:table-cell">
                  {c.topPriceUsd > 0 ? formatCompactUsd(c.topPriceUsd) : "—"}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function MomentumCell({ m }: { m: number | null }) {
  if (m == null || !Number.isFinite(m)) return <span className="text-ink-4">—</span>;
  const cls = m > 0 ? "text-green" : m < 0 ? "text-red" : "text-ink-3";
  return (
    <span className={`font-semibold tabular ${cls}`}>
      {m > 0 ? "+" : ""}
      {formatInt(m)}
    </span>
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
        <span className={active ? "text-yellow" : "text-ink-4"}>{active ? (dir === -1 ? "▼" : "▲") : "↕"}</span>
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
    <td className={`tabular whitespace-nowrap border-b border-line/60 px-3 py-3.5 sm:px-4 ${alignCls} ${weightCls} ${className}`}>
      {children}
    </td>
  );
}
