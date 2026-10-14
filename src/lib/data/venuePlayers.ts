/**
 * Players each month, venue by venue: for every venue with wallet-level pulls,
 * how many players it had each complete month and how many of them had played
 * in an earlier month (returning) or never before in our records (first-time).
 *
 * ⚠️ TWO MONTHS ARE NEVER DRAWN. The first month of a venue's records (everyone
 * in it is "new" to the records, whatever their history) and the month in
 * progress (incomplete). A venue whose records start after it launched still
 * overcounts first-timers in its early months; the chart's receipt says so.
 */
import type { PlatformPlayerAnalytics } from "./playerAnalytics";

export const VENUE_PLAYER_MONTHS = 9;

export type VenuePlayersMonth = { month: string; players: number; firstTime: number; returning: number };

export type VenuePlayersRow = {
  venue: string;
  measured: boolean;
  /** The first month of the venue's records ("YYYY-MM"), left out of the chart. */
  since: string | null;
  months: VenuePlayersMonth[];
};

/**
 * The comparison, pure. Measured rows sort by their latest month's players,
 * descending; venues without monthly players read "not measured", last.
 */
export function buildVenuePlayers(
  players: PlatformPlayerAnalytics[],
  venues: string[],
  // The clock is read here, in the lib, not in a page's render (react-hooks/purity).
  nowMs: number = Date.now(),
  months: number = VENUE_PLAYER_MONTHS,
): VenuePlayersRow[] {
  const current = new Date(nowMs).toISOString().slice(0, 7);
  const byVenue = new Map(players.map((p) => [p.platform, p]));
  const rows = venues.map((venue): VenuePlayersRow => {
    const all = (byVenue.get(venue)?.monthlyPlayers ?? []).slice().sort((a, b) => a.month.localeCompare(b.month));
    const since = all[0]?.month ?? null;
    const shown = all
      .filter((m) => m.month !== since && m.month < current)
      .slice(-months)
      .map((m) => ({ month: m.month, players: m.players, firstTime: m.firstTime, returning: Math.max(0, m.players - m.firstTime) }));
    return { venue, measured: shown.length > 0, since, months: shown };
  });
  const latest = (r: VenuePlayersRow) => r.months[r.months.length - 1]?.players ?? 0;
  return [...rows.filter((r) => r.measured).sort((a, b) => latest(b) - latest(a)), ...rows.filter((r) => !r.measured)];
}
