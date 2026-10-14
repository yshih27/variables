import Link from "next/link";
import type { VenuePlayersRow } from "@/lib/data/venuePlayers";
import { formatInt } from "@/lib/format";
import { Section } from "./Section";

/**
 * Players each month, venue by venue (buildVenuePlayers): a row of monthly bars
 * per venue, each bar its players that month — returning at the base, first-
 * time on top — on the venue's own scale, with the latest month in words.
 *
 * ⚠️ NO WRITTEN CONCLUSION; SCALES ARE PER ROW. Venues differ tenfold in players,
 * so each row has its own height scale (the latest count is printed) and the
 * returning share is the comparable figure. The receipt names each venue's first
 * month of records, which is never drawn.
 */
const RETURNING = "var(--color-yellow)";
const FIRST = "color-mix(in srgb, var(--color-yellow) 35%, transparent)";
const BAR_H = 44;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mon = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;
const short = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
const share = (n: number, of: number) => (of > 0 ? `${Math.round((100 * n) / of)}%` : "—");

export function VenuePlayersCompare({
  rows,
  names,
  highlight,
}: {
  rows: VenuePlayersRow[] | null | undefined;
  names: Record<string, string>;
  highlight?: string;
}) {
  if (!rows?.some((r) => r.measured)) return null;
  const pct = (n: number) => `${Math.round(n)}%`;
  const covered = rows
    .filter((r) => r.measured && r.coverage)
    .map((r) => {
      const lo = pct(r.coverage!.min);
      const hi = pct(r.coverage!.max);
      return `${names[r.venue] ?? r.venue} from ${mon(r.since!)}, ${lo === hi ? lo : `${lo}–${hi}`} of its pack spend in the months drawn`;
    });

  return (
    <Section
      id="players-venues"
      className="scroll-mt-24 font-sans"
      title="Players each month, venue by venue"
      readMe="how many players each venue has each month, and how many came back from an earlier month"
      subtitle="Complete months · each venue's bars on its own scale"
      flush
    >
      <div className="px-4 pb-1 pt-1 sm:px-5">
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
          <Swatch color={RETURNING} label="Returning: played in an earlier month" />
          <Swatch color={FIRST} label="First-time: first pull in our records" />
        </div>
        <ul data-players-venues>
          {rows.map((r) => (
            <PlayersRow key={r.venue} row={r} name={names[r.venue] ?? r.venue} marked={r.venue === highlight} />
          ))}
        </ul>
      </div>
      <p className="border-t border-line px-4 py-2.5 font-mono text-[10.5px] leading-snug text-ink-4 sm:px-5" data-players-venues-receipt>
        {`players = wallets with at least one paid pull that month · returning = they pulled in an earlier month · first-time = their first pull in our records · a month is drawn only when the wallets counted spent at least half of the venue's pack spend that month; the first such month is not drawn (everyone in it is new to the records), nor is the month in progress · records cover: ${covered.join("; ")} · where records start after a venue launched, early months overcount first-timers`}
      </p>
    </Section>
  );
}

function PlayersRow({ row, name, marked }: { row: VenuePlayersRow; name: string; marked: boolean }) {
  const last = row.months[row.months.length - 1];
  const max = Math.max(1, ...row.months.map((m) => m.players));
  return (
    <li
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-line/60 py-3 last:border-b-0 md:grid-cols-[150px_minmax(0,1fr)_290px] ${
        marked ? "-mx-2 bg-bg-2/60 px-2" : ""
      }`}
      data-venue={row.venue}
    >
      <Link href={`/platform/${row.venue}`} className={`truncate text-[13px] hover:text-yellow ${marked ? "font-semibold" : ""} text-ink`}>
        {name}
      </Link>
      {row.measured && last ? (
        <>
          <div className="order-3 col-span-2 md:order-none md:col-span-1">
            <div className="flex items-end gap-[3px]" style={{ height: BAR_H }}>
              {row.months.map((m) => (
                <span
                  key={m.month}
                  className="flex min-w-0 flex-1 flex-col-reverse"
                  style={{ height: `${(100 * m.players) / max}%` }}
                  title={`${mon(m.month)} · ${formatInt(m.players)} players · ${formatInt(m.returning)} returning (${share(m.returning, m.players)}) · ${formatInt(m.firstTime)} first-time`}
                >
                  <span style={{ height: `${(100 * m.returning) / Math.max(1, m.players)}%`, background: RETURNING }} />
                  <span style={{ height: `${(100 * m.firstTime) / Math.max(1, m.players)}%`, background: FIRST }} />
                </span>
              ))}
            </div>
            <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-4">
              <span>{short(row.months[0].month)}</span>
              <span>{short(last.month)}</span>
            </div>
          </div>
          <span className="whitespace-nowrap text-right font-mono text-[12px] tabular text-ink-2">
            <span className="text-ink">{`${short(last.month)} · ${formatInt(last.players)} players`}</span>
            <span className="text-ink-3">{` · ${share(last.returning, last.players)} returning`}</span>
          </span>
        </>
      ) : (
        <span className="text-right font-mono text-[12px] text-ink-4 md:col-span-2 md:text-left">{`not measured: ${row.reason ?? "no wallet-level pulls"}`}</span>
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
