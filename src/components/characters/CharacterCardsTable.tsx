"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Section } from "../Section";
import { TableFoot } from "../TableFoot";
import { GradeChip } from "../GradeChip";
import type { CharacterIdentityRow } from "@/lib/data/characterRollups";
import { identityHref } from "@/lib/card/identity";
import { cmp } from "@/lib/machines/board";
import { formatCompactUsd, formatInt } from "@/lib/format";
import { dayShort } from "@/lib/card/identityView";
import { CHARACTER_TOP_ROWS } from "@/lib/card/characterView";

/**
 * Every card under the character — one row per identity (set · number ·
 * grade), each a link to its identity page.
 *
 * Sortable on the numeric columns, 30d volume by default; the sort always runs
 * over the whole set and only the rows mapped into the table are cut (top
 * CHARACTER_TOP_ROWS, "Show all N →" in the foot — per-visit state, not a
 * stored preference: two thousand characters are not surfaces a reader
 * configures).
 *
 * ⚠️ THE MONTHLY PRICE IS THE READER'S OR "—". `monthlyPriceUsd` is
 * `monthlyIdentityPrices` for the latest complete month; null means fewer than
 * two sales that month, printed as "—", never as the last sale dressed up.
 *
 * Facet chips are the extractor's display facets — owner ("Blaine's"), form
 * ("Mega X"), variant, and the co-stars of a multi-character card ("with
 * Braixen") — words the reader already carries, not inferred here.
 */
type SortKey = "monthly" | "sales30d" | "volume30d" | "lastSale" | "slabs";

function valueFor(r: CharacterIdentityRow, k: SortKey): number {
  switch (k) {
    case "monthly": return r.monthlyPriceUsd ?? NaN;
    case "sales30d": return r.sales30d;
    case "volume30d": return r.volume30d;
    case "lastSale": return r.lastSale ? Date.parse(r.lastSale.ts) : NaN;
    case "slabs": return r.slabs;
  }
}

