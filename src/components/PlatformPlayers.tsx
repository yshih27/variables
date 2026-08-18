"use client";

import { useMemo, useState } from "react";
import { Section } from "./Section";
import { MetricInfo } from "./MetricInfo";
import { ChartTooltip, anchorFromEvent, type TooltipAnchor } from "./ChartTooltip";
import { formatCompactUsd, formatCompactNumber, formatInt, formatMonthDayUtc } from "@/lib/format";
import type { PlatformPlayerAnalytics } from "@/lib/data/playerAnalytics";

/**
 * Players — who actually spends on a gacha platform, and how unevenly.
 *
 * Renders only for platforms whose pulls carry per-wallet attribution (Collector
 * Crypt, Phygitals). Everyone else is absent from the snapshot's `platforms` list
 * and gets no section — not a zero, not an empty frame. See getPlatformPlayers.
 *
 * ⚠️ ALREADY PERCENT. `pctUsers`, `pctRevenue`, `top1PctShare` and `top10PctShare`
 * all arrive on a 0–100 scale from playerAnalytics.ts. Nothing here multiplies by
 * 100. (This page's rail has the same hazard in the other direction — see the
 * fraction-vs-percent note in platform/[key]/page.tsx.)
 *
 * ⚠️ WALLETS, NOT PEOPLE. Every count here is a distinct address. One person can
 * hold many, and a custodial wallet can front many people, so these are an upper
 * and lower bound on "players" respectively — never call a wallet a user in copy.
 *
 * PRIVACY: the snapshot carries counts, sums and shares only. No addresses reach
 * this component, so nothing here can leak one.
 */

/** Stack colours, brand-first: the largest price band takes lime, the rest step
 *  through the same categorical ramp the Index Studio uses. `Other` keeps the
 *  neutral grey every other "Other" bucket on this page uses. */
const STACK_PALETTE = ["#bfef01", "#5fa3ff", "#a18cff", "#2bd6a0", "#fbbf24", "#ff6b9d"];
const OTHER_COLOR = "#52525b";

/** How many price bands get their own colour before the tail folds into "Other".
 *  CC runs 13 distinct pack prices; a 13-way stack is a colour lottery, not a
 *  chart. */
const TOP_BANDS = 6;

/**
 * Chart windows.
 *
 * ⚠️ SPEC DEVIATION, flagged deliberately: the brief asked for "30d default, ALL
 * available", but the backend aggregates spend into MONTHLY buckets — a 30-day
 * window over monthly buckets is one bar, which is not a chart. 6M keeps a real
 * default (six bars today) alongside full history. If daily player spend ever
 * lands, a true 30D pill drops straight in here.
 */
const WINDOWS = [
  { label: "6M", months: 6 },
  { label: "ALL", months: Infinity },
] as const;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-07" → "Jul '26". */
function fmtMonth(m: string): string {
  const [y, mo] = m.split("-");
  const i = Number(mo) - 1;
  return i >= 0 && i < 12 ? `${MON[i]} '${y.slice(2)}` : m;
}

/** Pack prices read as exact figures, not compacted — "$2,500" is a real price
 *  point on the platform; "$2.5K" is a rounding of one. */
function fmtPrice(p: string): string {
  const n = Number(p);
  return Number.isFinite(n) ? `$${n.toLocaleString()}` : p;
}

