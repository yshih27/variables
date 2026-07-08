import type { CardSalePoint, CardSalesHistory } from "@/lib/data/cardSales";
import { formatCompactUsd } from "@/lib/format";

/**
 * Card price history v1 (F9-3) — sparse-honest realized-sale chart: a step line
 * (price holds until the next sale) with an observation dot per sale, plus an
 * "N sales" caption and the feed's coverage window + "as of". Renders honest
 * states for 0 / 1 / few points rather than faking a dense curve, and a distinct
 * "no feed" state for platforms without a secondary feed (Phygitals). Pure
 * server component: static SVG + native <title> tooltips, no client JS. Consumes
 * the B9-4 `getCardSales` reader (CardSalesHistory).
 */
const VB_W = 720;
const VB_H = 200;
const PAD = { l: 6, r: 6, t: 16, b: 16 };

function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function CardPriceHistory({ history }: { history: CardSalesHistory }) {
  const pts = [...(history.sales ?? [])]
    .filter((s) => s && Number.isFinite(s.priceUsd) && s.priceUsd > 0 && !!s.ts)
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));

  const n = pts.length;
  const noFeed = history.source == null;
  const windowLabel = history.windowDays == null ? "full history" : `${history.windowDays}d window`;
  const caption = noFeed
    ? "No secondary feed"
    : `${n} recorded ${n === 1 ? "sale" : "sales"} · ${windowLabel}`;

  return (
    <section className="mt-14">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[20px] font-semibold tracking-[-0.005em]">Price history</h2>
        <span className="text-[12px] text-ink-3">{caption}</span>
      </div>
      <div className="mt-4 rounded-xl border border-line/60 bg-bg-1 p-4">
        {noFeed ? <NoFeed /> : n === 0 ? <EmptyHistory windowLabel={windowLabel} /> : <Chart pts={pts} />}
      </div>
      {!noFeed && history.source && (
        <p className="mt-2 text-[11px] text-ink-4">
          {history.source}
          {history.asOf ? ` · as of ${fmtDay(history.asOf)}` : ""}
        </p>
      )}
    </section>
  );
}

function NoFeed() {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-center">
      <span className="text-[13px] text-ink-2">Secondary sales aren&apos;t tracked here yet</span>
      <span className="max-w-[440px] text-[12px] leading-relaxed text-ink-3">
        This platform has no row-level resale feed ingested, so realized prices can&apos;t be charted yet.
      </span>
    </div>
  );
}

function EmptyHistory({ windowLabel }: { windowLabel: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-center">
      <span className="text-[13px] text-ink-2">No sales in the {windowLabel}</span>
      <span className="max-w-[440px] text-[12px] leading-relaxed text-ink-3">
        1-of-1 slabs trade rarely. This card&apos;s realized sales will chart here as they land.
      </span>
    </div>
  );
}

function Chart({ pts }: { pts: CardSalePoint[] }) {
  const prices = pts.map((p) => p.priceUsd);
  const times = pts.map((p) => Date.parse(p.ts));
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const lastP = pts[pts.length - 1].priceUsd;

  // Padded price domain — 12% headroom, and a flat (single-level) series gets an
  // artificial band so its dot sits mid-height instead of on an edge.
  const span = maxP - minP;
  const padY = span > 0 ? span * 0.12 : Math.max(1, maxP * 0.05);
  const lo = minP - padY;
  const hi = maxP + padY;

  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const spanT = maxT - minT;

  const innerW = VB_W - PAD.l - PAD.r;
  const innerH = VB_H - PAD.t - PAD.b;
  const xOf = (t: number) => (spanT > 0 ? PAD.l + ((t - minT) / spanT) * innerW : PAD.l + innerW / 2);
  const yOf = (p: number) => PAD.t + (1 - (p - lo) / (hi - lo)) * innerH;

  const xy = pts.map((p, i) => ({ cx: xOf(times[i]), cy: yOf(p.priceUsd), p }));

  // Step path: hold the previous price, then jump vertically at each new sale.
  let d = "";
  xy.forEach((pt, i) => {
    if (i === 0) d += `M ${pt.cx.toFixed(1)} ${pt.cy.toFixed(1)}`;
    else {
      const prev = xy[i - 1];
      d += ` L ${pt.cx.toFixed(1)} ${prev.cy.toFixed(1)} L ${pt.cx.toFixed(1)} ${pt.cy.toFixed(1)}`;
    }
  });

  const yHi = yOf(maxP);
  const yLo = yOf(minP);

  return (
    <>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Price history: ${pts.length} sales ranging ${formatCompactUsd(minP)} to ${formatCompactUsd(maxP)}`}
      >
        {/* faint high/low guides */}
        <line x1={PAD.l} x2={VB_W - PAD.r} y1={yHi} y2={yHi} stroke="var(--color-line)" strokeWidth={1} strokeDasharray="3 4" />
        {span > 0 && (
          <line x1={PAD.l} x2={VB_W - PAD.r} y1={yLo} y2={yLo} stroke="var(--color-line)" strokeWidth={1} strokeDasharray="3 4" />
        )}

        {/* step line — only meaningful with 2+ observations */}
        {pts.length >= 2 && (
          <path d={d} fill="none" stroke="var(--color-yellow)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* observation dots (native tooltip = date · price) */}
        {xy.map((pt, i) => (
          <circle key={i} cx={pt.cx} cy={pt.cy} r={3.5} fill="var(--color-bg-1)" stroke="var(--color-yellow)" strokeWidth={2}>
            <title>{`${fmtDay(pt.p.ts)} · ${formatCompactUsd(pt.p.priceUsd)}`}</title>
          </circle>
        ))}

        {/* price extents */}
        <text x={PAD.l} y={yHi - 4} className="tabular" fill="var(--color-ink-3)" fontSize={11}>
          {formatCompactUsd(maxP)}
        </text>
        {span > 0 && (
          <text x={PAD.l} y={yLo + 13} className="tabular" fill="var(--color-ink-3)" fontSize={11}>
            {formatCompactUsd(minP)}
          </text>
        )}
      </svg>

      <div className="mt-2 flex items-center justify-between text-[11px] text-ink-3">
        <span>{fmtDay(pts[0].ts)}</span>
        <span className="tabular text-ink-2">Last {formatCompactUsd(lastP)}</span>
        <span>{fmtDay(pts[pts.length - 1].ts)}</span>
      </div>
    </>
  );
}
