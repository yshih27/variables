/**
 * Per-IP market-cap snapshot + rolling hourly history. Backed by the Postgres
 * `snapshots` blobs (key='marketcap' and key='marketcap-history'); populated by
 * `npm run warm-marketcap`.
 *
 * Methodology hybrid per platform:
 *   Beezie + Courtyard tokens → lowest active listing in USD
 *   Collector Crypt tokens   → "Insured Value" trait (vault appraisal)
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";

/**
 * The hybrid above, in a form the UI can read — so a page can say WHICH kind of
 * number it's showing.
 *
 * ⚠️ These two bases are not interchangeable. An appraisal is what a card is
 * assessed to be worth; a floor is the cheapest active listing, so floor × supply
 * is a LOWER BOUND and moves with whoever is currently undercutting. Rendered
 * identically, Phygitals' $84.7K read as the same species of number as Collector
 * Crypt's appraised cap — $3/holder sitting next to $398K/day of gacha, with
 * nothing on the page to say why.
 */
export type McapBasis = "appraisal" | "floor";

/** Platforms absent here have no market cap tracked at all (Courtyard). */
export const MCAP_BASIS: Record<string, McapBasis> = {
  "collector-crypt": "appraisal",
  beezie: "floor",
  phygitals: "floor",
};

/** The qualifier shown beside the number. */
export const MCAP_BASIS_LABEL: Record<McapBasis, string> = {
  appraisal: "vault appraisal",
  floor: "floor-based estimate",
};

export type MarketCapIPEntry = {
  cards: number;
  cardsValued: number; // tokens that contributed a value
  floorUsd: number;
  mcapUsd: number;
  insuredUsd: number;
};

/** One IP's contribution within a single platform (the platform-breakdown unit). */
export type MarketCapPlatformIP = {
  cards: number;
  cardsValued: number;
  floorUsd: number;
  mcapUsd: number;
};

/** A platform's full market-cap picture: totals + its per-IP composition. */
export type MarketCapPlatformEntry = {
  cards: number;
  cardsValued: number;
  floorUsd: number;
  mcapUsd: number;
  insuredUsd: number;
  byIp: Record<string, MarketCapPlatformIP>;
};

export type MarketCapSnapshot = {
  generatedAt: string;
  /** Across all platforms, keyed by IP (drives the IP pages). */
  byIp: Record<string, MarketCapIPEntry>;
  /** Per platform, with each platform's IP composition (drives the platform breakdown).
   *  Only platforms whose cards carry a value appear (CC = insured, Beezie = listing). */
  byPlatform?: Record<string, MarketCapPlatformEntry>;
  totals: {
    mcapUsd: number;
    insuredUsd: number;
  };
};

export type MarketCapHistory = {
  /** Up to 24 * 30 = 720 hourly entries. */
  hourly: Array<{
    at: string;
    byIp: Record<string, number>; // ipKey → mcapUsd at that hour
    totalMcapUsd: number;
  }>;
};

export async function readMarketCap(): Promise<MarketCapSnapshot | null> {
  return readSnapshot<MarketCapSnapshot>("marketcap");
}

export async function writeMarketCap(snap: MarketCapSnapshot): Promise<void> {
  await writeSnapshot("marketcap", snap, snap.generatedAt);
}

export async function readMarketCapHistory(): Promise<MarketCapHistory> {
  return (await readSnapshot<MarketCapHistory>("marketcap-history")) ?? { hourly: [] };
}

export async function appendMarketCapHistory(snap: MarketCapSnapshot): Promise<void> {
  const hist = await readMarketCapHistory();
  hist.hourly.push({
    at: snap.generatedAt,
    byIp: Object.fromEntries(Object.entries(snap.byIp).map(([k, v]) => [k, v.mcapUsd])),
    totalMcapUsd: snap.totals.mcapUsd,
  });
  // Trim to last 720 entries (30 days at hourly).
  while (hist.hourly.length > 720) hist.hourly.shift();
  await writeSnapshot("marketcap-history", hist, snap.generatedAt);
}

/**
 * Percent change in total market cap over the last `hoursBack` hours.
 * Returns null if history is too thin, the older snapshot is malformed, or the
 * older value is zero.
 */
export function pctChangeOverHours(
  hist: MarketCapHistory,
  hoursBack: number,
): number | null {
  if (hist.hourly.length < 2) return null;
  const now = Date.now();
  const cutoff = now - hoursBack * 60 * 60 * 1000;
  let oldIdx = -1;
  for (let i = hist.hourly.length - 1; i >= 0; i--) {
    const t = Date.parse(hist.hourly[i].at);
    if (Number.isFinite(t) && t <= cutoff) {
      oldIdx = i;
      break;
    }
  }
  if (oldIdx < 0) return null;
  const oldVal = hist.hourly[oldIdx].totalMcapUsd;
  const newVal = hist.hourly[hist.hourly.length - 1].totalMcapUsd;
  if (!Number.isFinite(oldVal) || !Number.isFinite(newVal) || oldVal === 0) return null;
  return (newVal - oldVal) / oldVal;
}
