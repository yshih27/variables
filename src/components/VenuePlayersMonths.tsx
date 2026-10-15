import type { VenuePlayersRow } from "@/lib/data/venuePlayers";
import { formatInt } from "@/lib/format";

/**
 * One venue's players each month (buildVenuePlayers, the row the /platforms
 * comparison draws for it): a bar per complete month, returning players at the
 * base and first-time on top, each bar's count above it and its returning share
 * under its month. The Players chapter's lead chart, beside the stat row.
 *
 * ⚠️ SAME ROW, SAME RULE AS THE COMPARISON. A month is drawn only where the
 * wallets counted cover at least half the venue's pack spend; the first such
 * month (everyone in it new to our records) and the month in progress are not.
 * The receipt says where the records start and what they cover, from the row.
 * No written conclusion: the counts and shares are printed, the reader reads them.
 */
const RETURNING = "var(--color-yellow)";
const FIRST = "color-mix(in srgb, var(--color-yellow) 35%, transparent)";
const BAR_H = 132;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
const long = (ym: string) => `${short(ym)} ${ym.slice(0, 4)}`;
const share = (n: number, of: number) => (of > 0 ? `${Math.round((100 * n) / of)}%` : "—");

export function VenuePlayersMonths({ row, venueName }: { row: VenuePlayersRow; venueName: string }) {
  if (!row.measured || !row.months.length) return null;
  const max = Math.max(1, ...row.months.map((m) => m.players));
  const cov = row.coverage ? (Math.round(row.coverage.min) === Math.round(row.coverage.max) ? `${Math.round(row.coverage.min)}%` : `${Math.round(row.coverage.min)}–${Math.round(row.coverage.max)}%`) : null;

  return (
    <div data-venue-players-months>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-3">Players each month</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
          <Swatch color={RETURNING} label="Returning: played in an earlier month" />
          <Swatch color={FIRST} label="First-time" />
        </div>
      </div>
      <div className="mt-3 flex items-end gap-1.5 sm:gap-2" role="img" aria-label={`${venueName}'s players each month: ${row.months.map((m) => `${long(m.month)} ${formatInt(m.players)}, ${share(m.returning, m.players)} returning`).join("; ")}`}>
        {row.months.map((m) => (
          <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center">
            <span className="mb-1 font-mono text-[10.5px] tabular text-ink-2">{formatInt(m.players)}</span>
            <div className="flex w-full flex-col-reverse" style={{ height: Math.max(3, Math.round((BAR_H * m.players) / max)) }} title={`${long(m.month)} · ${formatInt(m.players)} players · ${formatInt(m.returning)} returning (${share(m.returning, m.players)}) · ${formatInt(m.firstTime)} first-time`}>
              <span style={{ height: `${(100 * m.returning) / Math.max(1, m.players)}%`, background: RETURNING }} />
              <span style={{ height: `${(100 * m.firstTime) / Math.max(1, m.players)}%`, background: FIRST }} />
            </div>
            <span className="mt-1.5 font-mono text-[10px] text-ink-4">{short(m.month)}</span>
            <span className="font-mono text-[10.5px] tabular text-ink-3">{share(m.returning, m.players)}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-[10.5px] leading-snug text-ink-4" data-venue-players-months-receipt>
        {`players = wallets with at least one paid pull that month · the share under each month = returning players · first-time = first pull in our records · drawn where the wallets counted cover at least half of ${venueName}'s pack spend${cov ? ` (${cov} in the months drawn)` : ""}; records start ${long(row.since!)}, which is not drawn, nor is the month in progress`}
      </p>
    </div>
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
