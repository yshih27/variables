"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Section } from "../Section";
import { ChartActions } from "../ChartActions";
import { ChartTooltip, anchorFromEvent, type TooltipAnchor } from "../ChartTooltip";
import type { IdentityMonthly, IdentitySale } from "@/lib/data/identityDetail";
import { formatCompactUsd } from "@/lib/format";
import { venueColor } from "@/lib/data/platformSeries";
import { cardHref } from "@/lib/card/ids";
import { dayLong, monthLong, monthShort, venueName } from "@/lib/card/identityView";
import { monthStartUtc } from "@/lib/chart/period";

/**
 * The hero — what this exact card clears for.
 *
 * Every realised sale of the identity, across every venue and every slab, as a
 * dot on a time axis coloured by venue; over it the identity's MONTHLY PRICE as
 * a stepped line — the index's own per-identity median, held across each month
 * it was priced in and carrying that month's `n`.
 *
 * ⚠️ A MONTH WITH NO PRICE IS A GAP, NEVER A BRIDGE. The step is drawn only
 * across months present in `monthly` (n ≥ MIN_SALES_PER_IDENTITY); two priced
 * months with an unpriced one between them are two separate steps with nothing
 * joining them. A line across the gap would be a price nobody observed.
 *
 * ⚠️ THE RUNNING MONTH IS A HOLLOW POINT, NOT A NUMBER. `monthly` arrives with
 * the running month flagged `partial`. It is drawn hollow at its month end,
 * dashed back to the last complete step, and labelled "Sep · provisional · n
 * sales" — and that label is the whole of what the page says about it: it is
 * not in the CSV, not a tooltip headline, not on the share card.
 *
 * Sales are events, so there is no D/W/M switch. Width is measured (one
 * ResizeObserver) so the dots stay round and the export is drawn at the on-screen
 * width in real pixels rather than a stretched viewBox.
 */

const H = 280;
const PAD = { l: 56, r: 18, t: 16, b: 26 };
const DAY = 86_400_000;

const TITLE = "Realized sales";
const READ_ME = "every realized sale, one card, one grade";

type Hover =
  | { kind: "sale"; sale: IdentitySale; at: TooltipAnchor }
  | { kind: "month"; month: IdentityMonthly; at: TooltipAnchor }
  | { kind: "partial"; month: IdentityMonthly; at: TooltipAnchor };

/** The month end an identity price is stamped on → that month's start. */
const startOfStamp = (monthEndIso: string) => Date.parse(monthStartUtc(Date.parse(monthEndIso)));

