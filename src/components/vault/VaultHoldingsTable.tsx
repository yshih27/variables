"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Section } from "../Section";
import { TableFoot } from "../TableFoot";
import { CardThumb } from "../CardThumb";
import { GradeChip } from "../GradeChip";
import type { VaultHolding, VaultValuation } from "@/lib/data/vault";
import { cmp } from "@/lib/machines/board";
import { parseGradeLabel } from "@/lib/card/grade";
import { formatCompactUsd, formatInt } from "@/lib/format";
import { askText, dayShort, monthShort, venueName } from "@/lib/card/identityView";
import { basisLabel, holdingName, partialText, unkeyedText, unvaluedLine, vaultCsv, vaultCsvName } from "@/lib/vault/view";

/**
 * Every slab at the address, one row each, valued by the rule its identity
 * page publishes: the reference price (latest complete month, with its n), else
 * the last sale. The basis rides every value as a chip.
 *
 * ⚠️ A FLOOR IS NEVER A VALUE, AND NEVER IN THE VALUE COLUMN. A plausible floor
 * prints in its own column; an implausible one prints as "unverified ask $1.84"
 * in the quiet ink, where nobody can mistake it for a price. "Your ask" is this
 * token's own listing — what the holder asks, not what the slab is worth.
 *
 * ⚠️ UNVALUED ROWS ARE LISTED, NOT DROPPED. They sit in their own group under
 * one line that counts them by reason, so the table always adds up to Holdings.
 *
 * ⚠️ A PARTIAL READ SAYS SO ABOVE THE ROWS IT HAS. The receipt line names what
 * stopped the read and how far it got; the rows that were read still show.
 *
 * Sort: value (default, high first), name, venue, grade — the machines
 * table's control. The sort runs over each group whole; only the rows mapped
 * into the table are cut (top TOP_ROWS, "Show all N →" in the foot).
 */
const TOP_ROWS = 25;

type SortKey = "value" | "name" | "venue" | "grade";

function gradeNum(h: VaultHolding): number {
  const g = parseGradeLabel(h.grade);
  return g ? g.grade : NaN;
}

function compare(a: VaultHolding, b: VaultHolding, k: SortKey, dir: 1 | -1): number {
  switch (k) {
    case "value":
      return cmp(a.value?.usd ?? NaN, b.value?.usd ?? NaN, dir);
    case "name":
      return holdingName(a).localeCompare(holdingName(b)) * dir;
    case "venue":
      return venueName(a.platform).localeCompare(venueName(b.platform)) * dir;
    case "grade":
      return cmp(gradeNum(a), gradeNum(b), dir) || (a.grade ?? "").localeCompare(b.grade ?? "") * dir;
  }
}

