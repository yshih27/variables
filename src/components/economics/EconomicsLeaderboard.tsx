"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { EconomicsPlatform } from "@/lib/types";
import { formatCompactUsd } from "@/lib/format";
import { Section } from "../Section";
import { TableFoot } from "../TableFoot";
import { MetricInfo } from "../MetricInfo";
import { HeldChip } from "./HeldChip";

/**
 * The economics leaderboard — every venue on one row.
 *
 * ⚠️ THREE DIFFERENT ABSENCES, THREE DIFFERENT CELLS, and conflating them is the
 * whole failure mode this page exists to avoid:
 *   • SUPPRESSED (Phygitals) — spend renders, the outbound side renders nothing
 *     and says why. Its exclusion list misses its dominant non-player
 *     counterparties, so a published rate would be an artifact of the omission.
 *   • UNSOURCED (Beezie, Courtyard, DYLI) — "—" with the reason. No payout wallet
 *     exists, so there is nothing to compute, ever. Never a zero.
 *   • HELD (Collector Crypt) — the flows and the ratio publish; only the net is
 *     withheld, as a chip carrying its reason.
 *
 * ⚠️ NO NET IS RENDERABLE HERE WHILE HELD, structurally: `net30d` is null
 * whenever `heldReason` is set (enforced in buildEconomicsBoard), so the cell has
 * nothing to print even if this component tried.
 */

type SortKey = "name" | "spend" | "outbound" | "ratio" | "r3" | "players" | "partner";

function valueFor(p: EconomicsPlatform, k: SortKey): number {
  switch (k) {
    case "spend":
      return p.spend30d;
    case "outbound":
      return p.outbound30d ?? NaN;
    case "ratio":
      return p.ratioPct30d ?? NaN;
    case "r3":
      return p.r3VerifiedPct30d ?? NaN;
    case "players":
      return p.players?.top1PctSharePct ?? NaN;
    case "partner":
      return p.partnerAttributedPct ?? NaN;
    case "name":
      return NaN;
  }
}

/** Non-finite ALWAYS sinks, either direction — the IPTable rule, so a "—" can't
 *  float to the top of an ascending sort and read as the smallest value. */
function cmp(a: number, b: number, dir: 1 | -1): number {
  const an = !Number.isFinite(a);
  const bn = !Number.isFinite(b);
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  return (a - b) * dir;
}

const money = (n: number | null) =>
  n == null || !Number.isFinite(n) ? null : formatCompactUsd(n);
const signedMoney = (n: number) =>
  !Number.isFinite(n) ? "—" : n < 0 ? `−${formatCompactUsd(Math.abs(n))}` : formatCompactUsd(n);

export function EconomicsLeaderboard({ platforms }: { platforms: EconomicsPlatform[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [dir, setDir] = useState<1 | -1>(-1);

  const sorted = useMemo(
    () =>
      [...platforms].sort((a, b) =>
        sortKey === "name"
          ? a.name.localeCompare(b.name) * dir
          : cmp(valueFor(a, sortKey), valueFor(b, sortKey), dir),
      ),
    [platforms, sortKey, dir],
  );

  if (platforms.length === 0) return null;

  const onSort = (k: SortKey) => {
    if (k === sortKey) setDir((d) => (d === -1 ? 1 : -1));
    else {
      setSortKey(k);
      setDir(k === "name" ? 1 : -1);
    }
  };
  const sp = (k: SortKey) => ({ active: sortKey === k, dir, onClick: () => onSort(k) });

  return (
    <Section
      title="By platform"
      readMe="what each venue took in, paid out, and can prove"
      flush
    >
      <div className="scroll-x">
        <table className="w-full min-w-0 border-collapse text-[13px] md:min-w-[1080px]">
          <thead>
            <tr className="border-b border-line">
              <Th>#</Th>
              <SortTh {...sp("name")}>Platform</SortTh>
              <SortTh align="right" info="gacha" {...sp("spend")}>30d Spend</SortTh>
              <SortTh align="right" className="hidden md:table-cell" info="grossOutbound" {...sp("outbound")}>30d Outbound</SortTh>
              <SortTh align="right" className="hidden sm:table-cell" info="ratio" {...sp("ratio")}>Ratio</SortTh>
              <SortTh align="right" className="hidden lg:table-cell" info="r3Verified" {...sp("r3")}>R3-verified</SortTh>
              {/* ⚠️ Net keeps its slot at EVERY width, ahead of Ratio. The
                  per-platform hold is this page's thesis — "held · reconciliation"
                  vs "no payout source" is the distinction a phone reader most
                  needs — and the ratio is one breakpoint away. */}
              <Th align="right" info="held">Net</Th>
              <SortTh align="right" className="hidden lg:table-cell" info="spendConcentration" {...sp("players")}>Top 1%</SortTh>
              <SortTh align="right" className="hidden xl:table-cell" info="partnerAttribution" {...sp("partner")}>Attributed</SortTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
              <Row key={p.key} p={p} rank={i + 1} />
            ))}
          </tbody>
        </table>
      </div>
      <TableFoot shown={sorted.length} total={platforms.length} noun="platform" />
    </Section>
  );
}

