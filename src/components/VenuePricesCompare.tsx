import Link from "next/link";
import type { VenuePriceRow } from "@/lib/data/venuePrices";
import { formatCompactUsd, formatInt } from "@/lib/format";
import { Section } from "./Section";

/**
 * Packs on sale, venue by venue, by price (buildVenuePrices): every venue on one
 * log price axis, a dot per price it sells at, the dot's area its share of the
 * venue's own recent pack spend. A reader sees each venue's range and where its
 * money sits inside it.
 *
 * ⚠️ NO WRITTEN CONCLUSION, AND NO CROSS-VENUE SIZE. A dot's size compares prices
 * within its own row only (each venue's window differs), which the receipt and
 * each row's window label say. A price with little or no spend keeps a small dot:
 * it is on sale. Unweighted rows (no pull counts) draw hollow dots.
 */
const DOT = "var(--color-yellow)";
const MAX_D = 34;
const MIN_D = 5;
const ROW_H = 40;

/** Axis labels: "$1", "$10", "$1K", "$5K" — whole numbers, no "$1.0K". */
const tickLabel = (t: number) => (t >= 1000 ? `$${t / 1000}K` : `$${t}`);
const winLabel = (r: VenuePriceRow) => (r.window === "7d" ? "7 days" : r.window === "24h" ? (r.estimated ? "24h, est." : "24h") : "prices only");

export function VenuePricesCompare({
  rows,
  names,
  highlight,
}: {
  rows: VenuePriceRow[] | null | undefined;
  names: Record<string, string>;
  highlight?: string;
}) {
  if (!rows?.length) return null;
  const prices = rows.flatMap((r) => r.points.map((p) => p.priceUsd));
  const lo = Math.pow(10, Math.floor(Math.log10(Math.min(...prices))));
  const hi = Math.max(...prices);
  const x = (p: number) => ((Math.log10(p) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * 100;
  const ticks = [1, 10, 100, 1000, 10000].filter((t) => t >= lo && t <= hi).concat(hi % 1000 === 0 && hi > 1000 && hi < 10000 ? [hi] : []);
  const unweighted = rows.filter((r) => r.window == null).map((r) => names[r.venue] ?? r.venue);
  // Venues the page knows that the catalog does not carry: named, never drawn as empty.
  const absent = Object.keys(names).filter((k) => !rows.some((r) => r.venue === k)).map((k) => names[k]);

  return (
    <Section
      id="packs-by-price-venues"
      className="scroll-mt-24 font-sans"
      title="Packs on sale, venue by venue"
      readMe="what each venue sells at what price, and where its money goes"
      subtitle="Every pack, box, machine and claw in the catalog · dot size = share of that venue's own pack spend"
      flush
    >
      <div className="px-4 pb-2 pt-1 sm:px-5">
        <ul data-packs-by-price>
          {rows.map((r) => (
            <li
              key={r.venue}
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-line/60 py-2 md:grid-cols-[150px_minmax(0,1fr)_96px] ${
                r.venue === highlight ? "-mx-2 bg-bg-2/60 px-2" : ""
              }`}
              data-venue={r.venue}
            >
              <Link href={`/platform/${r.venue}`} className={`truncate text-[13px] hover:text-yellow ${r.venue === highlight ? "font-semibold" : ""} text-ink`}>
                {names[r.venue] ?? r.venue}
              </Link>
              <span className="text-right font-mono text-[11px] text-ink-3 md:order-last">{winLabel(r)}</span>
              <div className="relative col-span-2 md:col-span-1" style={{ height: ROW_H }}>
                {ticks.map((t) => (
                  <span key={t} className="absolute inset-y-0 w-px bg-line/60" style={{ left: `${x(t)}%` }} aria-hidden />
                ))}
                {r.points.map((p) => {
                  const d = p.spendSharePct == null ? 9 : Math.max(MIN_D, MAX_D * Math.sqrt(p.spendSharePct / 100));
                  return (
                    <span
                      key={p.priceUsd}
                      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        left: `${x(p.priceUsd)}%`,
                        width: d,
                        height: d,
                        background: p.spendSharePct == null ? "transparent" : DOT,
                        border: p.spendSharePct == null ? `1.5px solid ${DOT}` : undefined,
                        opacity: p.spendSharePct == null ? 0.8 : 0.9,
                        boxShadow: "0 0 0 2px var(--color-bg-1)",
                      }}
                      title={`${formatCompactUsd(p.priceUsd)} · ${p.names.join(", ")}${
                        p.spendSharePct == null ? "" : ` · ${p.spendSharePct.toFixed(1)}% of ${names[r.venue] ?? r.venue}'s pack spend, ${winLabel(r)}${p.pulls != null ? ` · ${formatInt(p.pulls)} pulls` : ""}`
                      }`}
                    />
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
        {/* The shared price axis, under the last row. */}
        <div className="grid grid-cols-1 md:grid-cols-[150px_minmax(0,1fr)_96px] md:gap-x-4">
          <span className="hidden md:block" />
          <div className="relative h-5 font-mono text-[10.5px] text-ink-3">
            {ticks.map((t) => (
              <span key={t} className="absolute top-1 -translate-x-1/2 whitespace-nowrap" style={{ left: `${x(t)}%` }}>
                {tickLabel(t)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="border-t border-line px-4 py-2.5 font-mono text-[10.5px] leading-snug text-ink-4 sm:px-5" data-packs-by-price-receipt>
        {`one dot per price a venue sells packs at; price axis is logarithmic · dot area = that price's share of the venue's own pack spend (its pulls × price) over the window on the right; sizes compare within a row, never across venues · 24h, est. = pulls counted over the hours read, scaled to a day · the smallest dots are prices with little or no spend${unweighted.length ? ` · ${unweighted.join(", ")}: no pull counts, prices only (hollow)` : ""}${absent.length ? ` · not in the pack catalog: ${absent.join(", ")}` : ""} · one-time drops are not listed`}
      </p>
    </Section>
  );
}