export function PlatformPlayers({
  data,
}: {
  /** null → render nothing (no attribution, or the warmer hasn't run). */
  data: { player: PlatformPlayerAnalytics; generatedAt: string } | null;
}) {
  if (!data) return null;
  const { player } = data;
  const { coverage, tiers, monthly, concentration: c } = player;

  // Coverage line — what this section actually saw, stated up front. The share of
  // rows carrying a wallet is the number that decides whether the tiers below are
  // the whole player base or a sample of it.
  const attributionPct =
    coverage.rows > 0 ? (coverage.walletAttributedRows / coverage.rows) * 100 : 0;
  const from = formatMonthDayUtc(coverage.firstPullAt);
  const to = formatMonthDayUtc(coverage.lastPullAt);
  const subtitle = [
    `${formatCompactNumber(coverage.rows)} pulls`,
    `${attributionPct >= 99.5 ? "100" : attributionPct.toFixed(1)}% wallet-attributed`,
    from && to ? `${from} – ${to}` : null,
    "lifetime spend per wallet",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Section title="Players" subtitle={subtitle} className="mb-12 font-sans">
      {/* Stat row — the three-number summary the tier table then explains. */}
      <div className="grid grid-cols-1 gap-x-5 gap-y-5 border-b border-line pb-5 sm:grid-cols-3">
        <Stat
          metric="activePlayers30d"
          label="Active wallets 30d"
          value={formatInt(c.activeWallets30d)}
          caption={`of ${formatInt(c.totalWallets)} that ever pulled`}
        />
        <Stat
          metric="spendConcentration"
          label="Top-10% share"
          value={`${c.top10PctShare.toFixed(1)}%`}
          caption={`of lifetime spend · top 1% take ${c.top1PctShare.toFixed(1)}%`}
        />
        <Stat
          metric="avgLifetimeSpend"
          label="Avg lifetime spend"
          value={formatCompactUsd(c.avgLifetimeSpendUsd)}
          // The mean/median gap IS the finding on a distribution this skewed —
          // showing the mean alone would read as a typical player, which it is not.
          caption={`median ${formatCompactUsd(c.medianLifetimeSpendUsd)}`}
        />
      </div>

      <TierTable tiers={tiers} totalWallets={c.totalWallets} totalSpend={c.totalSpendUsd} />
      <MonthlyChart monthly={monthly} />
    </Section>
  );
}

function Stat({
  metric,
  label,
  value,
  caption,
}: {
  metric: "activePlayers30d" | "spendConcentration" | "avgLifetimeSpend";
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div>
      <div className="text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-3">
        <MetricInfo metric={metric}>{label}</MetricInfo>
      </div>
      <div className="mt-2 font-mono text-[23px] font-bold leading-none tracking-[-0.01em] tabular text-ink">
        {value}
      </div>
      <div className="mt-1.5 font-mono text-[10.5px] leading-snug text-ink-4">{caption}</div>
    </div>
  );
}

/**
 * Spending tiers. The two % columns are the whole point: users climb one way,
 * revenue the other, and the crossing is the whale story in one glance.
 *
 * Both bar columns are normalised to their OWN column maximum, not to 100 — the
 * same convention MetricBarCard uses. Against a 100 baseline the ≤$50 tier's 0.4%
 * revenue bar is a sub-pixel smear and the inversion disappears; against the
 * column max the shapes are legible and the exact figure sits next to every bar,
 * so nothing is lost to the normalisation.
 */
