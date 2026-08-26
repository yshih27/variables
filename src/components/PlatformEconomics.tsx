"use client";

import { useState } from "react";
import { Section, ReadMe } from "./Section";
import { MetricInfo } from "./MetricInfo";
import { ChartTooltip, anchorFromEvent, type TooltipAnchor } from "./ChartTooltip";
import { formatCompactUsd } from "@/lib/format";
import type { SeriesPoint } from "@/lib/data/metricSnapshots";
import type { OutboundDisclosure } from "@/lib/metrics/outboundDisclosure";

/**
 * Platform economics — gacha FLOWS: what players spent on pulls, and what left
 * the platform's gacha wallets.
 *
 * ⚠️ FLOWS ONLY — no net figure, no net line, no subtraction anywhere in this
 * component. `PlatformDetail.netGachaRevenue` exists on the contract and is
 * deliberately NOT read here: outflow currently EXCEEDS gacha spend on both
 * covered platforms, which means the two sides are not measuring the same
 * population of transactions. Publishing spend − outflow before that
 * filter-symmetry reconciliation lands would print a confidently wrong "what the
 * house kept". Until then the honest thing is to show each flow on its own and
 * let the ratio speak. Do not add a net row back without the backend fix.
 *
 * ⚠️ THE OUTBOUND LEG IS NOT "PAYOUTS TO PLAYERS". It is gross outbound USDC
 * from the gacha wallets — correctly measured as a flow, but it carries partner,
 * vendor and internal transfers that we cannot yet split out. Hence two
 * disclosure states, decided per platform by `outboundDisclosureFor` and NOT by
 * this component (see docs/roadmap/net-gacha-reconciliation.md §5):
 *
 *   "gross"      → render the flow under a label that says what it is. CC's
 *                  exclusion list already removes its largest counterparties, so
 *                  the residual has a plausible player shape (§3c).
 *   "suppressed" → render NOTHING on the outbound side: no flow row, no rate, no
 *                  bar, no tooltip line. Phygitals' exclusion list misses its
 *                  dominant non-player counterparties, so its 102.9% "rate" is an
 *                  artifact of that omission (§3d). Spend comes off a separate
 *                  query and is untouched, so the panel stays — spend-only, with
 *                  a note saying the outbound side is held rather than zero.
 *
 * Both series arrive ALREADY completeness-gated by the page (same cutoff for
 * both, so a Dune-lagged trailing day can't draw a tall spend bar next to a
 * missing outflow bar and read as a windfall).
 */

/** Rolling-window sums, computed server-side with the canonical
 *  `sumLastCompleteDays`. NaN = the window isn't fully covered → renders "—". */
export type EconomicsKpis = {
  spend24h: number;
  spend7d: number;
  spend30d: number;
  buyback24h: number;
  buyback7d: number;
  buyback30d: number;
};

const SPEND_COLOR = "var(--color-yellow)";
const BUYBACK_COLOR = "var(--color-blue)";
const NET_COLOR = "var(--color-ink)";
const PLOT_H = 190;

/** Rolling net over the three windows, from `PlatformDetail.netGachaRevenue`.
 *  null = held; the panel then draws no net anywhere. */
export type NetKpis = { usd24h: number; usd7d: number; usd30d: number };

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (ts: string) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
};
/** A window that isn't fully covered sums to NaN — say so, never print $0. */
const money = (n: number) => (Number.isFinite(n) ? formatCompactUsd(n) : "—");
/** Signed money. formatCompactUsd renders a negative as "$-980K"; net goes
 *  negative often enough that the sign belongs in front of the unit. */
const signedMoney = (n: number) =>
  !Number.isFinite(n) ? "—" : n < 0 ? `−${formatCompactUsd(Math.abs(n))}` : formatCompactUsd(n);

type Day = { ts: string; spend: number | null; buyback: number | null };

/** Union of both series by day, oldest → newest. A day only one side reported
 *  keeps `null` on the other — drawn as a missing bar, never as a zero. */
