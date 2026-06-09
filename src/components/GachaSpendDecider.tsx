"use client";

import { useMemo, useState } from "react";
import { formatCompactUsd, formatInt } from "@/lib/format";
import type { Chain } from "@/lib/types";
import type {
  SpendDecider,
  SpendDecision,
  PlatformDecision,
} from "@/lib/data/gachaDecide";

const CHAIN_DOT: Record<Chain, string> = {
  Polygon: "var(--color-purple)",
  Solana: "var(--color-solana)",
  Base: "var(--color-blue)",
  Ethereum: "#9aa6ff",
};

type SortKey = "value" | "odds" | "popularity";

/**
 * "I have $X — where do I spend it?" Pick a budget; compare every platform on
 * MONEY BACK (EV from house take) and HIT ODDS (realized Epic+ rate) side by
 * side, sortable by either. The top card per sort is crowned with a verdict.
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
        No budget data yet — run{" "}
        <code className="rounded bg-bg-2 px-1.5 py-0.5 text-ink-2">npm run warm-gacha-dune</code>.
      </section>
    );
  }

  const winner = sorted[0];
  const winnerHasMetric =
    winner &&
    (sortBy === "popularity" ||
      (sortBy === "value" && winner.moneyBackUsd != null) ||
      (sortBy === "odds" && winner.hitOddsPct != null));

  return (
    <section className="mt-14">
      <div>
        <h2 className="text-[22px] font-semibold tracking-[-0.005em]">Where should I spend it?</h2>
        <div className="mt-1 text-[12px] text-ink-3">
          Pick a budget — compare money back vs. odds of a hit across every platform.
        </div>
      </div>

      {/* Budget selector */}
      <div className="scroll-x mb-5 mt-5 flex gap-2">
        {tiers.map((t) => {
          const active = t.key === tier.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTierKey(t.key)}
              className={`inline-flex shrink-0 flex-col items-start gap-0.5 rounded-xl border px-4 py-2.5 text-left transition-colors ${
                active
                  ? "border-yellow/60 bg-yellow/10"
                  : "border-line/70 bg-bg-1 hover:border-line hover:bg-bg-2"
              }`}
            >
              <span className={`text-[18px] font-bold tabular ${active ? "text-yellow" : "text-ink"}`}>
                {t.label}
              </span>
              <span className="text-[10px] uppercase tracking-[0.06em] text-ink-3">
                {formatInt(t.totalSpins24h)} spins · 24h
              </span>
            </button>
          );
        })}
      </div>

      {/* Verdict */}
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-yellow/25 bg-yellow/[0.06] px-5 py-4">
        <span aria-hidden className="text-[15px] leading-none">🏆</span>
        <p className="text-[13px] leading-relaxed text-ink-2">{verdict(tier, winner, sortBy)}</p>
      </div>

      {/* Sort control */}
      <div className="mb-3 flex items-center gap-1.5 text-[12px] text-ink-3">
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

      {/* Decision cards */}
      <div className="flex flex-col gap-3">
        {sorted.map((p, i) => (
          <DecisionCard
            key={p.key}
            p={p}
            rank={i + 1}
            sortBy={sortBy}
            isWinner={i === 0 && !!winnerHasMetric}
          />
        ))}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-ink-4">
        <span className="text-ink-3">Money back</span> = average return if you instantly cash a pull
        back to the house (on-chain buyback economics); keeping a rare pull can be worth more.{" "}
        <span className="text-ink-3">Hit odds</span> = realized chance of an Epic+ prize.{" "}
        <span className="text-ink-3">Soon</span> = the platform doesn&apos;t publish that on-chain yet.
      </p>
    </section>
  );
}

/* ───────────────────────── sub-components ───────────────────────── */