export function IdentitySalesChart({
  sales,
  monthly,
  title,
  slug,
}: {
  sales: IdentitySale[];
  monthly: IdentityMonthly[];
  /** "Charizard Ex · PSA 10" — names the export. */
  title: string;
  slug: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [w, setW] = useState(860);
  const [hover, setHover] = useState<Hover | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => {
      for (const e of es) setW(Math.max(280, Math.round(e.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const model = useMemo(() => {
    const pts = sales.filter((s) => Number.isFinite(s.priceUsd) && s.priceUsd > 0 && Number.isFinite(Date.parse(s.ts)));
    if (!pts.length) return null;
    const complete = monthly.filter((m) => !m.partial);
    const partial = monthly.find((m) => m.partial) ?? null;

    // Domain — every sale, every priced month (the running one included so its
    // hollow point has a place), with a little air on each side.
    const times = pts.map((s) => Date.parse(s.ts));
    const t0raw = Math.min(...times, ...complete.map((m) => startOfStamp(m.ts)));
    const t1raw = Math.max(...times, ...complete.map((m) => Date.parse(m.ts)), partial ? Date.parse(partial.ts) : 0);
    const spanT = Math.max(t1raw - t0raw, 14 * DAY);
    const t0 = t0raw - spanT * 0.03;
    const t1 = t1raw + spanT * 0.03;
    const prices = [...pts.map((s) => s.priceUsd), ...monthly.map((m) => m.value)];
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const spanP = maxP - minP;
    const padP = spanP > 0 ? spanP * 0.14 : Math.max(1, maxP * 0.12);
    const lo = Math.max(0, minP - padP);
    const hi = maxP + padP;

    const innerW = w - PAD.l - PAD.r;
    const innerH = H - PAD.t - PAD.b;
    const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * innerW;
    const y = (p: number) => PAD.t + (1 - (p - lo) / (hi - lo)) * innerH;

    // Steps: one per priced complete month, from its start to its end. Two
    // consecutive months join with a riser; a missing month leaves the gap.
    const steps = complete.map((m) => {
      const s = startOfStamp(m.ts);
      const e = Date.parse(m.ts);
      return { m, x0: x(s), x1: x(e), y: y(m.value), s, e };
    });
    const risers: { x: number; y0: number; y1: number }[] = [];
    for (let i = 1; i < steps.length; i++) {
      const a = steps[i - 1], b = steps[i];
      const adjacent = b.s - a.e <= DAY; // next calendar month, never "next published month"
      if (adjacent) risers.push({ x: b.x0, y0: a.y, y1: b.y });
    }
    const prov = partial ? { m: partial, x: x(Date.parse(partial.ts)), y: y(partial.value) } : null;
    const lastStep = steps.at(-1) ?? null;

    // Y ticks: three round values inside the domain.
    const nice = (v: number) => { const p = 10 ** Math.floor(Math.log10(Math.max(v, 1))); const f = v / p; const m = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10; return m * p; };
    const stepV = nice((hi - lo) / 3);
    const ticks: number[] = [];
    for (let v = Math.ceil(lo / stepV) * stepV; v <= hi; v += stepV) ticks.push(v);

    // X ticks: month starts across the domain, thinned to ~8.
    const months: number[] = [];
    for (let t = Date.parse(monthStartUtc(t0)); t <= t1; t = Date.parse(monthStartUtc(t + 32 * DAY))) if (t >= t0) months.push(t);
    const every = Math.max(1, Math.ceil(months.length / 8));
    const xTicks = months.filter((_, i) => i % every === 0);

    const venues = [...new Set(pts.map((s) => s.platform))];
    const dots = pts.map((s) => ({ s, cx: x(Date.parse(s.ts)), cy: y(s.priceUsd) }));
    return { pts, complete, partial, steps, risers, prov, lastStep, ticks, xTicks, venues, dots, x, y, innerH, first: t0raw, last: t1raw };
  }, [sales, monthly, w]);

  const exportRows = useMemo(() => {
    if (!model) return null;
    return {
      columns: ["kind", "date", "price_usd", "venue", "slab", "sales_in_month"],
      rows: [
        ...model.pts.map((s) => ["sale", s.ts.slice(0, 10), Number(s.priceUsd.toFixed(2)), s.platform, cardHref(s.platform, s.tokenId).replace(/^\/card\//, ""), null]),
        // Complete months only — the running month is provisional and stays off every artefact.
        ...model.complete.map((m) => ["monthly", m.ts.slice(0, 10), Number(m.value.toFixed(2)), null, null, m.n]),
      ],
    };
  }, [model]);

  if (!model) {
    // The card page's empty pattern: the frame stays, the reason is stated, no
    // fake axis behind it.
    return (
      <Section title={TITLE} readMe={READ_ME}>
        <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-center">
          <span className="text-[13px] text-ink-2">No sale in the panel</span>
          <span className="max-w-[440px] text-[12px] leading-relaxed text-ink-3">
            The slabs are tracked; this card&apos;s realized sales will chart here as they clear.
          </span>
        </div>
      </Section>
    );
  }

  const nMonths = model.complete.length;
  const legend = [
    ...model.venues.map((v) => ({ color: venueColor(v), text: `${venueName(v)} sale` })),
    ...(nMonths ? [{ color: "var(--color-yellow)", text: "monthly price (n = sales)" }] : []),
  ];

  return (
    <Section
      title={TITLE}
      readMe={READ_ME}
      subtitle={`${model.pts.length} sale${model.pts.length === 1 ? "" : "s"} · ${model.venues.length} venue${model.venues.length === 1 ? "" : "s"} · ${nMonths} priced month${nMonths === 1 ? "" : "s"} · since ${monthLong(model.pts[0].ts)}`}
      right={
        <ChartActions
          meta={{
            title: `${title} — realized sales`,
            readMe: READ_ME,
            unit: "USD",
            window: `${model.pts.length} sales · ${nMonths} complete months`,
            asOf: model.pts.at(-1)?.ts ?? null,
            slug: `identity-${slug.replace(/[^a-z0-9]+/gi, "-")}`,
          }}
          rows={exportRows ?? undefined}
          svgRef={svgRef}
          plotHeight={H}
          legend={legend}
        />
      }
    >
      <div ref={wrapRef} className="relative w-full" style={{ height: H }} onMouseLeave={() => setHover(null)}>
        <svg ref={svgRef} width={w} height={H} className="block" role="img" aria-label={`${model.pts.length} realized sales with the monthly identity price`}>
          {model.ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={w - PAD.r} y1={model.y(v)} y2={model.y(v)} stroke="var(--color-line)" strokeWidth={1} />
              <text x={PAD.l - 6} y={model.y(v) + 3} textAnchor="end" fontSize={9.5} fill="var(--color-ink-4)" fontFamily="var(--font-jetbrains-mono), monospace">
                {formatCompactUsd(v)}
              </text>
            </g>
          ))}
          {model.xTicks.map((t) => (
            <text key={t} x={model.x(t)} y={H - 8} textAnchor="middle" fontSize={9.5} fill="var(--color-ink-4)" fontFamily="var(--font-jetbrains-mono), monospace">
              {monthShort(new Date(t).toISOString())}
              {new Date(t).getUTCMonth() === 0 ? ` ${new Date(t).getUTCFullYear()}` : ""}
            </text>
          ))}

          {/* the monthly identity price — one step per priced month */}
          {model.risers.map((r, i) => (
            <line key={`r${i}`} x1={r.x} x2={r.x} y1={r.y0} y2={r.y1} stroke="var(--color-yellow)" strokeWidth={2} />
          ))}
          {model.steps.map((st) => (
            <g key={st.m.ts}>
              <line
                x1={st.x0} x2={st.x1} y1={st.y} y2={st.y}
                stroke="var(--color-yellow)" strokeWidth={2} strokeLinecap="round"
                className="cursor-default"
                onMouseMove={(e) => setHover({ kind: "month", month: st.m, at: anchorFromEvent(e) })}
              />
              <circle cx={st.x1} cy={st.y} r={3} fill="var(--color-yellow)" />
              <text x={st.x1} y={st.y - 7} textAnchor="end" fontSize={9.5} fill="var(--color-yellow)" fontFamily="var(--font-jetbrains-mono), monospace">
                {monthShort(st.m.ts)} · n={st.m.n}
              </text>
            </g>
          ))}
          {/* the running month — hollow, dashed back, named as provisional */}
          {model.prov && (
            <g>
              {model.lastStep && (
                <line x1={model.lastStep.x1} y1={model.lastStep.y} x2={model.prov.x} y2={model.prov.y} stroke="var(--color-yellow)" strokeWidth={1.25} strokeDasharray="3 4" opacity={0.7} />
              )}
              <circle
                cx={model.prov.x} cy={model.prov.y} r={4}
                fill="var(--color-bg-1)" stroke="var(--color-yellow)" strokeWidth={1.5} strokeDasharray="2 2"
                onMouseMove={(e) => setHover({ kind: "partial", month: model.prov!.m, at: anchorFromEvent(e) })}
              />
              <text x={model.prov.x} y={model.prov.y - 8} textAnchor="end" fontSize={9.5} fill="var(--color-ink-3)" fontFamily="var(--font-jetbrains-mono), monospace">
                {monthShort(model.prov.m.ts)} · provisional · {model.prov.m.n} sale{model.prov.m.n === 1 ? "" : "s"}
              </text>
            </g>
          )}

          {/* every sale, coloured by venue */}
          {model.dots.map((d, i) => (
            <circle
              key={`${d.s.platform}:${d.s.tokenId}:${d.s.ts}:${i}`}
              cx={d.cx} cy={d.cy} r={3.5}
              fill={venueColor(d.s.platform)} stroke="var(--color-bg-1)" strokeWidth={1}
              className="cursor-default"
              onMouseMove={(e) => setHover({ kind: "sale", sale: d.s, at: anchorFromEvent(e) })}
            >
              <title>{`${dayLong(d.s.ts)} · ${formatCompactUsd(d.s.priceUsd)} · ${venueName(d.s.platform)}`}</title>
            </circle>
          ))}
        </svg>

        <ChartTooltip anchor={hover?.at ?? null} width={200}>
          {hover?.kind === "sale" && (
            <>
              <div className="font-semibold tabular text-ink">{formatCompactUsd(hover.sale.priceUsd)}</div>
              <div className="text-ink-3">{dayLong(hover.sale.ts)} · {venueName(hover.sale.platform)}</div>
              <div className="text-ink-4">one slab, one clear</div>
            </>
          )}
          {hover?.kind === "month" && (
            <>
              <div className="font-semibold tabular text-ink">{formatCompactUsd(hover.month.value)}</div>
              <div className="text-ink-3">{monthLong(hover.month.ts)} · {hover.month.n} sales</div>
              <div className="text-ink-4">monthly identity price · the index&apos;s median</div>
            </>
          )}
          {hover?.kind === "partial" && (
            // ⚠️ No number in the headline: the month is still filling.
            <>
              <div className="font-semibold text-ink">{monthShort(hover.month.ts)} · provisional</div>
              <div className="text-ink-3">{hover.month.n} sale{hover.month.n === 1 ? "" : "s"} so far · month in progress</div>
              <div className="text-ink-4">not published until the month ends</div>
            </>
          )}
        </ChartTooltip>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-ink-4">
        {model.venues.map((v) => (
          <span key={v} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: venueColor(v) }} />
            {venueName(v)}
          </span>
        ))}
        {nMonths > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3 bg-yellow" />
            monthly price · n = sales that month · gaps are months under 2 sales
          </span>
        )}
        {model.prov && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full border border-dashed border-yellow" />
            running month, provisional — drawn, never published
          </span>
        )}
      </div>
    </Section>
  );
}