function toDays(spend: SeriesPoint[], buyback: SeriesPoint[]): Day[] {
  const byTs = new Map<string, Day>();
  const put = (pts: SeriesPoint[], k: "spend" | "buyback") => {
    for (const p of pts) {
      if (!Number.isFinite(p.value)) continue;
      const row = byTs.get(p.ts) ?? { ts: p.ts, spend: null, buyback: null };
      row[k] = p.value;
      byTs.set(p.ts, row);
    }
  };
  put(spend, "spend");
  put(buyback, "buyback");
  return [...byTs.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

export function PlatformEconomics({
  spendDaily,
  buybackDaily,
  kpis,
  buybackRatePct30d,
  outboundDisclosure,
  net,
  netDaily,
  r3VerifiedPct30d,
}: {
  /** Daily gacha spend (gacha_volume_usd), completeness-gated by the page. */
  spendDaily: SeriesPoint[];
  /** Daily GROSS gacha-wallet outflow — every outflow bar the internal-wallet
   *  list. This is what the bars and the "Outbound … (gross)" row show. Empty
   *  means the platform has no known buyback wallet and the page renders nothing.
   *  ⚠️ NOT the R3 payout series; net is not derivable from it. */
  buybackDaily: SeriesPoint[];
  /** Daily net (spend − R3-counted payouts), pre-joined by the page. Empty when
   *  net is held. Passed rather than derived because the two outbound quantities
   *  differ — see the note beside `netByDay`. */
  netDaily: SeriesPoint[];
  kpis: EconomicsKpis;
  /** PlatformDetail.buybackRatePct30d — outflow ÷ spend over 30 complete days. */
  buybackRatePct30d: number | null;
  /** Display policy for the outbound leg — see the header note. "suppressed"
   *  drops every outbound mark; it never changes a number. */
  outboundDisclosure: OutboundDisclosure;
  /** PlatformDetail.netGachaRevenue. NULL = held, and the panel then draws no net
   *  KPI and no net line. fetchPlatform owns that decision — a null here can mean
   *  the platform is unsourced, held for reconciliation, or simply not yet on the
   *  R3 basis, and none of those may render a number. */
  net: NetKpis | null;
  /** PlatformDetail.r3VerifiedPct30d — the share of gross outbound that R3
   *  verifies as reaching a wallet which has spent in. Cited in the rate's ⓘ. */
  r3VerifiedPct30d: number | null;
}) {
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  // Suppression is total: the outbound series never reaches `toDays`, so there is
  // no bar to draw, no day contributed by an outflow-only date, and no way for a
  // withheld figure to leak through the tooltip.
  const held = outboundDisclosure === "suppressed";
  const days = toDays(spendDaily, held ? [] : buybackDaily);
  if (!days.length) return null;

  const max = Math.max(
    1,
    ...days.map((d) => Math.max(Number.isFinite(d.spend ?? NaN) ? d.spend! : 0, Number.isFinite(d.buyback ?? NaN) ? d.buyback! : 0)),
  );
  const active = hover != null ? days[hover] ?? null : null;

  // Net is drawn only where fetchPlatform published one, and it comes in as its
  // OWN series rather than being re-derived from the bars: the blue bars are
  // GROSS outflow while net is spend minus R3-COUNTED payouts, so subtracting
  // what is drawn would quietly overstate the margin. A day the page could not
  // pair gets `null` and the line BREAKS there.
  const showNet = net != null && !held;
  const netAt = new Map(netDaily.map((p) => [p.ts, p.value]));
  const netByDay = showNet
    ? days.map((d) => {
        const v = netAt.get(d.ts);
        return v == null || !Number.isFinite(v) ? null : v;
      })
    : [];
  // A daily net goes negative whenever cash-outs of EARLIER pulls outrun fresh
  // spend — a real reading, not an error. So the plot needs a signed domain, and
  // the bars have to sit on the zero line rather than on the floor.
  const netLo = Math.min(0, ...netByDay.filter((v): v is number => v != null));
  const lo = showNet ? netLo : 0;
  const span = max - lo || 1;
  /** Height of the zero rule above the plot floor, as a fraction. */
  const zeroFrac = (0 - lo) / span;

  return (
    <Section
      title="Platform economics"
      readMe="gross flows through the gacha wallets — spend in, buybacks out. the gap is the gacha margin."
      subtitle={
        held
          ? "Gacha pull spend · last 30 complete days"
          : "Gacha spend vs gross outbound · flows, not profit · last 30 complete days"
      }
      flush
      className="font-sans"
    >
      <div className="px-4 pb-4 pt-1 sm:px-5 sm:pb-5">
        {/* KPI rows — each flow on its own line, across the three windows. */}
        <div className="mb-4 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-3">
                <th className="py-1.5 text-left font-medium">Flow</th>
                <th className="py-1.5 text-right font-medium">24h</th>
                <th className="py-1.5 text-right font-medium">7d</th>
                <th className="py-1.5 text-right font-medium">30d</th>
              </tr>
            </thead>
            <tbody>
              <FlowRow
                color={SPEND_COLOR}
                label={<MetricInfo metric="gacha">Gacha spend</MetricInfo>}
                a={kpis.spend24h}
                b={kpis.spend7d}
                c={kpis.spend30d}
              />
              {!held && (
                <FlowRow
                  color={BUYBACK_COLOR}
                  label={
                    <MetricInfo metric="grossOutbound">
                      Outbound to players &amp; partners (gross)
                    </MetricInfo>
                  }
                  a={kpis.buyback24h}
                  b={kpis.buyback7d}
                  c={kpis.buyback30d}
                />
              )}
            </tbody>
          </table>
        </div>

        {/* Buyback rate — a ratio of the two flows above, never a difference. The
            caption says "flowing back out", not "paid back to players": the
            numerator is gross outbound and a share of it is not player money. */}
        {!held && (
          <div className="mb-4 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-y border-line/60 py-2.5">
            <span className="text-[11px] uppercase tracking-[0.06em] text-ink-3">
              <MetricInfo metric="buybackRate">Buyback rate</MetricInfo>
            </span>
            <span className="font-mono text-[15px] font-bold tabular text-ink">
              {buybackRatePct30d != null ? `${buybackRatePct30d.toFixed(1)}%` : "—"}
            </span>
            <span className="text-[11.5px] text-ink-3">of pull spend flowing back out · 30d</span>
            {/* The R3 evidence, stated as a measured share rather than a claim.
                Rendered only where we actually have the number — an unqualified
                "R3-verified" with nothing behind it is the failure mode here. */}
            {r3VerifiedPct30d != null && (
              <span className="ml-auto shrink-0 rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em] text-ink-4">
                R3-verified{" "}
                <span className="tabular text-ink-2">{r3VerifiedPct30d.toFixed(1)}%</span>
              </span>
            )}
          </div>
        )}

        {/* Net gacha revenue — the margin, un-held for platforms whose payout leg
            passes R3 (Addendum A §A7). Rendered ONLY where fetchPlatform published
            a figure; a held platform shows no net row at all rather than dashes,
            which would read as "we looked and it was nothing". */}
        {showNet && (
          <div className="mb-4 grid grid-cols-3 gap-x-4 gap-y-2 border-b border-line/60 pb-3">
            {([["24h", net.usd24h], ["7d", net.usd7d], ["30d", net.usd30d]] as const).map(
              ([w, v]) => (
                <div key={w}>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-3">
                      <MetricInfo metric="netGachaRevenue">Net gacha revenue</MetricInfo>
                    </span>
                    <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.04em] text-ink-4">
                      {w}
                    </span>
                  </div>
                  <div
                    className={`mt-1 font-mono text-[17px] font-bold leading-none tabular ${
                      Number.isFinite(v) && v < 0 ? "text-red" : "text-ink"
                    }`}
                  >
                    {signedMoney(v)}
                  </div>
                </div>
              ),
            )}
            {/* The net line's own definition, stated where the net number is —
                "the gap" in the section read-me is not self-explanatory once a
                reader asks WHICH payouts were subtracted. R3 = a payout counts
                only if the recipient also spent into the gacha. */}
            <ReadMe className="col-span-3">
              net = canonical spend − payouts to player wallets (rule R3)
            </ReadMe>
          </div>
        )}

        {/* Grouped daily bars: spend and outbound side by side, with net as a line
            when it is published. A held platform draws the spend bar alone, at
            full cell width. Bars grow from the ZERO rule, which only sits on the
            plot floor while nothing goes negative. */}
        <div className="relative" style={{ height: PLOT_H }} onMouseLeave={() => { setHover(null); setAnchor(null); }}>
          {[0, 0.5, 1].map((f) => (
            <div key={f} className="pointer-events-none absolute inset-x-0 flex items-center" style={{ bottom: `${(zeroFrac + f * (1 - zeroFrac)) * 100}%` }}>
              <span className="h-px w-full bg-line/40" />
              <span className="ml-1.5 shrink-0 font-mono text-[9.5px] leading-none text-ink-4">{formatCompactUsd(max * f)}</span>
            </div>
          ))}
          {/* The zero rule, drawn only when the axis actually crosses it — a
              dashed baseline under a chart that never goes negative is noise. */}
          {zeroFrac > 0 && (
            <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line-2" style={{ bottom: `${zeroFrac * 100}%` }} />
          )}
          <div className="absolute inset-x-0 top-0 flex items-end gap-[2px]" style={{ bottom: `${zeroFrac * 100}%` }}>
            {days.map((d, i) => (
              <div
                key={d.ts}
                className="flex h-full min-w-0 flex-1 items-end gap-[1px]"
                onMouseEnter={(e) => { setHover(i); setAnchor(anchorFromEvent(e)); }}
                onMouseMove={(e) => setAnchor(anchorFromEvent(e))}
                style={{ opacity: hover == null || hover === i ? 1 : 0.45 }}
              >
                <Bar value={d.spend} max={max} color={SPEND_COLOR} />
                {!held && <Bar value={d.buyback} max={max} color={BUYBACK_COLOR} />}
              </div>
            ))}
          </div>
          {showNet && <NetLine nets={netByDay} lo={lo} span={span} />}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-3">
          <Key color={SPEND_COLOR} label="Gacha spend" />
          {!held && <Key color={BUYBACK_COLOR} label="Outbound (gross)" />}
          {showNet && <Key color={NET_COLOR} label="Net gacha revenue" line />}
          <span className="ml-auto font-mono text-[10.5px] text-ink-4">
            {days.length > 0 ? `${fmtDay(days[0].ts)} – ${fmtDay(days[days.length - 1].ts)}` : ""}
          </span>
        </div>

        {held && (
          <p className="mt-2.5 border-t border-line/60 pt-2.5 text-[11px] leading-snug text-ink-4">
            Outbound flows under reconciliation — payout and rate figures are withheld
            for this platform, not zero. Pull spend is unaffected.
          </p>
        )}

        {active && (
          <ChartTooltip anchor={anchor}>
            <div className="mb-1 text-[10px] uppercase tracking-[0.06em] text-ink-3">{fmtDay(active.ts)}</div>
            <TipRow color={SPEND_COLOR} label="Spend" value={active.spend} />
            {!held && <TipRow color={BUYBACK_COLOR} label="Outbound" value={active.buyback} />}
            {showNet && hover != null && (
              <TipRow color={NET_COLOR} label="Net" value={netByDay[hover] ?? null} signed />
            )}
          </ChartTooltip>
        )}
      </div>
    </Section>
  );
}

/**
 * Net (spend − R3 payouts) as a line over the bars.
 *
 * One SVG spanning the whole plot with `preserveAspectRatio="none"`, so the
 * line's zero and the bars' baseline are the same pixel by construction rather
 * than by two calculations agreeing. Drawn in runs of CONSECUTIVE measured days:
 * a gap in either series is a gap in the line, because bridging it would assert a
 * margin across days we never measured a payout for.
 */
function NetLine({ nets, lo, span }: { nets: (number | null)[]; lo: number; span: number }) {
  const n = nets.length;
  const x = (i: number) => i + 0.5;
  const y = (v: number) => (lo + span - v) / span;

  const runs: string[] = [];
  let cur: string[] = [];
  nets.forEach((v, i) => {
    if (v == null) {
      if (cur.length) runs.push(cur.join(" "));
      cur = [];
      return;
    }
    cur.push(`${cur.length ? "L" : "M"}${x(i)},${y(v)}`);
  });
  if (cur.length) runs.push(cur.join(" "));

  // A run of one has no line to draw — dot it, or that day's net is invisible.
  const singles = nets
    .map((v, i) => ({ v, i }))
    .filter(({ v, i }) => v != null && nets[i - 1] == null && nets[i + 1] == null);

  return (
    <svg
      viewBox={`0 0 ${n} 1`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      {runs.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={NET_COLOR} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      ))}
      {singles.map(({ v, i }) => (
        <circle key={i} cx={x(i)} cy={y(v as number)} r={2} fill={NET_COLOR} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

function Bar({ value, max, color }: { value: number | null; max: number; color: string }) {
  // A day the series never reported draws nothing at all — an absent payout is
  // not a zero payout, and a 0-height bar would read as one.
  if (value == null || !Number.isFinite(value)) return <div className="min-w-0 flex-1" />;
  return (
    <div
      className="min-w-0 flex-1 rounded-t-[2px]"
      style={{ height: `${Math.max(0, (value / max) * 100)}%`, background: color }}
    />
  );
}

function FlowRow({ color, label, a, b, c }: { color: string; label: React.ReactNode; a: number; b: number; c: number }) {
  return (
    <tr className="border-b border-line/50 last:border-b-0">
      <td className="py-1.5">
        <span className="flex items-center gap-1.5 text-ink-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
          {label}
        </span>
      </td>
      <td className="py-1.5 text-right font-mono tabular text-ink">{money(a)}</td>
      <td className="py-1.5 text-right font-mono tabular text-ink">{money(b)}</td>
      <td className="py-1.5 text-right font-mono tabular text-ink">{money(c)}</td>
    </tr>
  );
}

function Key({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={line ? "h-[2px] w-3.5 shrink-0" : "h-2.5 w-2.5 shrink-0 rounded-sm"}
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

function TipRow({
  color,
  label,
  value,
  signed,
}: {
  color: string;
  label: string;
  value: number | null;
  signed?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-[1px]">
      <span className="flex items-center gap-1.5 text-ink-2">
        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: color }} />
        {label}
      </span>
      <span className="font-mono tabular text-ink">
        {value == null ? "no reading" : signed ? signedMoney(value) : formatCompactUsd(value)}
      </span>
    </div>
  );
}
