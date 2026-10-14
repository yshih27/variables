/**
 * Who spends, venue by venue: how concentrated each venue's pack spending is
 * across its players — the share of all spend from its biggest-spending 1% and
 * 10% of wallets, the median wallet's spend, how many wallets, since when, and
 * how much of the venue's pack spend those wallets account for.
 *
 * ⚠️ EVERY ROW CARRIES ITS OWN WINDOW AND COVERAGE. Wallet-level pulls start on
 * different days per venue, and on some venues only part of the spend carries a
 * wallet (Phygitals, Oct 14 2026: about an eighth). A row states both, from data,
 * so a reader weighs it; a venue without wallet-level pulls (DYLI's feed has no
 * buyer) reads "not measured", never a number.
 */
import type { PlatformPlayerAnalytics } from "./playerAnalytics";
import type { SeriesPoint } from "./metricSnapshots";

export type VenueSpendRow = {
  venue: string;
  measured: boolean;
  wallets: number | null;
  top1Pct: number | null;
  top10Pct: number | null;
  medianUsd: number | null;
  /** First pull with a wallet (ISO day): the start of "all time" for this venue. */
  since: string | null;
  /** Spend these wallets account for ÷ the venue's pack spend over the same days, 0-100. */
  coveragePct: number | null;
};

/** Σ of a daily series over [fromDay, toDay], inclusive. */
function sumDays(series: SeriesPoint[] | undefined, fromDay: string, toDay: string): number {
  let s = 0;
  for (const p of series ?? []) {
    const d = p.ts.slice(0, 10);
    if (d >= fromDay && d <= toDay && Number.isFinite(p.value)) s += p.value;
  }
  return s;
}

/**
 * The comparison, pure. `players` are the venues' analytics (any order); `packs`
 * is each venue's daily pack spend (gacha_volume_usd) for coverage. Measured rows
 * sort by the top 1%'s share, descending; unmeasured last, in `venues` order.
 */
export function buildVenueSpend(players: PlatformPlayerAnalytics[], packs: Record<string, SeriesPoint[] | undefined>, venues: string[]): VenueSpendRow[] {
  const byVenue = new Map(players.map((p) => [p.platform, p]));
  const rows = venues
    .filter((v) => byVenue.has(v) || (packs[v]?.length ?? 0) > 0)
    .map((venue): VenueSpendRow => {
      const p = byVenue.get(venue);
      const c = p?.concentration;
      if (!p || !c || !(c.totalWallets > 0)) {
        return { venue, measured: false, wallets: null, top1Pct: null, top10Pct: null, medianUsd: null, since: null, coveragePct: null };
      }
      const since = p.coverage.firstPullAt?.slice(0, 10) ?? null;
      const until = p.coverage.lastPullAt?.slice(0, 10) ?? null;
      const venueSpend = since && until ? sumDays(packs[venue], since, until) : 0;
      return {
        venue,
        measured: true,
        wallets: c.totalWallets,
        top1Pct: c.top1PctShare,
        top10Pct: c.top10PctShare,
        medianUsd: c.medianLifetimeSpendUsd,
        since,
        coveragePct: venueSpend > 0 ? Math.min(100, (100 * c.totalSpendUsd) / venueSpend) : null,
      };
    });
  const measured = rows.filter((r) => r.measured).sort((a, b) => (b.top1Pct ?? 0) - (a.top1Pct ?? 0));
  return [...measured, ...rows.filter((r) => !r.measured)];
}
