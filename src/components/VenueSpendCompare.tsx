import Link from "next/link";
import type { VenueSpendRow } from "@/lib/data/venueSpend";
import { formatCompactUsd, formatInt, formatMonthDayUtc } from "@/lib/format";
import { Section } from "./Section";

/**
 * Who spends, venue by venue (buildVenueSpend): one bar per venue for all of its
 * players' pack spend — the top 1% of wallets' share, the next 9%'s, and the
 * other 90%'s — beside the median player's spend and how many players.
 *
 * ⚠️ NO WRITTEN CONCLUSION, AND EACH ROW SAYS WHAT IT COVERS. The start date and
 * the share of the venue's pack spend the wallets account for sit on every row,
 * because they differ by venue; a venue with no wallet on its pulls reads "not
 * measured". One hue, dark to light, for one measure (dataviz: sequential).
 */
const TOP1 = "var(--color-yellow)";
const NEXT9 = "color-mix(in srgb, var(--color-yellow) 38%, transparent)";

const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const day = (iso: string | null) => (iso ? formatMonthDayUtc(`${iso}T00:00:00Z`) ?? iso : "—");

export function VenueSpendCompare({
  rows,
  names,
  highlight,
}: {
  rows: VenueSpendRow[] | null | undefined;
  names: Record<string, string>;
  highlight?: string;
}) {
  if (!rows?.some((r) => r.measured)) return null;

  return (
    <Section
      id="who-spends-venues"
      className="scroll-mt-24 font-sans"
      title="Who spends, venue by venue"
      readMe="how much of each venue's pack spending comes from its biggest spenders"
      subtitle="Every pull with a wallet, since each venue's records begin · by the top 1%'s share"
      flush
    >
      <div className="px-4 pb-1 pt-1 sm:px-5">
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
          <Swatch color={TOP1} label="Top 1% of players" />
          <Swatch color={NEXT9} label="Next 9%" />
          <Swatch color="var(--color-bg-2)" label="The other 90%" />
        </div>
        <div className="hidden grid-cols-[150px_minmax(0,1fr)_112px_96px_190px] gap-x-4 border-b border-line pb-2 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3 md:grid">
          <span>Venue</span>
          <span>Share of all pack spend</span>
          <span className="text-right">Median player</span>
          <span className="text-right">Players</span>
          <span>Since · covers</span>
        </div>
        <ul data-who-spends>
          {rows.map((r) => (
            <SpendRow key={r.venue} row={r} name={names[r.venue] ?? r.venue} marked={r.venue === highlight} />
          ))}
        </ul>
      </div>
      <p className="border-t border-line px-4 py-2.5 font-mono text-[10.5px] leading-snug text-ink-4 sm:px-5" data-who-spends-receipt>
        players = wallets that pulled at least once since the venue&apos;s first pull with a wallet · top 1% / next 9% = the share of those
        wallets&apos; total pack spend from the biggest-spending 1% / the next 9% · median player = the middle wallet&apos;s total spend ·
        covers = their spend ÷ the venue&apos;s pack spend over the same days, below 100% where some pulls carry no wallet · not measured =
        no wallet-level pulls
      </p>
    </Section>
  );
}

function SpendRow({ row, name, marked }: { row: VenueSpendRow; name: string; marked: boolean }) {
  const t1 = row.top1Pct ?? 0;
  const t10 = row.top10Pct ?? 0;
  return (
    <li
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-line/60 py-3 last:border-b-0 md:grid-cols-[150px_minmax(0,1fr)_112px_96px_190px] ${
        marked ? "-mx-2 bg-bg-2/60 px-2" : ""
      }`}
      data-venue={row.venue}
    >
      <Link href={`/platform/${row.venue}`} className={`truncate text-[13px] hover:text-yellow ${marked ? "font-semibold text-ink" : "text-ink"}`}>
        {name}
      </Link>
      {row.measured ? (
        <>
          <div className="order-3 col-span-2 flex min-w-0 items-center gap-3 md:order-none md:col-span-1">
            <div
              className="relative h-3 min-w-0 flex-1 bg-bg-2"
              title={`${name} · top 1% ${pct(row.top1Pct)} · top 10% ${pct(row.top10Pct)} of pack spend`}
            >
              <span className="absolute inset-y-0 left-0" style={{ width: `${t10}%`, background: NEXT9 }} />
              <span className="absolute inset-y-0 left-0" style={{ width: `${t1}%`, background: TOP1 }} />
            </div>
            <span className="w-[150px] shrink-0 whitespace-nowrap text-right font-mono text-[12px] tabular text-ink">
              {pct(row.top1Pct)}
              <span className="text-ink-3">{` · top 10% ${pct(row.top10Pct)}`}</span>
            </span>
          </div>
          <span className="text-right font-mono text-[12px] tabular text-ink-2">
            <span className="mr-1.5 text-[10.5px] text-ink-4 md:hidden">median player</span>
            {row.medianUsd == null ? "—" : formatCompactUsd(row.medianUsd)}
          </span>
          <span className="hidden text-right font-mono text-[12px] tabular text-ink-2 md:block">{row.wallets == null ? "—" : formatInt(row.wallets)}</span>
          <span className="order-4 col-span-2 font-mono text-[11px] text-ink-3 md:order-none md:col-span-1">
            {`since ${day(row.since)} · covers ${row.coveragePct == null ? "—" : `${Math.round(row.coveragePct)}%`}`}
            <span className="md:hidden">{` · ${row.wallets == null ? "—" : formatInt(row.wallets)} players`}</span>
          </span>
        </>
      ) : (
        <span className="col-span-1 text-right font-mono text-[12px] text-ink-4 md:col-span-4 md:text-left">not measured</span>
      )}
    </li>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 shrink-0 border border-line" style={{ background: color }} />
      <span className="text-ink-2">{label}</span>
    </span>
  );
}
