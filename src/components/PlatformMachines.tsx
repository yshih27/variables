"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { MachineBoard, MachineRow } from "@/lib/data/playerAnalytics";
import { GACHA_ENABLED } from "@/lib/flags";
import { formatCompactUsd, formatInt } from "@/lib/format";
import {
  attributedPct,
  colorBySlug,
  isRawKey,
  shortKey,
  sortMachines,
  type MachineSortKey,
} from "@/lib/machines/board";
import { Section } from "./Section";
import { TableFoot } from "./TableFoot";

/**
 * Machines — for each Collector Crypt machine, how much is being pulled and
 * which partner's traffic is the largest share of it. One table, one question.
 *
 * ⚠️ EVERY SHARE IS OF ATTRIBUTED SPEND, AND THE DENOMINATOR IS STATED ONCE.
 * Only ~8% of CC's pull spend carries a `memo_slug`. Sharing against TOTAL spend
 * would silently rescale every partner by the attribution rate and make a
 * dominant partner look marginal; sharing against attributed is the honest
 * statement, and it is only honest if the reader can see how thin that base is —
 * hence the rate in the header rather than repeated per row.
 *
 * ⚠️ UNATTRIBUTED IS ITS OWN THING, NEVER FOLDED INTO `cc`. `cc` is itself a tag,
 * so "no tag" is NOT "Collector Crypt's own storefront" — it may be an older
 * client path, a partner that passes no memo, or a field the feed only exposes on
 * some endpoints. Until that is answered it is `unattributed`, in a neutral that
 * is never a partner colour.
 *
 * Odds, EV and hit lists are gacha-section content and stay behind
 * GACHA_ENABLED; this is an economics view over aggregates.
 */

/** The bar's neutral. Deliberately NOT from PALETTE — the whole point is that a
 *  reader can never mistake the unmeasured remainder for a partner. */
const UNATTRIBUTED_FILL = "var(--color-line-2)";

export function PlatformMachines({
  board,
  platformKey,
}: {
  board: MachineBoard | null | undefined;
  platformKey: string;
}) {
  const [sortKey, setSortKey] = useState<MachineSortKey>("spend");
  const [dir, setDir] = useState<1 | -1>(-1);

  // Memoized so the identity is stable — a fresh [] on every render would re-run both
  // memos below on every keystroke elsewhere on the page.
  const rows = useMemo(() => board?.rows ?? [], [board]);
  const colors = useMemo(() => colorBySlug(rows), [rows]);

  const sorted = useMemo(() => sortMachines(rows, sortKey, dir), [rows, sortKey, dir]);

  // ⚠️ The board carries NO platform key — it is Collector Crypt's by
  // construction (the one platform whose pulls have both a machine code and an
  // originating partner). So the page's key is what keeps it off every other
  // platform; without this check /platform/beezie would render CC's machines.
  if (platformKey !== "collector-crypt") return null;
  // Honest absence: no board, or a board with nothing in it, renders NOTHING —
  // not an empty frame, which would assert we measured and found no machines.
  if (!board || rows.length === 0) return null;

  const onSort = (k: MachineSortKey) => {
    if (k === sortKey) setDir((d) => (d === -1 ? 1 : -1));
    else {
      setSortKey(k);
      setDir(k === "name" ? 1 : -1);
    }
  };
  const sp = (k: MachineSortKey) => ({ active: sortKey === k, dir, onClick: () => onSort(k) });

  const asOf = board.asOf.slice(0, 10);

  return (
    <Section
      title="Machines"
      readMe="where the pull money goes, per machine — shares are of attributed spend"
      subtitle={`Last ${board.windowDays} complete days · through ${asOf}`}
      right={
        // The denominator, once. Every share in the table is against this.
        <span className="whitespace-nowrap font-mono text-[11px] text-ink-3">
          <span className="tabular text-ink-2">{board.attributedSpendPct.toFixed(1)}%</span> of spend
          attributed
        </span>
      }
      flush
    >
      <div className="scroll-x">
        <table className="w-full min-w-0 border-collapse text-[13px] md:min-w-[1040px]">
          <thead>
            <tr className="border-b border-line">
              <Th>#</Th>
              <SortTh {...sp("name")}>Machine</SortTh>
              <SortTh align="right" className="hidden md:table-cell" {...sp("price")}>Price</SortTh>
              <SortTh align="right" {...sp("spend")}>{board.windowDays}d Spend</SortTh>
              <SortTh align="right" className="hidden md:table-cell" {...sp("pulls")}>Pulls</SortTh>
              <SortTh align="right" className="hidden lg:table-cell" {...sp("spend7d")}>7d Spend</SortTh>
              <SortTh align="right" className="hidden sm:table-cell" {...sp("attributed")}>Attr %</SortTh>
              <Th className="hidden md:table-cell">Top partner</Th>
              <Th className="hidden sm:table-cell">Split</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <MachineTr key={r.key} row={r} rank={i + 1} colors={colors} />
            ))}
          </tbody>
        </table>
      </div>
      <TableFoot shown={sorted.length} total={rows.length} noun="machine" />
    </Section>
  );
}