function DecisionCard({
  p,
  rank,
  sortBy,
  isWinner,
}: {
  p: PlatformDecision;
  rank: number;
  sortBy: SortKey;
  isWinner: boolean;
}) {
  const badge =
    sortBy === "odds" ? "Best odds" : sortBy === "value" ? "Best value" : "Most played";
  return (
    <div
      className={`relative grid grid-cols-2 gap-4 rounded-2xl border px-5 py-4 md:grid-cols-[minmax(170px,1.1fr)_1fr_1fr_1.2fr] md:items-center ${
        isWinner ? "border-yellow/50 bg-yellow/[0.04]" : "border-line bg-bg-1"
      }`}
    >
      {/* identity */}
      <div className="col-span-2 flex items-center gap-3 md:col-span-1">
        <span className="w-5 text-[12px] tabular text-ink-3">{String(rank).padStart(2, "0")}</span>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-bg-2 text-[12px] font-bold">
          {p.short}
        </span>
        <div className="flex flex-col">
          <span className="flex items-center gap-2 font-semibold">
            {p.name}
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: CHAIN_DOT[p.chain] }} />
          </span>
          {isWinner && (
            <span className="mt-1 inline-flex w-fit items-center rounded-md bg-yellow px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.06em] text-black">
              {badge}
            </span>
          )}
        </div>
      </div>

      {/* money back */}
      <Metric
        label="Money Back"
        active={sortBy === "value"}
        value={p.moneyBackUsd != null ? formatCompactUsd(p.moneyBackUsd) : null}
        sub={
          p.evMultiple != null
            ? `${p.evMultiple.toFixed(2)}× · ${Math.round((p.houseEdgePct ?? 0) * 100)}% edge`
            : undefined
        }
        tone="green"
      />

      {/* hit odds */}
      <Metric
        label="Hit Odds"
        active={sortBy === "odds"}
        value={p.hitOddsPct != null ? pct(p.hitOddsPct) : null}
        sub={p.hitOddsPct != null ? "Epic+ pull" : undefined}
        tone="ink"
      />

      {/* biggest hit + popularity */}
      <div className="col-span-2 flex items-center justify-between gap-3 md:col-span-1">
        <div className="flex flex-col" title={p.biggestHitName ?? undefined}>
          <span className="text-[10px] uppercase tracking-[0.06em] text-ink-3">Biggest hit</span>
          <span className="text-[14px] font-bold tabular">
            {p.biggestHitUsd != null ? formatCompactUsd(p.biggestHitUsd) : "—"}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] uppercase tracking-[0.06em] text-ink-3">Popularity</span>
          <span className="text-[13px] tabular text-ink-2">
            {formatInt(p.spins24h)}
            <span className="text-ink-3"> /24h</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  active,
  tone,
}: {
  label: string;
  value: string | null;
  sub?: string;
  active: boolean;
  tone: "green" | "ink";
}) {
  return (
    <div className={`rounded-xl px-3 py-2 transition-colors ${active ? "bg-bg-2" : ""}`}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.06em] text-ink-3">
        {label}
        {active && <span className="text-yellow">↓</span>}
      </div>
      {value != null ? (
        <div
          className={`text-[19px] font-bold tabular ${tone === "green" ? "text-green" : "text-ink"}`}
        >
          {value}
        </div>
      ) : (
        <div className="mt-1">
          <span className="inline-flex items-center rounded-md bg-yellow/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-yellow ring-1 ring-inset ring-yellow/20">
            Soon
          </span>
        </div>
      )}
      {sub && value != null && <div className="mt-0.5 text-[11px] text-ink-3">{sub}</div>}
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

/* ───────────────────────── helpers ───────────────────────── */

function pct(p: number): string {
  return `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;
}

function verdict(tier: SpendDecision, winner: PlatformDecision | undefined, sortBy: SortKey): string {
  if (!winner) return "No platforms are live at this budget yet.";
  if (sortBy === "value") {
    if (winner.moneyBackUsd == null)
      return `Money-back data is still warming for ${tier.label} platforms — sort by hit odds or popularity for now.`;
    return `Best value at ${tier.label}: ${winner.name} — about ${formatCompactUsd(
      winner.moneyBackUsd,
    )} back per pull (${Math.round((winner.houseEdgePct ?? 0) * 100)}% house edge).`;
  }
  if (sortBy === "odds") {
    if (winner.hitOddsPct == null)
      return `Hit-odds data is still warming — only Collector Crypt publishes realized odds on-chain today.`;
    return `Best hit odds at ${tier.label}: ${winner.name} — ${pct(
      winner.hitOddsPct,
    )} chance of an Epic+ pull.`;
  }
  return `Most played at ${tier.label}: ${winner.name} — ${formatInt(winner.spins24h)} spins in 24h.`;
}
