"use client";

import { useState } from "react";
import Link from "next/link";
import type { SpendTier } from "@/lib/data/fetchGacha";
import type { Chain } from "@/lib/types";
import { formatCompactUsd, formatCompactNumber, formatInt } from "@/lib/format";

const CHAIN_DOT: Record<Chain, string> = {
  Polygon: "var(--color-purple)",
  Solana: "var(--color-solana)",
  Base: "var(--color-blue)",
  Ethereum: "#9aa6ff",
};

/**
 * "I have $X — where do I spend it?" Pick a budget tier, see a head-to-head
 * platform comparison ranked by 24h popularity. Odds / top-prize / biggest-hit
 * columns are stubbed until the NFT-matching queries land.
 */
export function GachaBudgetCompare({ tiers }: { tiers: SpendTier[] }) {
  const defaultKey =
    [...tiers].sort((a, b) => b.totalSpins24h - a.totalSpins24h)[0]?.key ??
    tiers[0]?.key ??
    "";
  const [selected, setSelected] = useState(defaultKey);
  const tier = tiers.find((t) => t.key === selected) ?? tiers[0];

  if (!tier) {
    return (
      <section className="mt-10 rounded-xl border border-line bg-bg-1 p-6 text-[13px] text-ink-3">
        No budget data yet — run <code className="rounded bg-bg-2 px-1.5 py-0.5 text-ink-2">npm run warm-gacha-dune</code>.
      </section>
    );
  }

  return (
    <section className="mt-10">
      <h2 className="mb-4 text-[22px] font-semibold tracking-[-0.005em]">Compare by Budget</h2>

      {/* Budget chips */}
      <div className="scroll-x mb-6 flex gap-2">
        {tiers.map((t) => {
          const active = t.key === tier.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setSelected(t.key)}
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

      <div className="scroll-x">
        <table className="w-full min-w-[920px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line">
              <Th>Platform</Th>
              <Th align="right">Spins 24h</Th>
              <Th align="right">7d</Th>
              <Th align="right">30d</Th>
              <Th align="right">Avg Spend</Th>
              <Th align="right" title="Best-tier hit probability — coming with the odds query">
                Best Odds
              </Th>
              <Th align="right" title="Highest possible prize at this tier — coming with the hits query">
                Top Prize
              </Th>
              <Th align="right" title="Biggest actual hit (FMV) in 24h — coming with the hits query">
                Biggest Hit
              </Th>
            </tr>
          </thead>
          <tbody>
            {tier.platforms.map((p, i) => (
              <tr
                key={p.key}
                className="group relative cursor-pointer transition-colors hover:bg-bg-1"
              >
                <Td>
                  <Link
                    href={`/platform/${p.key}`}
                    className="flex items-center gap-2.5 font-semibold before:absolute before:inset-0 before:content-['']"
                  >
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-bg-2 text-[11px] font-bold">
                      {p.short}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="group-hover:text-yellow">{p.name}</span>
                      <span
                        className="inline-flex h-1.5 w-1.5 rounded-full"
                        style={{ background: CHAIN_DOT[p.chain] }}
                      />
                      {i === 0 && (
                        <span className="rounded-md bg-yellow/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-yellow">
                          Most popular
                        </span>
                      )}
                    </span>
                  </Link>
                </Td>
                <Td align="right" strong>{formatInt(p.spins24h)}</Td>
                <Td align="right" muted>{formatCompactNumber(p.spins7d)}</Td>
                <Td align="right" muted>{formatCompactNumber(p.spins30d)}</Td>
                <Td align="right">{formatCompactUsd(p.avgSpend)}</Td>
                <Td align="right"><Pending /></Td>
                <Td align="right"><Pending /></Td>
                <Td align="right"><Pending /></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </section>
  );
}

function Pending() {
  return <span className="text-[11px] text-ink-4">soon</span>;
}

function Th({
  children,
  align,
  title,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  title?: string;
}) {
  return (
    <th
      title={title}
      className={`px-4 py-3 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 ${
        align === "right" ? "text-right" : "text-left"
      } ${title ? "cursor-help" : ""}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  strong,
  muted,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  strong?: boolean;
  muted?: boolean;
}) {
  const a = align === "right" ? "text-right" : "";
  const w = strong ? "font-semibold text-ink" : muted ? "text-ink-2" : "";
  return (
    <td className={`tabular whitespace-nowrap border-b border-line/60 px-4 py-4 ${a} ${w}`}>
      {children}
    </td>
  );
}
