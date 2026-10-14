/**
 * Volume mix, venue by venue: over the same complete days for every venue, how
 * its money splits between packs (gacha_volume_usd: packs, boxes, machines,
 * claws) and its marketplace (volume_usd: collectors buying from each other),
 * the median day's split, and every day's split. A reader sees for themselves
 * whether a venue's marketplace share is steady or one big day.
 *
 * ⚠️ NO CONCLUSION IS WRITTEN, AND THE TOTAL NEVER STANDS ALONE. One real sale can
 * carry a venue's 30-day share (Beezie's $1,000,000 on Sep 23 2026 was 92% of its
 * marketplace month), so the window total ships beside the median day and the
 * daily strip. A venue with no marketplace source (Phygitals) is null, never 0.
 */
import { latestCompleteDay, type SeriesPoint } from "./metricSnapshots";

export const VENUE_MIX_DAYS = 30;

export type VenueMixDay = { day: string; pct: number | null };

export type VenueMixRow = {
  venue: string;
  /** Null: no marketplace source for this venue. */
  marketUsd: number | null;
  packsUsd: number;
  /** Marketplace ÷ (marketplace + packs) over the window, 0-100. */
  marketPct: number | null;
  /** The median of the daily shares, over days with any volume. */
  typicalPct: number | null;
  daily: VenueMixDay[];
};

export type VenueMix = { from: string; to: string; days: number; rows: VenueMixRow[] };

const DAY = 86_400_000;
const dayOf = (ts: string) => ts.slice(0, 10);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function byDay(series: SeriesPoint[] | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of series ?? []) if (Number.isFinite(p.value)) out.set(dayOf(p.ts), (out.get(dayOf(p.ts)) ?? 0) + p.value);
  return out;
}

/**
 * The comparison, pure. Each venue's own latest complete day (its marketplace and
 * pack streams both in, metricSnapshots' rule) is found first; the window is the
 * `days` days ending on the EARLIEST of those, so every venue covers exactly the
 * same days. Rows sort by the window share, descending, no-source venues last.
 */
export function buildVenueMix(
  market: Record<string, SeriesPoint[] | undefined>,
  packs: Record<string, SeriesPoint[] | undefined>,
  venues: string[],
  days: number = VENUE_MIX_DAYS,
): VenueMix | null {
  const live = venues.filter((v) => (market[v]?.length ?? 0) + (packs[v]?.length ?? 0) > 0);
  const ends = live
    .map((v) => latestCompleteDay(new Map([["market", market[v] ?? []], ["packs", packs[v] ?? []]].filter(([, s]) => (s as SeriesPoint[]).length) as [string, SeriesPoint[]][])))
    .filter((d): d is string => d != null)
    .map(dayOf);
  if (!live.length || !ends.length) return null;
  const to = ends.sort()[0];
  const toMs = Date.parse(`${to}T00:00:00Z`);
  const window = Array.from({ length: days }, (_, i) => new Date(toMs - (days - 1 - i) * DAY).toISOString().slice(0, 10));

  const rows: VenueMixRow[] = live.map((venue) => {
    const hasMarket = (market[venue]?.length ?? 0) > 0;
    const m = byDay(market[venue]);
    const g = byDay(packs[venue]);
    let marketUsd = 0;
    let packsUsd = 0;
    const daily: VenueMixDay[] = window.map((day) => {
      const mv = m.get(day) ?? 0;
      const gv = g.get(day) ?? 0;
      marketUsd += mv;
      packsUsd += gv;
      return { day, pct: hasMarket && mv + gv > 0 ? (100 * mv) / (mv + gv) : null };
    });
    const total = marketUsd + packsUsd;
    return {
      venue,
      marketUsd: hasMarket ? marketUsd : null,
      packsUsd,
      marketPct: hasMarket && total > 0 ? (100 * marketUsd) / total : null,
      typicalPct: hasMarket ? median(daily.flatMap((d) => (d.pct == null ? [] : [d.pct]))) : null,
      daily,
    };
  });
  rows.sort((a, b) => (b.marketPct ?? -1) - (a.marketPct ?? -1));
  return { from: window[0], to, days, rows };
}
