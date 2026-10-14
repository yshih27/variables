/**
 * Venue insights: what a venue cannot read from its own backend, because the
 * answer needs every other venue Varible tracks.
 *
 *   • Market position: a venue's share of all pack spend, and its rank, month by
 *     month (the spine's `gacha_volume_usd`, complete months only).
 *   • Same card, other venues: what this venue's buyers paid for a card against
 *     the same card and grade sold on another venue in the same month (the
 *     index's sale panel, one identity per comparable).
 *
 * scripts/warm-venue-insights.ts writes both into one snapshot, `venue-insights`,
 * after the core batch rebuilds the sale panel; the platform page reads it.
 * Everything here is pure; the reads live in the warmer.
 *
 * ⚠️ PRICES ARE COMPARED AS EACH VENUE RECORDS THEM. Renaiss's are what the
 * buyer paid, the others' the sale price; a gap of a few percent is inside that
 * difference, and the page says so.
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";
import type { SeriesPoint } from "./metricSnapshots";

export const VENUE_INSIGHTS_SNAPSHOT_KEY = "venue-insights";

/** Months of market position kept: a year of complete months. */
export const MARKET_MONTHS = 12;
/** Complete months the same-card comparison covers. */
export const SAME_CARD_MONTHS = 6;
/** Fewer comparisons than this and a group is not published: a median of a handful reads as a fact it is not. */
export const SAME_CARD_MIN_N = 20;
/** "Higher" and "lower" mean more than this far from parity. */
export const SAME_CARD_BAND = 0.1;

export type MarketPosition = {
  metric: "gacha_volume_usd";
  /** Complete calendar months, oldest first: "2026-09". */
  months: string[];
  /** Σ pack spend across every venue with spend that month. */
  totalsUsd: number[];
  /** How many venues had spend that month. */
  venueCounts: number[];
  venues: Record<string, { spendUsd: number[]; sharePct: (number | null)[]; rank: (number | null)[] }>;
};

export type PriceGap = {
  /** Identity-months compared. */
  n: number;
  /** Median of (this venue's median ÷ the other venues' median), per identity-month. */
  medianRatio: number;
  /** Share of comparisons where this venue was more than SAME_CARD_BAND above / below. */
  higherPct: number;
  lowerPct: number;
};

export type SameCard = {
  /** The complete months compared, oldest first. */
  months: string[];
  /** This venue's identities sold in the window, and how many of them also sold elsewhere. */
  identities: number;
  sharedIdentities: number;
  all: PriceGap | null;
  byLanguage: ({ language: string } & PriceGap)[];
  byVenue: ({ venue: string } & PriceGap)[];
};

export type VenueInsights = {
  generatedAt: string;
  market: MarketPosition;
  sameCard: Record<string, SameCard>;
};

const monthOf = (iso: string) => iso.slice(0, 7);