export function CharacterCardsTable({ rows, characterName }: { rows: CharacterIdentityRow[]; characterName: string }) {
  const [sortKey, setSortKey] = useState<SortKey>("volume30d");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [all, setAll] = useState(false);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => cmp(valueFor(a, sortKey), valueFor(b, sortKey), dir) || b.slabs - a.slabs || a.slug.localeCompare(b.slug)),
    [rows, sortKey, dir],
  );
  const visible = all ? sorted : sorted.slice(0, CHARACTER_TOP_ROWS);
  const truncated = visible.length < sorted.length;
  const priced = rows.filter((r) => r.monthlyPriceUsd != null).length;

  const onSort = (k: SortKey) => {
    if (k === sortKey) setDir((d) => (d === -1 ? 1 : -1));
    else { setSortKey(k); setDir(-1); }
  };
  const sp = (k: SortKey) => ({ active: sortKey === k, dir, onClick: () => onSort(k) });

  return (
    <Section
      title="Cards"
      readMe={`every ${characterName} card we track, one row per set, number and grade`}
      subtitle={`${formatInt(rows.length)} card${rows.length === 1 ? "" : "s"} · ${formatInt(priced)} with a monthly price · sales and volume are the last 30 days`}
      flush
    >
      <div className="scroll-x">
        <table className="w-full min-w-0 border-collapse text-left md:min-w-[960px]">
          <thead>
            <tr className="border-b border-line text-[10.5px] uppercase tracking-[0.07em] text-ink-4">
              <th scope="col" className="py-2 pl-4 pr-3 font-medium sm:pl-5">Card</th>
              <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">Set</th>
              <th scope="col" className="px-3 py-2 font-medium">Grade</th>
              <SortTh {...sp("monthly")} className="hidden sm:table-cell">Monthly price</SortTh>
              <SortTh {...sp("sales30d")} className="hidden md:table-cell">30d sales</SortTh>
              <SortTh {...sp("volume30d")}>30d volume</SortTh>
              <SortTh {...sp("lastSale")} className="hidden lg:table-cell">Last sale</SortTh>
              <SortTh {...sp("slabs")} className="hidden sm:table-cell" last>Slabs</SortTh>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.slug} className="border-b border-line/60 transition-colors last:border-0 hover:bg-bg-2">
                <th scope="row" className="py-2 pl-4 pr-3 text-left font-normal sm:pl-5">
                  <Link href={identityHref(r.slug)} className="block min-w-0 hover:text-yellow">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                      <span className="max-w-[220px] truncate text-[12.5px] font-semibold text-ink">{r.name}</span>
                      {r.number ? <span className="font-mono text-[10.5px] text-ink-4">#{r.number}</span> : null}
                      <Facets f={r.facets} />
                    </span>
                  </Link>
                </th>
                <td className="hidden max-w-[200px] truncate px-3 py-2 text-[12px] text-ink-2 md:table-cell">{r.setName ?? <span className="text-ink-4">—</span>}</td>
                <td className="px-3 py-2"><GradeChip label={r.grade} /></td>
                <td className="hidden px-3 py-2 text-right tabular text-[12.5px] sm:table-cell">
                  {r.monthlyPriceUsd != null ? (
                    <>
                      <span className="text-ink">{formatCompactUsd(r.monthlyPriceUsd)}</span>
                      <span className="block font-mono text-[10px] text-ink-4">n={r.n}</span>
                    </>
                  ) : (
                    <span className="text-ink-4" title="fewer than 2 sales in the latest complete month">—</span>
                  )}
                </td>
                <td className="hidden px-3 py-2 text-right tabular text-[12.5px] text-ink-2 md:table-cell">{r.sales30d}</td>
                <td className="px-3 py-2 text-right tabular text-[12.5px] text-ink">{r.sales30d ? formatCompactUsd(r.volume30d) : <span className="text-ink-4">—</span>}</td>
                <td className="hidden px-3 py-2 text-right tabular text-[12.5px] lg:table-cell">
                  {r.lastSale ? (
                    <>
                      <span className="text-ink-2">{formatCompactUsd(r.lastSale.priceUsd)}</span>
                      <span className="block font-mono text-[10px] text-ink-4">{dayShort(r.lastSale.ts)}</span>
                    </>
                  ) : (
                    <span className="text-ink-4">—</span>
                  )}
                </td>
                <td className="hidden py-2 pl-3 pr-4 text-right tabular text-[12.5px] text-ink-2 sm:table-cell sm:pr-5">{r.slabs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TableFoot
        shown={visible.length}
        total={sorted.length}
        noun="card"
        action={
          sorted.length > CHARACTER_TOP_ROWS
            ? truncated
              ? { label: `Show all ${formatInt(sorted.length)} →`, onClick: () => setAll(true) }
              : { label: `Show top ${CHARACTER_TOP_ROWS}`, onClick: () => setAll(false) }
            : undefined
        }
      />
    </Section>
  );
}

/** The extractor's display facets as chips: owner, form, variant, co-stars. */
function Facets({ f }: { f: CharacterIdentityRow["facets"] }) {
  const chips: string[] = [];
  if (f.owner) chips.push(`${f.owner}'s`);
  if (f.form) chips.push(f.form);
  if (f.variant) chips.push(f.variant);
  if (f.partners?.length) chips.push(`with ${f.partners.join(" & ")}`);
  if (!chips.length) return null;
  return (
    <>
      {chips.map((c) => (
        <span key={c} className="rounded-md border border-line bg-bg-2 px-1.5 py-0.5 font-mono text-[10px] leading-none text-ink-3">
          {c}
        </span>
      ))}
    </>
  );
}

function SortTh({
  children,
  active,
  dir,
  onClick,
  className = "",
  last,
}: {
  children: React.ReactNode;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
  className?: string;
  last?: boolean;
}) {
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === -1 ? "descending" : "ascending") : "none"}
      className={`select-none py-2 text-right font-medium transition-colors ${last ? "pl-3 pr-4 sm:pr-5" : "px-3"} ${active ? "text-ink" : "text-ink-4 hover:text-ink-2"} ${className}`}
    >
      <button type="button" onClick={onClick} className="inline-flex cursor-pointer items-center gap-1 uppercase tracking-[0.07em]">
        {children}
        <span className={active ? "text-yellow" : "text-ink-4"}>{active ? (dir === -1 ? "▼" : "▲") : "↕"}</span>
      </button>
    </th>
  );
}
