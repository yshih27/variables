import type { MarketPosition } from "@/lib/data/venueInsights";
import { formatCompactUsd } from "@/lib/format";
import { Section } from "./Section";

/**
 * Where a venue stands among every venue Varible tracks: its share of all pack
 * spend and its rank, per complete month (`venue-insights`, built from the
 * spine's daily pack spend). A venue sees its own volume; only a view across
 * all of them can rank it.
 *
 * ⚠️ NO SPEND IS NO SHARE, NOT ZERO. A month the venue had no pack spend draws
 * an empty column with no rank, and a venue with no pack spend in the whole
 * window renders nothing.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthShort = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
const monthLong = (ym: string) => `${monthShort(ym)} ${ym.slice(0, 4)}`;

export function VenueMarketPosition({
  venueKey,
  venueName,
  market,
}: {
  venueKey: string;
  venueName: string;
  market: MarketPosition | null | undefined;
}) {
  const v = market?.venues[venueKey];
  if (!market || !v || !v.spendUsd.some((x) => x > 0)) return null;
  const last = market.months.length - 1;
  const share = v.sharePct[last];
  const rank = v.rank[last];
  const prev = v.sharePct[last - 1] ?? null;
  const deltaPp = share != null && prev != null ? share - prev : null;
  const maxShare = Math.max(...v.sharePct.map((s) => s ?? 0), 0.0001);

  return (
    <Section
      id="market-position"
      className="scroll-mt-24 font-sans"
      title={`Where ${venueName} stands`}
      readMe="its share of all pack spend across the venues Varible tracks, and its rank, month by month"
      subtitle={`Complete months · ${monthLong(market.months[0])} – ${monthLong(market.months[last])}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-8">
        <div className="shrink-0" data-market-share>
          <div className="font-mono text-[34px] font-bold leading-none tracking-[-0.03em] tabular text-ink">
            {share == null ? "—" : `${share.toFixed(1)}%`}
          </div>
          <div className="mt-2 text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">
            of pack spend in {monthLong(market.months[last])}
          </div>
          <div className="mt-1 font-mono text-[12px] tabular text-ink-2">
            {rank == null ? "no pack spend that month" : `#${rank} of ${market.venueCounts[last]} venues`}
            {deltaPp != null && Math.abs(deltaPp) >= 0.05 ? (
              <span className="text-ink-3">{` · ${deltaPp > 0 ? "+" : "−"}${Math.abs(deltaPp).toFixed(1)} pp vs ${monthShort(market.months[last - 1])}`}</span>
            ) : null}
          </div>
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-12 items-end gap-1.5" role="img" aria-label={`${venueName}'s share of pack spend and rank, by month`}>
          {market.months.map((m, i) => {
            const s = v.sharePct[i];
            const h = s == null ? 0 : Math.max(4, Math.round((s / maxShare) * 96));
            return (
              <div
                key={m}
                className="flex min-w-0 flex-col items-center gap-1"
                title={
                  s == null
                    ? `${monthLong(m)}: no pack spend on ${venueName}`
                    : `${monthLong(m)}: ${formatCompactUsd(v.spendUsd[i])} of ${formatCompactUsd(market.totalsUsd[i])} · ${s.toFixed(1)}% · #${v.rank[i]} of ${market.venueCounts[i]}`
                }
              >
                <span className="font-mono text-[10px] tabular text-ink-3">{v.rank[i] == null ? "—" : `#${v.rank[i]}`}</span>
                <div className="flex h-[96px] w-full items-end">
                  <div className={`w-full ${i === last ? "bg-yellow" : "bg-lime-dim"}`} style={{ height: `${h}px` }} />
                </div>
                <span className="font-mono text-[10px] tabular text-ink-4">{monthShort(m)}</span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-3 font-mono text-[10.5px] leading-snug text-ink-4" data-market-receipt>
        {`${monthLong(market.months[last])}: ${formatCompactUsd(v.spendUsd[last])} of ${formatCompactUsd(market.totalsUsd[last])} pack spend across ${market.venueCounts[last]} venues · each venue's daily pack spend in Varible's series, summed over complete months`}
      </p>
    </Section>
  );
}
