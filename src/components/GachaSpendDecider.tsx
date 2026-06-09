"use client";

import { useMemo, useState } from "react";
import { formatCompactUsd, formatInt } from "@/lib/format";
import type { Chain } from "@/lib/types";
import type { SpendDecider, PlatformDecision } from "@/lib/data/gachaDecide";

const CHAIN_DOT: Record<Chain, string> = {
  Polygon: "var(--color-purple)",
  Solana: "var(--color-solana)",
  Base: "var(--color-blue)",
  Ethereum: "#9aa6ff",
};

type SortKey = "value" | "odds" | "popularity";

/** Shared 5-column grid: header row + each platform row align to it. */
const GRID =
  "grid grid-cols-2 gap-3 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr] md:items-center md:gap-4";

/**
 * "I have $X — where do I spend it?" Pick a budget; every platform's money back
 * (EV) and hit odds sit side by side, sortable by either. No verdict — the
 * ranking and the numbers let the user draw their own conclusion.
 */
export function GachaSpendDecider({ decider }: { decider: SpendDecider }) {
  const tiers = decider.tiers;
  const defaultKey =
    [...tiers].sort((a, b) => b.totalSpins24h - a.totalSpins24h)[0]?.key ??
    tiers[0]?.key ??
    "";
  const [tierKey, setTierKey] = useState(defaultKey);
  const [sortBy, setSortBy] = useState<SortKey>("value");
  const tier = tiers.find((t) => t.key === tierKey) ?? tiers[0];

  const sorted = useMemo(() => {
    if (!tier) return [];
    const metric = (p: PlatformDecision) =>
      sortBy === "value" ? p.moneyBackUsd : sortBy === "odds" ? p.hitOddsPct : p.spins24h;
    return [...tier.platforms].sort((a, b) => {
      const av = metric(a),
        bv = metric(b);
      if (av == null && bv == null) return b.spins24h - a.spins24h;
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    });
  }, [tier, sortBy]);

  if (!tier) {
    return (
      <section className="mt-14 rounded-xl border border-line bg-bg-1 p-6 text-[13px] text-ink-3">
        No budget data yet.
      </section>
    );
  }

  return (
    <section className="mt-14">
      <h2 className="text-[22px] font-semibold tracking-[-0.005em]">Where should I spend it?</h2>

      {/* Budget selector */}
      <div className="scroll-x mb-6 mt-5 flex gap-2">
        {tiers.map((t) => {
          const active = t.key === tier.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTierKey(t.key)}
              className={`shrink-0 rounded-xl border px-5 py-3 text-[18px] font-bold tabular transition-colors ${
                active
                  ? "border-yellow/60 bg-yellow/10 text-yellow"
                  : "border-line/70 bg-bg-1 text-ink hover:border-line hover:bg-bg-2"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Sort control */}
      <div className="mb-2 flex items-center gap-1.5 text-[12px] text-ink-3">
        <span className="mr-1">Sort by</span>
        <SortBtn active={sortBy === "value"} onClick={() => setSortBy("value")}>
          Money back
        </SortBtn>
        <SortBtn active={sortBy === "odds"} onClick={() => setSortBy("odds")}>
          Hit odds
        </SortBtn>
        <SortBtn active={sortBy === "popularity"} onClick={() => setSortBy("popularity")}>
          Popularity
        </SortBtn>
      </div>

      {/* Header row (desktop) */}
      <div className={`${GRID} hidden border-b border-line px-5 pb-2 md:grid`}>
        <span className="text-[10px] uppercase tracking-[0.07em] text-ink-3">Platform</span>
        <HeadCell label="Money Back" active={sortBy === "value"} title="Average return if you cash a pull straight back to the house" />
        <HeadCell label="Hit Odds" active={sortBy === "odds"} title="Realized chance of an Epic+ pull" />
        <HeadCell label="Biggest Hit" />
        <HeadCell label="Popularity" active={sortBy === "popularity"} title="Spins in the last 24h" />
      </div>

      {/* Rows */}
      <div className="flex flex-col gap-2 md:gap-0">
        {sorted.map((p, i) => (
          <div
            key={p.key}
            className={`${GRID} rounded-xl border border-line bg-bg-1 px-5 py-4 md:rounded-none md:border-x-0 md:border-t-0 md:border-b md:border-line/60 md:bg-transparent md:py-4 md:transition-colors md:hover:bg-bg-1`}
          >
            <div className="col-span-2 flex items-center gap-3 md:col-span-1">
              <span className="w-5 text-[12px] tabular text-ink-3">{String(i + 1).padStart(2, "0")}</span>
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-bg-2 text-[11px] font-bold">
                {p.short}
              </span>
              <span className="flex items-center gap-2 font-semibold">
                {p.name}
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: CHAIN_DOT[p.chain] }} />
              </span>
            </div>

            <Cell
              label="Money Back"
              active={sortBy === "value"}
              value={p.moneyBackUsd != null ? formatCompactUsd(p.moneyBackUsd) : null}
              tone="green"
            />
            <Cell
              label="Hit Odds"
              active={sortBy === "odds"}
              value={p.hitOddsPct != null ? pct(p.hitOddsPct) : null}
              tone="ink"
            />
            <Cell
              label="Biggest Hit"
              value={p.biggestHitUsd != null ? formatCompactUsd(p.biggestHitUsd) : "—"}
              tone="muted"
            />
            <Cell
              label="Popularity"
              active={sortBy === "popularity"}
              value={formatInt(p.spins24h)}
              tone="muted"
            />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── sub-components ───────────────────────── */

function HeadCell({
  label,
  active,
  title,
}: {
  label: string;
  active?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`text-right text-[10px] uppercase tracking-[0.07em] ${
        active ? "text-yellow" : "text-ink-3"
      } ${title ? "cursor-help" : ""}`}
    >
      {label}
      {active && <span className="ml-1">↓</span>}
    </span>
  );
}

function Cell({
  label,
  value,
  tone,
  active,
}: {
  label: string;
  value: string | null;
  tone: "green" | "ink" | "muted";
  active?: boolean;
}) {
  const color = tone === "green" ? "text-green" : tone === "muted" ? "text-ink-2" : "text-ink";
  const size = tone === "muted" ? "text-[14px]" : "text-[18px]";
  return (
    <div className="md:text-right">
      <div
        className={`mb-0.5 text-[10px] uppercase tracking-[0.07em] md:hidden ${
          active ? "text-yellow" : "text-ink-3"
        }`}
      >
        {label}
      </div>
      {value != null ? (
        <span className={`${size} font-bold tabular ${color}`}>{value}</span>
      ) : (
        <span className="text-[12px] text-ink-4">soon</span>
      )}
    </div>
  );
}

function SortBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg px-2.5 py-1 text-[12px] transition-colors ${
        active ? "bg-bg-2 text-yellow" : "text-ink-3 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function pct(p: number): string {
  return `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;
}