/** The `n` complete calendar months before `nowMs`'s month, oldest first. */
export function completeMonths(nowMs: number, n: number): string[] {
  const d = new Date(nowMs);
  const out: string[] = [];
  for (let i = n; i >= 1; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(`${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/**
 * Each venue's share of all pack spend and its rank, per complete month. A
 * venue with no spend in a month has no share and no rank that month (null),
 * never a zero rank; a month's total is over the venues that had spend.
 */
export function marketPosition(series: Map<string, SeriesPoint[]>, nowMs: number, months = MARKET_MONTHS): MarketPosition {
  const ms = completeMonths(nowMs, months);
  const index = new Map(ms.map((m, i) => [m, i]));
  const spend = new Map<string, number[]>();
  for (const [venue, pts] of series) {
    const row = new Array<number>(ms.length).fill(0);
    for (const p of pts) {
      const i = index.get(monthOf(p.ts));
      if (i != null && Number.isFinite(p.value) && p.value > 0) row[i] += p.value;
    }
    spend.set(venue, row);
  }
  const totalsUsd = ms.map((_, i) => [...spend.values()].reduce((s, r) => s + r[i], 0));
  const venueCounts = ms.map((_, i) => [...spend.values()].filter((r) => r[i] > 0).length);
  const venues: MarketPosition["venues"] = {};
  for (const [venue, row] of spend) {
    venues[venue] = {
      spendUsd: row,
      sharePct: row.map((v, i) => (v > 0 && totalsUsd[i] > 0 ? (v / totalsUsd[i]) * 100 : null)),
      rank: row.map((v, i) => (v > 0 ? 1 + [...spend.values()].filter((r) => r[i] > v).length : null)),
    };
  }
  return { metric: "gacha_volume_usd", months: ms, totalsUsd, venueCounts, venues };
}

/** One sale, as the comparison needs it. */
export type ComparableSale = { identity: string | null; platform: string; ts: string; priceUsd: number };

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** An identity's language: its key's last field, English when the field is empty (traits.ts identityKey). */
export function identityLanguage(identity: string): string {
  const parts = identity.split("|");
  const lang = parts[parts.length - 1]?.trim();
  return lang ? lang : "English";
}

function gap(ratios: number[]): PriceGap | null {
  if (ratios.length < SAME_CARD_MIN_N) return null;
  return {
    n: ratios.length,
    medianRatio: median(ratios),
    higherPct: (100 * ratios.filter((r) => r > 1 + SAME_CARD_BAND).length) / ratios.length,
    lowerPct: (100 * ratios.filter((r) => r < 1 - SAME_CARD_BAND).length) / ratios.length,
  };
}

/**
 * What `venue`'s buyers paid against the same identity sold elsewhere in the same
 * month, over `months`. Per identity-month where the venue and at least one other
 * venue both sold it: this venue's median price ÷ the others' median. Groups
 * under SAME_CARD_MIN_N comparisons are left out; null when the venue has no
 * identity in the window at all.
 */
export function sameCardGaps(sales: ComparableSale[], venue: string, months: string[]): SameCard | null {
  const inWindow = new Set(months);
  // identity → month → platform → prices
  const byIdentity = new Map<string, Map<string, Map<string, number[]>>>();
  for (const s of sales) {
    if (!s.identity || !(s.priceUsd > 0)) continue;
    const m = monthOf(s.ts);
    if (!inWindow.has(m)) continue;
    const byMonth = byIdentity.get(s.identity) ?? new Map<string, Map<string, number[]>>();
    const byPlatform = byMonth.get(m) ?? new Map<string, number[]>();
    const prices = byPlatform.get(s.platform) ?? [];
    prices.push(s.priceUsd);
    byPlatform.set(s.platform, prices);
    byMonth.set(m, byPlatform);
    byIdentity.set(s.identity, byMonth);
  }
  let identities = 0;
  let sharedIdentities = 0;
  const all: number[] = [];
  const byLang = new Map<string, number[]>();
  const byOther = new Map<string, number[]>();
  for (const [identity, byMonth] of byIdentity) {
    const venueMonths = [...byMonth.values()].filter((p) => p.has(venue));
    if (!venueMonths.length) continue;
    identities++;
    const platforms = new Set([...byMonth.values()].flatMap((p) => [...p.keys()]));
    if (platforms.size > 1) sharedIdentities++;
    for (const byPlatform of venueMonths) {
      const others = [...byPlatform.entries()].filter(([p]) => p !== venue);
      if (!others.length) continue;
      const own = median(byPlatform.get(venue)!);
      const ratio = own / median(others.flatMap(([, v]) => v));
      if (!Number.isFinite(ratio) || !(ratio > 0)) continue;
      all.push(ratio);
      const lang = identityLanguage(identity);
      byLang.set(lang, [...(byLang.get(lang) ?? []), ratio]);
      for (const [other, prices] of others) {
        const r = own / median(prices);
        if (Number.isFinite(r) && r > 0) byOther.set(other, [...(byOther.get(other) ?? []), r]);
      }
    }
  }
  if (!identities) return null;
  const groups = <K extends string>(m: Map<string, number[]>, key: K) =>
    [...m.entries()]
      .map(([k, rs]) => {
        const g = gap(rs);
        return g ? ({ [key]: k, ...g } as { [P in K]: string } & PriceGap) : null;
      })
      .filter((g): g is { [P in K]: string } & PriceGap => g != null)
      .sort((a, b) => b.n - a.n);
  return {
    months,
    identities,
    sharedIdentities,
    all: gap(all),
    byLanguage: groups(byLang, "language"),
    byVenue: groups(byOther, "venue"),
  };
}

/** Both insights for every venue, from the two reads. Pure. */
export function buildVenueInsights(gacha: Map<string, SeriesPoint[]>, sales: ComparableSale[], nowMs: number): VenueInsights {
  const months = completeMonths(nowMs, SAME_CARD_MONTHS);
  const sameCard: Record<string, SameCard> = {};
  for (const venue of new Set(sales.map((s) => s.platform))) {
    const g = sameCardGaps(sales, venue, months);
    if (g) sameCard[venue] = g;
  }
  return { generatedAt: new Date(nowMs).toISOString(), market: marketPosition(gacha, nowMs), sameCard };
}

export function readVenueInsights(): Promise<VenueInsights | null> {
  return readSnapshot<VenueInsights>(VENUE_INSIGHTS_SNAPSHOT_KEY);
}

export function writeVenueInsights(v: VenueInsights): Promise<void> {
  return writeSnapshot(VENUE_INSIGHTS_SNAPSHOT_KEY, v, v.generatedAt);
}
