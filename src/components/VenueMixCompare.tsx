import Link from "next/link";
import type { VenueMix, VenueMixRow } from "@/lib/data/venueMix";
import { formatCompactUsd, formatMonthDayUtc } from "@/lib/format";
import { Section } from "./Section";

/**
 * Volume mix, venue by venue (buildVenueMix): one row per venue over the same
 * complete days — its packs-vs-marketplace split, its median day, and every
 * day's split as a strip. The lane colours are the Volume mix chart's own
 * (packs lime, marketplace blue), so the two read the same.
 *
 * ⚠️ NO WRITTEN CONCLUSION. The rows, the median and the strip are the tools; a
 * reader decides what a venue is. The receipt states each definition, and a
 * venue with no marketplace source says so instead of drawing a 0.
 */
const PACKS = "var(--color-yellow)";
const MARKET = "var(--color-blue)";
const STRIP_H = 26;

const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const day = (iso: string) => formatMonthDayUtc(`${iso}T00:00:00Z`) ?? iso;

export function VenueMixCompare({
  mix,
  names,
  highlight,
}: {
  mix: VenueMix | null | undefined;
  /** Venue key → display name. */
  names: Record<string, string>;
  /** On a venue's own page: its row, marked. */
  highlight?: string;
}) {
  if (!mix?.rows.length) return null;
  const noSource = mix.rows.filter((r) => r.marketPct == null).map((r) => names[r.venue] ?? r.venue);

  return (
    <Section
      id="volume-mix-venues"
      className="scroll-mt-24 font-sans"
      title="Volume mix, venue by venue"
      readMe="how each venue's money splits between packs and collectors buying from each other"
      subtitle={`Last ${mix.days} complete days · ${day(mix.from)} – ${day(mix.to)} · by marketplace share`}
      flush
    >
      <div className="px-4 pb-1 pt-1 sm:px-5">
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
          <Swatch color={PACKS} label="Packs, boxes, machines, claws" />
          <Swatch color={MARKET} label="Marketplace: collectors buying from each other" />
        </div>
        <div className="hidden grid-cols-[150px_minmax(0,1fr)_96px_212px] gap-x-4 border-b border-line pb-2 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3 md:grid">
          <span>Venue</span>
          <span>{`${mix.days} days`}</span>
          <span className="text-right">Typical day</span>
          <span>Each day</span>
        </div>
        <ul data-venue-mix>
          {mix.rows.map((r) => (
            <MixRow key={r.venue} row={r} name={names[r.venue] ?? r.venue} marked={r.venue === highlight} />
          ))}
        </ul>
      </div>
      <p className="border-t border-line px-4 py-2.5 font-mono text-[10.5px] leading-snug text-ink-4 sm:px-5" data-venue-mix-receipt>
        {`the same ${mix.days} complete days for every venue · packs = spend on packs, boxes, machines and claws; marketplace = sales between collectors on the venue's own marketplace; direct sales are not included · typical day = the median of the daily shares · each strip bar = one day's marketplace share, full height = 100%${noSource.length ? ` · ${noSource.join(", ")}: no marketplace source` : ""}`}
      </p>
    </Section>
  );
}

function MixRow({ row, name, marked }: { row: VenueMixRow; name: string; marked: boolean }) {
  const m = row.marketPct;
  return (
    <li
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-line/60 py-3 last:border-b-0 md:grid-cols-[150px_minmax(0,1fr)_96px_212px] ${
        marked ? "-mx-2 bg-bg-2/60 px-2" : ""
      }`}
      data-venue={row.venue}
    >
      <Link href={`/platform/${row.venue}`} className={`truncate text-[13px] hover:text-yellow ${marked ? "font-semibold text-ink" : "text-ink"}`}>
        {name}
      </Link>
      {/* The split: packs, then the marketplace share, labelled at the end. */}
      <div className="order-3 col-span-2 flex min-w-0 items-center gap-3 md:order-none md:col-span-1">
        <div
          className="flex h-3 min-w-0 flex-1 gap-[2px] bg-bg-1"
          title={`${name} · packs ${formatCompactUsd(row.packsUsd)}${row.marketUsd != null ? ` · marketplace ${formatCompactUsd(row.marketUsd)}` : " · no marketplace source"}`}
        >
          <span className="h-full" style={{ width: `${m == null ? 100 : 100 - m}%`, background: PACKS }} />
          {m != null && m > 0 ? <span className="h-full" style={{ width: `${m}%`, minWidth: 2, background: MARKET }} /> : null}
        </div>
        <span className="w-[100px] shrink-0 whitespace-nowrap text-right font-mono text-[12px] tabular text-ink">
          {m == null ? <span className="text-ink-4">not measured</span> : pct(m)}
        </span>
      </div>
      <span className="text-right font-mono text-[12px] tabular text-ink-2" title="the median of the daily marketplace shares">
        <span className="mr-1.5 text-[10.5px] text-ink-4 md:hidden">typical day</span>
        {pct(row.typicalPct)}
      </span>
      <Strip row={row} name={name} />
    </li>
  );
}

function Strip({ row, name }: { row: VenueMixRow; name: string }) {
  return (
    <div className="order-4 col-span-2 flex items-end gap-[2px] md:order-none md:col-span-1" style={{ height: STRIP_H }} aria-label={`${name}: each day's marketplace share`}>
      {row.daily.map((d) => (
        <span
          key={d.day}
          className="relative h-full w-[5px] bg-bg-2"
          title={d.pct == null ? `${day(d.day)} · no marketplace source` : `${day(d.day)} · marketplace ${d.pct.toFixed(1)}%`}
        >
          {d.pct != null && d.pct > 0 ? (
            // True to scale; a sliver keeps one pixel so a non-zero day never reads as none.
            <span className="absolute inset-x-0 bottom-0" style={{ height: `${d.pct}%`, minHeight: 1, background: MARKET }} />
          ) : null}
        </span>
      ))}
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 shrink-0" style={{ background: color }} />
      <span className="text-ink-2">{label}</span>
    </span>
  );
}
