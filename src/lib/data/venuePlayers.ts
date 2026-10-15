/**
 * Players each month, venue by venue: for every venue with wallet-level pulls,
 * how many players it had each complete month and how many of them had played
 * in an earlier month (returning) or never before in our records (first-time).
 *
 * ⚠️ A MONTH IS DRAWN ONLY WHERE OUR RECORDS COVER THE VENUE. Wallet-level pulls
 * reached Collector Crypt in June 2026 (0.1% of its pack spend before, 74-76%
 * from July) and cover 11-35% of Phygitals'; counted raw, a venue would seem to
 * gain thousands of players the month our records arrived. So a month is drawn
 * only when the spend of the wallets counted is at least MIN_COVERAGE of the
 * venue's pack spend that month (the spine's gacha_volume_usd), the first such
 * month is not drawn (everyone in it is new to the records), and neither is the
 * month in progress. A venue that never reaches it reads "not measured", with why.
 */
import type { PlatformPlayerAnalytics } from "./playerAnalytics";
import type { SeriesPoint } from "./metricSnapshots";

export const VENUE_PLAYER_MONTHS = 9;
export const MIN_COVERAGE = 0.5;

export type VenuePlayersMonth = { month: string; players: number; firstTime: number; returning: number; coveragePct: number };

export type VenuePlayersRow = {
  venue: string;
  measured: boolean;
  /** Why the venue is not drawn, when it is not. */
  reason: string | null;
  /** The first month the records cover the venue ("YYYY-MM"), never drawn itself. */
  since: string | null;
  months: VenuePlayersMonth[];
  /** Coverage across the months drawn, 0-100. */
  coverage: { min: number; max: number } | null;
};

function monthlySpend(series: SeriesPoint[] | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of series ?? []) if (Number.isFinite(p.value)) out.set(p.ts.slice(0, 7), (out.get(p.ts.slice(0, 7)) ?? 0) + p.value);
  return out;
}

/**
 * The comparison, pure. Each month's covered spend is the wallets' own
 * (`spendUsd`), else, where every pull row carries a wallet, the venue's priced
 * spend in the records that month (`monthly`). Measured rows sort by their
 * latest month's players, descending; the rest follow, in `venues` order.
 */
export function buildVenuePlayers(
  players: PlatformPlayerAnalytics[],
  packs: Record<string, SeriesPoint[] | undefined>,
  venues: string[],
  // The clock is read here, in the lib, not in a page's render (react-hooks/purity).
  nowMs: number = Date.now(),
  months: number = VENUE_PLAYER_MONTHS,
): VenuePlayersRow[] {
  const current = new Date(nowMs).toISOString().slice(0, 7);
  const byVenue = new Map(players.map((p) => [p.platform, p]));
  const rows = venues.map((venue): VenuePlayersRow => {
    const p = byVenue.get(venue);
    const all = (p?.monthlyPlayers ?? []).slice().sort((a, b) => a.month.localeCompare(b.month));
    if (!all.length) return { venue, measured: false, reason: "no wallet-level pulls", since: null, months: [], coverage: null };
    const everyRowHasWallet = p != null && p.coverage.rows > 0 && p.coverage.walletAttributedRows === p.coverage.rows;
    const recordSpend = new Map(p?.monthly.map((m) => [m.month, m.totalUsd]) ?? []);
    const venueSpend = monthlySpend(packs[venue]);
    const covered = all
      .filter((m) => m.month < current)
      .map((m) => {
        const spent = m.spendUsd ?? (everyRowHasWallet ? recordSpend.get(m.month) : undefined);
        const total = venueSpend.get(m.month) ?? 0;
        const coveragePct = spent != null && total > 0 ? Math.min(100, (100 * spent) / total) : null;
        return { ...m, coveragePct };
      })
      .filter((m): m is typeof m & { coveragePct: number } => m.coveragePct != null && m.coveragePct >= MIN_COVERAGE * 100);
    if (!covered.length) return { venue, measured: false, reason: "our records cover under half its pack spend", since: null, months: [], coverage: null };
    const since = covered[0].month;
    const shown = covered.slice(1).slice(-months).map((m) => ({
      month: m.month,
      players: m.players,
      firstTime: m.firstTime,
      returning: Math.max(0, m.players - m.firstTime),
      coveragePct: m.coveragePct,
    }));
    if (!shown.length) return { venue, measured: false, reason: "not enough covered months yet", since, months: [], coverage: null };
    const cov = shown.map((m) => m.coveragePct);
    return { venue, measured: true, reason: null, since, months: shown, coverage: { min: Math.min(...cov), max: Math.max(...cov) } };
  });
  const latest = (r: VenuePlayersRow) => r.months[r.months.length - 1]?.players ?? 0;
  return [...rows.filter((r) => r.measured).sort((a, b) => latest(b) - latest(a)), ...rows.filter((r) => !r.measured)];
}