function MachineTr({
  row,
  rank,
  colors,
}: {
  row: MachineRow;
  rank: number;
  colors: Map<string, string>;
}) {
  const pct = attributedPct(row);
  const raw = isRawKey(row);
  const label = raw ? shortKey(row.key) : row.name;

  return (
    <tr className="[&:last-child>td]:border-b-0">
      <Td className="w-[44px] text-ink-3">{String(rank).padStart(2, "0")}</Td>
      <Td>
        <MachineName row={row} raw={raw} label={label} />
      </Td>
      <Td align="right" className="hidden md:table-cell">
        {/* Null price = the machine is off the current catalog. Never an average
            reconstructed from its pulls, which would publish a mixed-price
            history as a sticker price. */}
        {row.priceUsd == null ? <span className="text-ink-4">—</span> : formatCompactUsd(row.priceUsd)}
      </Td>
      <Td align="right" strong>{formatCompactUsd(row.spendUsd)}</Td>
      <Td align="right" muted className="hidden md:table-cell">{formatInt(row.pulls)}</Td>
      <Td align="right" muted className="hidden lg:table-cell">{formatCompactUsd(row.spend7dUsd)}</Td>
      <Td align="right" muted className="hidden sm:table-cell">
        {Number.isFinite(pct) ? `${pct.toFixed(1)}%` : <span className="text-ink-4">—</span>}
      </Td>
      <Td className="hidden max-w-[190px] md:table-cell">
        <TopPartner row={row} colors={colors} />
      </Td>
      <Td className="hidden w-[220px] sm:table-cell">
        <SplitBar row={row} colors={colors} />
      </Td>
    </tr>
  );
}

function MachineName({ row, raw, label }: { row: MachineRow; raw: boolean; label: string }) {
  const cls = raw
    ? "font-mono text-[12px] text-ink-2"
    : "font-sans font-semibold text-ink";
  // ⚠️ Narrow on phones. At 375 the row is # + name + spend inside the page's own
  // px-8, which leaves ~311px — a 260px name pushes the spend column off the
  // right edge, and a clipped number is worse than a truncated title.
  const inner = (
    <span className={`block max-w-[136px] truncate sm:max-w-[200px] md:max-w-[260px] ${cls}`} title={row.key}>
      {label}
    </span>
  );
  // The machine page is gacha-section content, so it is only a link when the
  // gacha surface is public. Otherwise the name is plain text, not a dead link.
  return GACHA_ENABLED ? (
    <Link href="/gacha" className="hover:text-yellow">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function TopPartner({ row, colors }: { row: MachineRow; colors: Map<string, string> }) {
  // ⚠️ Null when nothing on this machine is attributed — there is no top partner
  // of nothing. Currently unexercised in live data (48/48 machines carry at least
  // one attributed pull), which is exactly why it is written explicitly.
  if (!row.topPartner) return <span className="text-ink-4">—</span>;
  const { slug, label, sharePct } = row.topPartner;
  const confirmed = label !== slug;
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-none"
        style={{ background: colors.get(slug) ?? UNATTRIBUTED_FILL }}
      />
      {/* An unconfirmed slug renders in MONO, as the identifier it is. Only two of
          the 18 live slugs have confirmed labels, and setting a raw slug in the
          same type as a brand name would read as a brand we do not have. */}
      <span
        className={`min-w-0 truncate ${confirmed ? "text-ink-2" : "font-mono text-[12px] text-ink-2"}`}
        title={confirmed ? `${label} (${slug})` : `unconfirmed partner slug: ${slug}`}
      >
        {label}
      </span>
      <span className="tabular shrink-0 text-ink-3">{sharePct.toFixed(0)}%</span>
    </span>
  );
}

/**
 * The split bar spans TOTAL spend, not attributed spend.
 *
 * ⚠️ THAT IS THE POINT. At a 7.8% attribution rate the neutral remainder is most
 * of most bars — $29.2M of $31.6M on the top machine — and a bar drawn over
 * attributed spend alone would show a confident, fully-coloured split of a sliver
 * while hiding that the sliver is 8% of the money. The numbers in the row are
 * shares OF ATTRIBUTED (as labelled); the bar is where the reader sees how much
 * of the machine we can attribute at all.
 */
function SplitBar({ row, colors }: { row: MachineRow; colors: Map<string, string> }) {
  const total = row.spendUsd;
  if (!(total > 0)) return <span className="text-ink-4">—</span>;
  const segs = row.partners.filter((p) => p.spendUsd > 0);
  return (
    <span className="flex h-2.5 w-full overflow-hidden rounded-none bg-bg-2">
      {segs.map((p) => (
        <span
          key={p.slug}
          className="h-full"
          style={{ width: `${(p.spendUsd / total) * 100}%`, background: colors.get(p.slug) }}
          title={`${p.label} · ${formatCompactUsd(p.spendUsd)} · ${p.sharePct.toFixed(1)}% of attributed`}
        />
      ))}
      <span
        className="h-full flex-1"
        style={{ background: UNATTRIBUTED_FILL }}
        title={`Unattributed · ${formatCompactUsd(row.unattributedUsd)} · no memo_slug on these pulls`}
      />
    </span>
  );
}

// ── table primitives (the IPTable pattern) ───────────────────────────────────

function Th({
  children,
  align,
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
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
      aria-sort={active ? (dir === -1 ? "descending" : "ascending") : "none"}
      className={`select-none px-3 py-3 text-[11px] font-medium uppercase tracking-[0.06em] transition-colors sm:px-4 ${
        active ? "text-ink" : "text-ink-3 hover:text-ink-2"
      } ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      <button type="button" onClick={onClick} className="inline-flex cursor-pointer items-center gap-1">
        {children}
        <span className={active ? "text-yellow" : "text-ink-4"}>{active ? (dir === -1 ? "▼" : "▲") : "↕"}</span>
      </button>
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
    <td className={`tabular whitespace-nowrap border-b border-line/60 px-3 py-3 sm:px-4 ${alignCls} ${weightCls} ${className}`}>
      {children}
    </td>
  );
}
