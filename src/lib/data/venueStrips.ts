/**
 * Against the other venues: the four cross-venue comparisons on /platforms, cut
 * to one figure per venue each, so a venue page shows where it sits without
 * carrying the full charts. Each strip places every measured venue on one axis;
 * the full chart, with every window and coverage note, stays on /platforms.
 *
 * ⚠️ ONE FIGURE PER VENUE, FROM THE ROWS THE FULL CHARTS DRAW. Nothing here
 * re-measures a venue: marketplace share is VenueMixRow.marketPct, the top 1% is
 * VenueSpendRow.top1Pct, returning is the latest month VenuePlayersRow draws, and
 * the pack price is the spend-weighted median of VenuePriceRow.points. A venue a
 * full chart leaves unmeasured is not placed here either, and the strip names it.
 */
import type { VenueMix } from "./venueMix";
import type { VenuePriceRow } from "./venuePrices";
import type { VenueSpendRow } from "./venueSpend";
import type { VenuePlayersRow } from "./venuePlayers";

export type StripKey = "marketplace" | "packPrice" | "top1" | "returning";

export type StripPoint = {
  venue: string;
  value: number;
  /** The figure as printed. */
  text: string;
  /** What the figure covers, for this venue ("Sep 2026", "7 days"). */
  window: string | null;
  /** The figure in one sentence, from the same row, for the hover read
   *  (the venue's name goes in front). */
  detail: string;
};

export type VenueStrip = {
  key: StripKey;
  title: string;
  /** What the figures cover, when every venue's is the same; else null (each bar says its own). */
  window: string | null;
  /** The full chart on /platforms. */
  href: string;
  /** "pct": 0-100, linear. "usd": dollars, log. */
  scale: "pct" | "usd";
  /** Measured venues, highest first. */
  points: StripPoint[];
  /** Venues the full chart shows as not measured, in their order there. */
  unmeasured: string[];
};

// One decimal, as the full charts print them (VenueMixCompare, VenueSpendCompare).
const pct = (n: number) => `${n.toFixed(1)}%`;
const usd = (n: number) => `$${n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : Math.round(n)}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLong = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;
const monthDay = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1] ?? d} ${Number(d.slice(8, 10))}`;
const monthDayYear = (d: string) => `${monthDay(d)}, ${d.slice(0, 4)}`;

/**
 * The price at or under which half the venue's pack spend falls: points sorted
 * by price, the first whose running share of spend reaches 50%. Null for a row
 * with no spend weights (a venue whose catalog carries no pull counts). Pure.
 */
export function medianPackPrice(row: Pick<VenuePriceRow, "points">): number | null {
  const pts = row.points.filter((p) => p.spendSharePct != null && p.spendSharePct > 0).sort((a, b) => a.priceUsd - b.priceUsd);
  const total = pts.reduce((s, p) => s + (p.spendSharePct ?? 0), 0);
  if (!(total > 0)) return null;
  let run = 0;
  for (const p of pts) {
    run += p.spendSharePct ?? 0;
    if (run >= total / 2) return p.priceUsd;
  }
  return pts[pts.length - 1].priceUsd;
}

const byValue = (a: StripPoint, b: StripPoint) => b.value - a.value;

/** The four strips, pure. `venues` is every venue's key in display order. */
export function buildVenueStrips(input: {
  mix: VenueMix | null;
  prices: VenuePriceRow[];
  spend: VenueSpendRow[];
  players: VenuePlayersRow[];
  venues: string[];
}): VenueStrip[] {
  const { mix, prices, spend, players, venues } = input;

  const mixPoints: StripPoint[] = [];
  const mixWindow = mix ? `${mix.days} days to ${monthDay(mix.to)}` : null;
  for (const r of mix?.rows ?? []) {
    if (r.marketPct != null) {
      const typical = r.typicalPct != null ? `; on a typical day, ${pct(r.typicalPct)}` : "";
      mixPoints.push({ venue: r.venue, value: r.marketPct, text: pct(r.marketPct), window: mixWindow, detail: `${pct(r.marketPct)} of its volume was resale on its own marketplace in the ${mixWindow}${typical}` });
    }
  }

  const pricePoints: StripPoint[] = [];
  for (const r of prices) {
    const m = r.window ? medianPackPrice(r) : null;
    if (m != null) {
      const window = r.window === "7d" ? "7 days" : r.estimated ? "24 hours, estimated" : "24 hours";
      pricePoints.push({ venue: r.venue, value: m, text: usd(m), window, detail: `half its pack spend went on packs of ${usd(m)} or less (last ${window})` });
    }
  }

  const spendPoints: StripPoint[] = spend
    .filter((r) => r.measured && r.top1Pct != null)
    .map((r) => ({
      venue: r.venue,
      value: r.top1Pct!,
      text: pct(r.top1Pct!),
      window: r.since ? `since ${monthDayYear(r.since)}` : null,
      detail: `its top 1% of wallets spent ${pct(r.top1Pct!)} of all its pack spend${r.since ? ` since ${monthDayYear(r.since)}` : ""}${
        r.coveragePct != null ? `; these wallets cover ${Math.round(r.coveragePct)}% of its pack spend` : ""
      }`,
    }));

  const playerPoints: StripPoint[] = [];
  for (const r of players) {
    const last = r.measured ? r.months[r.months.length - 1] : undefined;
    if (last && last.players > 0) {
      const v = (100 * last.returning) / last.players;
      playerPoints.push({
        venue: r.venue,
        value: v,
        text: `${Math.round(v)}%`,
        window: monthLong(last.month),
        detail: `${last.returning.toLocaleString("en-US")} of its ${last.players.toLocaleString("en-US")} players in ${monthLong(last.month)} had played in an earlier month`,
      });
    }
  }

  const missing = (pts: StripPoint[]) => venues.filter((v) => !pts.some((p) => p.venue === v));
  /** The one window every bar shares, or null when they differ. */
  const shared = (pts: StripPoint[]) => {
    const w = [...new Set(pts.map((p) => p.window))];
    return w.length === 1 ? w[0] : null;
  };
  return [
    { key: "marketplace", title: "Resale share of volume", window: shared(mixPoints), href: "/platforms#volume-mix-venues", scale: "pct", points: mixPoints.sort(byValue), unmeasured: missing(mixPoints) },
    { key: "packPrice", title: "Median pack price, by spend", window: shared(pricePoints), href: "/platforms#packs-by-price-venues", scale: "usd", points: pricePoints.sort(byValue), unmeasured: missing(pricePoints) },
    { key: "top1", title: "Top 1% of players' share of spend", window: shared(spendPoints), href: "/platforms#who-spends-venues", scale: "pct", points: spendPoints.sort(byValue), unmeasured: missing(spendPoints) },
    { key: "returning", title: "Players back from an earlier month", window: shared(playerPoints), href: "/platforms#players-venues", scale: "pct", points: playerPoints.sort(byValue), unmeasured: missing(playerPoints) },
  ];
}