export function VaultHoldingsTable({ v }: { v: VaultValuation }) {
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [all, setAll] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current); }, []);

  const { valued, unvalued } = useMemo(() => {
    const tie = (a: VaultHolding, b: VaultHolding) => holdingName(a).localeCompare(holdingName(b)) || a.cardId.localeCompare(b.cardId);
    const by = (a: VaultHolding, b: VaultHolding) => compare(a, b, sortKey, dir) || tie(a, b);
    return {
      valued: v.holdings.filter((h) => h.value).sort(by),
      unvalued: v.holdings.filter((h) => !h.value).sort((a, b) => (sortKey === "value" ? tie(a, b) : by(a, b))),
    };
  }, [v.holdings, sortKey, dir]);

  const total = valued.length + unvalued.length;
  const budget = all ? total : TOP_ROWS;
  const shownValued = valued.slice(0, budget);
  const shownUnvalued = unvalued.slice(0, Math.max(0, budget - shownValued.length));
  const shown = shownValued.length + shownUnvalued.length;

  const onSort = (k: SortKey) => {
    if (k === sortKey) setDir((d) => (d === -1 ? 1 : -1));
    else {
      setSortKey(k);
      // Money reads high-first; words read A-first.
      setDir(k === "value" || k === "grade" ? -1 : 1);
    }
  };
  const sp = (k: SortKey) => ({ active: sortKey === k, dir, onClick: () => onSort(k) });

  const note = (msg: string) => {
    setFlash(msg);
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlash(null), 1800);
  };
  const exportCsv = () => {
    const blob = new Blob([vaultCsv(v)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = vaultCsvName(v.address);
    a.click();
    URL.revokeObjectURL(url);
    note("csv");
  };
  const share = () => {
    const done = () => note("share");
    navigator.clipboard?.writeText(window.location.href).then(done, done);
  };

  return (
    <Section
      title="Holdings"
      readMe="every slab, valued by the rule its identity page uses"
      subtitle={`${formatInt(v.totals.holdings)} slab${v.totals.holdings === 1 ? "" : "s"} · value = reference price, else last sale · a floor or an ask is never a value`}
      right={
        <span className="flex items-center gap-1.5">
          <ActionButton onClick={exportCsv} data="csv">{flash === "csv" ? "Downloaded" : "CSV"}</ActionButton>
          <ActionButton onClick={share} data="share">{flash === "share" ? "Copied" : "Share"}</ActionButton>
        </span>
      }
      flush
    >
      {v.partial ? (
        <p data-vault-partial className="border-b border-line px-4 py-2 font-mono text-[11px] text-ink-3 sm:px-5">
          {partialText(v.partial)}
        </p>
      ) : null}
      <div className="scroll-x">
        <table className="w-full min-w-[960px] border-collapse text-left" data-vault-holdings={v.totals.holdings}>
          <thead>
            <tr className="border-b border-line text-[10.5px] uppercase tracking-[0.07em] text-ink-4">
              <SortTh {...sp("name")} align="left" first>Slab</SortTh>
              <SortTh {...sp("grade")} align="left">Grade</SortTh>
              <SortTh {...sp("venue")} align="left">Venue</SortTh>
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">Reference</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">Last sale</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">Floor</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">Your ask</th>
              <SortTh {...sp("value")} align="right" last>Value</SortTh>
            </tr>
          </thead>
          <tbody>
            {shownValued.map((h) => (
              <Row key={h.cardId} h={h} />
            ))}
            {unvalued.length > 0 ? (
              <Fragment>
                <tr className="border-b border-line bg-bg-2/40" data-vault-unvalued-line>
                  <td colSpan={8} className="px-4 py-2 font-mono text-[11px] text-ink-3 sm:px-5">
                    {unvaluedLine(v.totals.unvalued)}
                  </td>
                </tr>
                {shownUnvalued.map((h) => (
                  <Row key={h.cardId} h={h} />
                ))}
              </Fragment>
            ) : null}
          </tbody>
        </table>
      </div>
      <TableFoot
        shown={shown}
        total={total}
        noun="slab"
        action={
          total > TOP_ROWS
            ? shown < total
              ? { label: `Show all ${formatInt(total)} →`, onClick: () => setAll(true) }
              : { label: `Show top ${TOP_ROWS}`, onClick: () => setAll(false) }
            : undefined
        }
      />
    </Section>
  );
}

function Row({ h }: { h: VaultHolding }) {
  const name = holdingName(h);
  return (
    <tr className="border-b border-line/60 transition-colors last:border-0 hover:bg-bg-2" data-vault-row={h.cardId}>
      <th scope="row" className="py-2 pl-4 pr-3 text-left font-normal sm:pl-5">
        <span className="flex min-w-0 items-center gap-2.5">
          <CardThumb src={h.image} variant="row" preview={{ name, grade: h.grade }} />
          <span className="min-w-0">
            {h.identity ? (
              <Link
                href={h.identity.href}
                data-identity-link
                className="block max-w-[240px] truncate text-[12.5px] font-semibold text-ink transition-colors hover:text-yellow"
              >
                {name}
              </Link>
            ) : (
              <span className="block max-w-[240px] truncate text-[12.5px] font-semibold text-ink-2">{name}</span>
            )}
            <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[10.5px] text-ink-4">
              {h.identity ? (
                <span className="max-w-[240px] truncate">
                  {[h.set, h.number ? `#${h.number}` : null].filter(Boolean).join(" · ") || "no set on the card"}
                </span>
              ) : (
                <>
                  <Chip>no identity yet</Chip>
                  <span className="max-w-[280px] truncate">{unkeyedText(h.unkeyed)}</span>
                </>
              )}
            </span>
          </span>
        </span>
      </th>
      <td className="whitespace-nowrap px-3 py-2">{h.grade ? <GradeChip label={h.grade} /> : <span className="text-ink-4">—</span>}</td>
      <td className="whitespace-nowrap px-3 py-2 text-[12.5px] text-ink-2">{venueName(h.platform)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular text-[12.5px]">
        {h.reference ? (
          <>
            <span className="text-ink">{formatCompactUsd(h.reference.priceUsd)}</span>
            <span className="mt-0.5 flex items-center justify-end gap-1.5 font-mono text-[10px] text-ink-4">
              {h.reference.thin ? <Chip>thin</Chip> : null}
              {monthShort(`${h.reference.month}-15T00:00:00Z`)} · n {h.reference.n}
            </span>
          </>
        ) : (
          <span className="text-ink-4" title="fewer than two sales in the latest complete month">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular text-[12.5px]">
        {h.lastSale ? (
          <>
            <span className="text-ink-2">{formatCompactUsd(h.lastSale.priceUsd)}</span>
            <span className="block font-mono text-[10px] text-ink-4">{dayShort(h.lastSale.ts)}</span>
          </>
        ) : (
          <span className="text-ink-4">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular text-[12.5px]">
        {h.floor ? (
          h.floor.plausible ? (
            <>
              <span className="text-ink-2">{askText(h.floor.priceUsd)}</span>
              <span className="block font-mono text-[10px] text-ink-4">{venueName(h.floor.venue)}</span>
            </>
          ) : (
            <span className="font-mono text-[11px] text-ink-3" title="an ask outside the plausible band of this card's price">
              unverified ask {askText(h.floor.priceUsd)}
            </span>
          )
        ) : (
          <span className="text-ink-4">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular text-[12.5px]">
        {h.yourAsk ? <span className="text-ink-2">{askText(h.yourAsk.priceUsd)}</span> : <span className="text-ink-4">—</span>}
      </td>
      <td className="whitespace-nowrap py-2 pl-3 pr-4 text-right tabular text-[12.5px] sm:pr-5">
        {h.value ? (
          <span className="inline-flex items-center justify-end gap-2">
            <BasisChip basis={h.value.basis} />
            <span className="font-semibold text-ink">{formatCompactUsd(h.value.usd)}</span>
          </span>
        ) : (
          <span className="font-mono text-[11px] text-ink-4">{h.unvalued === "no-identity" ? "no identity" : "no sale yet"}</span>
        )}
      </td>
    </tr>
  );
}

/** The value's basis — lime for the Varible price, the neutral chip for a sale. */
function BasisChip({ basis }: { basis: "reference" | "last-sale" }) {
  return basis === "reference" ? (
    <span data-basis="reference" className="rounded-md border border-yellow/30 bg-yellow/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-yellow">
      {basisLabel(basis)}
    </span>
  ) : (
    <Chip data="last-sale">{basisLabel(basis)}</Chip>
  );
}

function Chip({ children, data }: { children: React.ReactNode; data?: string }) {
  return (
    <span data-basis={data} className="rounded-md border border-line bg-bg-2 px-1.5 py-0.5 font-mono text-[10px] leading-none text-ink-3">
      {children}
    </span>
  );
}

function ActionButton({ children, onClick, data }: { children: React.ReactNode; onClick: () => void; data: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-vault-action={data}
      className="rounded-md border border-line px-2 py-1 font-mono text-[11px] text-ink-3 transition-colors hover:border-line-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
    >
      {children}
    </button>
  );
}

function SortTh({
  children,
  align,
  active,
  dir,
  onClick,
  first,
  last,
}: {
  children: React.ReactNode;
  align: "left" | "right";
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
  first?: boolean;
  last?: boolean;
}) {
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === -1 ? "descending" : "ascending") : "none"}
      className={`select-none whitespace-nowrap py-2 font-medium transition-colors ${first ? "pl-4 pr-3 sm:pl-5" : last ? "pl-3 pr-4 sm:pr-5" : "px-3"} ${
        align === "right" ? "text-right" : "text-left"
      } ${active ? "text-ink" : "text-ink-4 hover:text-ink-2"}`}
    >
      <button type="button" onClick={onClick} data-sort={String(children).toLowerCase()} className="inline-flex cursor-pointer items-center gap-1 uppercase tracking-[0.07em]">
        {children}
        <span className={active ? "text-yellow" : "text-ink-4"}>{active ? (dir === -1 ? "▼" : "▲") : "↕"}</span>
      </button>
    </th>
  );
}