function Row({ p, rank }: { p: EconomicsPlatform; rank: number }) {
  const suppressed = p.disclosure === "suppressed";
  const unsourced = p.heldReason === "unsourced";
  const outbound = money(p.outbound30d);

  return (
    <tr className="[&:last-child>td]:border-b-0">
      <Td className="w-[44px] text-ink-3">{String(rank).padStart(2, "0")}</Td>
      <Td>
        <Link href={`/platform/${p.key}`} className="font-sans font-semibold text-ink hover:text-yellow">
          {p.name}
        </Link>
      </Td>
      <Td align="right" strong>{Number.isFinite(p.spend30d) ? formatCompactUsd(p.spend30d) : "—"}</Td>
      <Td align="right" className="hidden md:table-cell">
        {outbound ?? (
          <Absent
            note={suppressed ? "outbound held — counterparty split" : "no payout source"}
          />
        )}
      </Td>
      <Td align="right" muted className="hidden sm:table-cell">
        {p.ratioPct30d == null ? <Absent note={suppressed ? "held" : "no payout source"} /> : `${p.ratioPct30d.toFixed(1)}%`}
      </Td>
      <Td align="right" muted className="hidden lg:table-cell">
        {p.r3VerifiedPct30d == null ? <Absent note={suppressed ? "held" : "no payout source"} /> : `${p.r3VerifiedPct30d.toFixed(1)}%`}
      </Td>
      <Td align="right">
        {/* Structurally exclusive: a net exists only when nothing holds it. */}
        {p.net30d != null ? (
          <span className="font-semibold text-ink">{signedMoney(p.net30d)}</span>
        ) : p.heldReason ? (
          <HeldChip reasons={[p.heldReason]} />
        ) : (
          <Absent note={unsourced ? "no payout source" : "not computed"} />
        )}
      </Td>
      <Td align="right" muted className="hidden lg:table-cell">
        {p.players ? `${p.players.top1PctSharePct.toFixed(1)}%` : <Absent note="not covered by player analytics" />}
      </Td>
      <Td align="right" muted className="hidden xl:table-cell">
        {p.partnerAttributedPct == null ? (
          <Absent note="no partner attribution on this platform" />
        ) : (
          `${p.partnerAttributedPct.toFixed(1)}%`
        )}
      </Td>
    </tr>
  );
}

/** A dash that carries its reason. Never a zero, never a bare blank. */
function Absent({ note }: { note: string }) {
  return (
    <span className="text-ink-4" title={note}>
      —
    </span>
  );
}

function Th({
  children,
  align,
  info,
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  info?: Parameters<typeof MetricInfo>[0]["metric"];
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-3 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 sm:px-4 ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {info && <MetricInfo metric={info} />}
      </span>
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
  info?: Parameters<typeof MetricInfo>[0]["metric"];
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
    <td className={`tabular whitespace-nowrap border-b border-line/60 px-3 py-3.5 sm:px-4 ${alignCls} ${weightCls} ${className}`}>
      {children}
    </td>
  );
}