function TierTable({
  tiers,
  totalWallets,
  totalSpend,
}: {
  tiers: PlatformPlayerAnalytics["tiers"];
  totalWallets: number;
  totalSpend: number;
}) {
  const maxUsersPct = Math.max(...tiers.map((t) => t.pctUsers), 0.0001);
  const maxRevPct = Math.max(...tiers.map((t) => t.pctRevenue), 0.0001);

  return (
    <div className="mt-5">
      <div className="mb-2.5 text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-3">
        <MetricInfo metric="spendTier">Spending tiers</MetricInfo>
      </div>
      <div className="scroll-x">
        <table className="w-full min-w-[620px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line">
              <Th>Tier</Th>
              <Th align="right">Wallets</Th>
              <Th align="right">Spend</Th>
              <Th>% of wallets</Th>
              <Th>% of revenue</Th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.label} className="border-b border-line/60">
                <Td className="font-mono font-semibold text-ink">{t.label}</Td>
                <Td align="right">{formatInt(t.users)}</Td>
                <Td align="right" strong>
                  {formatCompactUsd(t.totalSpendUsd)}
                </Td>
                <Td className="w-[26%]">
                  <PctBar pct={t.pctUsers} width={(t.pctUsers / maxUsersPct) * 100} color="var(--color-blue)" />
                </Td>
                <Td className="w-[26%]">
                  <PctBar pct={t.pctRevenue} width={(t.pctRevenue / maxRevPct) * 100} color="var(--color-yellow)" />
                </Td>
              </tr>
            ))}
            {/* Totals close the partition: every wallet and every dollar is in
                exactly one tier above, and this row lets a reader check that. */}
            <tr className="border-t border-line">
              <Td className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">Total</Td>
              <Td align="right" strong>
                {formatInt(totalWallets)}
              </Td>
              <Td align="right" strong>
                {formatCompactUsd(totalSpend)}
              </Td>
              <Td className="font-mono text-[11px] tabular text-ink-4">100%</Td>
              <Td className="font-mono text-[11px] tabular text-ink-4">100%</Td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      className={`px-3 py-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  className = "",
  strong,
}: {
  children: React.ReactNode;
  align?: "right";
  className?: string;
  strong?: boolean;
}) {
  const a = align === "right" ? "text-right font-mono tabular" : "text-left";
  return (
    <td
      className={`whitespace-nowrap px-3 py-3 ${a} ${strong ? "font-semibold text-ink" : "text-ink-2"} ${className}`}
    >
      {children}
    </td>
  );
}

/** A share, drawn and stated. `width` is the bar's normalised length; `pct` is the
 *  real figure and is what the reader actually takes away. */
function PctBar({ pct, width, color }: { pct: number; width: number; color: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="h-1.5 min-w-[3px] flex-1 bg-bg-3">
        <span
          className="block h-full"
          style={{ width: `${Math.max(1.5, Math.min(100, width))}%`, background: color }}
        />
      </span>
      <span className="w-[46px] shrink-0 text-right font-mono text-[11.5px] tabular text-ink">
        {pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%
      </span>
    </span>
  );
}

/**
 * Monthly gacha spend, stacked by pack price — where the money comes from, and
 * whether the mix is drifting toward the expensive packs.
 *
 * Bands are chosen by spend over the VISIBLE window, so switching range re-picks
 * them rather than carrying a 6-month ranking into an all-time view.
 */
function MonthlyChart({ monthly }: { monthly: PlatformPlayerAnalytics["monthly"] }) {
  const [win, setWin] = useState<number>(0);
  const [hover, setHover] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null);

  const months = useMemo(() => {
    const n = WINDOWS[win].months;
    return n === Infinity ? monthly : monthly.slice(-n);
  }, [monthly, win]);

  const { bands, stacks, max, total } = useMemo(() => {
    const byBand = new Map<string, number>();
    for (const m of months) {
      for (const [price, v] of Object.entries(m.byPrice)) {
        byBand.set(price, (byBand.get(price) ?? 0) + v);
      }
    }
    const ranked = [...byBand.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked.slice(0, TOP_BANDS).map(([p]) => p);
    const topSet = new Set(top);
    const hasOther = ranked.length > TOP_BANDS;

    const bands = [
      ...top.map((p, i) => ({ key: p, label: fmtPrice(p), color: STACK_PALETTE[i % STACK_PALETTE.length] })),
      ...(hasOther ? [{ key: "__other", label: "Other", color: OTHER_COLOR }] : []),
    ];

    const stacks = months.map((m) => {
      const parts = bands.map((b) => {
        if (b.key !== "__other") return { ...b, value: m.byPrice[b.key] ?? 0 };
        let sum = 0;
        for (const [price, v] of Object.entries(m.byPrice)) if (!topSet.has(price)) sum += v;
        return { ...b, value: sum };
      });
      return { month: m.month, total: m.totalUsd, pulls: m.pulls, parts };
    });

    const max = Math.max(...stacks.map((s) => s.total), 1);
    const total = stacks.reduce((a, s) => a + s.total, 0);
    return { bands, stacks, max, total };
  }, [months]);

  if (!stacks.length) {
    return (
      <div className="mt-6 flex h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-center">
        <span className="text-[12px] text-ink-3">Building history</span>
        <span className="text-[10.5px] text-ink-4">no monthly spend recorded yet</span>
      </div>
    );
  }

  const active = hover != null ? stacks[hover] : null;

  return (
    <div className="mt-7">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <div className="text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-3">
            Monthly spend by pack price
          </div>
          <div className="mt-1.5 font-mono text-[21px] font-bold leading-none tabular text-ink">
            {formatCompactUsd(active ? active.total : total)}
          </div>
          <div className={`mt-1 text-[11px] ${active ? "text-yellow" : "text-ink-3"}`}>
            {active
              ? `${fmtMonth(active.month)} · ${formatInt(active.pulls)} pulls`
              : `${WINDOWS[win].label === "ALL" ? "all-time" : WINDOWS[win].label.toLowerCase()} total`}
          </div>
        </div>
        <div className="flex gap-1">
          {WINDOWS.map((w, i) => (
            <button
              key={w.label}
              type="button"
              onClick={() => setWin(i)}
              className={`rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em] transition-colors ${
                i === win
                  ? "border-yellow/50 bg-yellow/10 text-yellow"
                  : "border-line text-ink-4 hover:border-line-2 hover:text-ink-2"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mt-3 h-[150px]">
        {/* ⚠️ items-stretch + h-full on the column, not items-end: the stack's
            height is a PERCENTAGE, and a percentage resolves to zero against an
            auto-height parent. items-end shrank each column to its content and
            every bar silently collapsed to nothing. */}
        <div className="absolute inset-0 flex items-stretch gap-[6px]">
          {stacks.map((s, i) => {
            const h = (s.total / max) * 100;
            const on = hover === i;
            return (
              <div key={s.month} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                <div
                  className="flex w-full flex-col-reverse transition-opacity"
                  style={{ height: `${Math.max(1.5, h)}%`, opacity: on || hover == null ? 1 : 0.45 }}
                >
                  {s.parts.map((p) =>
                    p.value > 0 ? (
                      <span
                        key={p.key}
                        className="block w-full"
                        style={{ height: `${(p.value / s.total) * 100}%`, background: p.color }}
                      />
                    ) : null,
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div
          className="absolute inset-0 flex gap-[6px]"
          onMouseLeave={() => {
            setHover(null);
            setAnchor(null);
          }}
        >
          {stacks.map((s, i) => (
            <div
              key={s.month}
              className="min-w-0 flex-1 cursor-default"
              onMouseEnter={(e) => {
                setHover(i);
                setAnchor(anchorFromEvent(e));
              }}
              onMouseMove={(e) => setAnchor(anchorFromEvent(e))}
            />
          ))}
        </div>

        <ChartTooltip anchor={active ? anchor : null}>
          <div className="mb-1 text-ink-3">{active ? fmtMonth(active.month) : ""}</div>
          {(active?.parts ?? [])
            .filter((p) => p.value > 0)
            .sort((a, b) => b.value - a.value)
            .map((p) => (
              <div key={p.key} className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 shrink-0" style={{ background: p.color }} />
                <span className="text-ink-3">{p.label}</span>
                <span className="ml-auto pl-3 font-semibold tabular text-ink">
                  {formatCompactUsd(p.value)}
                </span>
              </div>
            ))}
        </ChartTooltip>
      </div>

      {/* Month labels. Every bar is labelled at ALL-time width too — six to a dozen
          months fit without collision, unlike a daily axis. */}
      <div className="mt-2 flex gap-[6px] font-mono text-[10px] text-ink-4">
        {stacks.map((s) => (
          <div key={s.month} className="min-w-0 flex-1 truncate text-center">
            {fmtMonth(s.month)}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[11px] text-ink-3">
        {bands.map((b) => (
          <span key={b.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0" style={{ background: b.color }} />
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}
