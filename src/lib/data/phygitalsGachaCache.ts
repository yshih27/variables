/**
 * Phygitals gacha snapshot store — backed by Postgres (`snapshots` table,
 * key='gacha:phygitals').
 *
 * This is the page-facing denormalized view of what the CLAW-feed warmer
 * derives that Dune CANNOT give us: realized prize-value odds, per-product EV,
 * and biggest hits with art — all from the pull→prize linkage in one feed row.
 * It lives under its OWN snapshot key so it never clobbers the Dune `gacha`
 * blob; fetchGacha reads both and merges them. The durable per-pull spine lands
 * in the normalized gacha_products/gacha_pulls/gacha_metrics tables (see the
 * warmer); this blob is the fast read path for the page.
 *
 * Why value-bands and not rarity: `ebayListing.rarity` is null across the live
 * feed, but `ebayListing.fmv` is reliably present — so "odds" here is the
 * realized distribution of prize value vs the price paid (fmv / price), which
 * is also the more decision-relevant signal for a value-seeking buyer.
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";
import type { GachaBigHit, GachaOddsTier } from "./gachaDuneCache";

export const PHYGITALS_GACHA_KEY = "gacha:phygitals";

/**
 * Realized prize-value bands, by FMV multiple of the price paid (m = fmv/price).
 * `hit` = "you pulled at least the value of your stake back" (m ≥ 1) — the
 * break-even-or-better outcome the spend-decider counts as a hit for Phygitals.
 * Order is rarest/best → commonest so the stacked odds bar reads jackpot-first.
 */
export const PHYGITALS_VALUE_BANDS: ReadonlyArray<{
  label: string;
  minMult: number;
  maxMult: number;
  hit: boolean;
}> = [
  { label: "5×+", minMult: 5, maxMult: Infinity, hit: true },
  { label: "2–5×", minMult: 2, maxMult: 5, hit: true },
  { label: "1–2×", minMult: 1, maxMult: 2, hit: true },
  { label: "½–1×", minMult: 0.5, maxMult: 1, hit: false },
  { label: "<½×", minMult: 0, maxMult: 0.5, hit: false },
];

/** One pack (clawId) with its realized economics over the scanned window. */
export type PhygitalsGachaProduct = {
  clawId: string;
  name: string; // derived, e.g. "$25 Pokémon Pack"
  category: string | null;
  priceUsd: number; // modal price paid
  pulls: number;
  meanFmvUsd: number;
  medianFmvUsd: number;
  maxFmvUsd: number;
  /** Realized EV = mean prize FMV / price paid (value retained per $1, FMV basis). */
  evMultiple: number;
};

export type PhygitalsGachaSnapshot = {
  generatedAt: string;
  /** The TRUE window scanned — honest, never assumed. */
  window: {
    fromISO: string | null;
    toISO: string | null;
    hours: number | null;
    pulls: number;
    pagesScanned: number;
  };
  /** Realized prize-value distribution (the "odds") — GachaOddsTier-shaped so
   *  it drops straight into platforms.phygitals.odds. `hit` flags break-even+. */
  odds: GachaOddsTier[];
  /** Per-pack realized economics, sorted by pulls desc. */
  products: PhygitalsGachaProduct[];
  /** Best realized-EV pack (highest value retained, among packs with enough pulls). */
  bestEv: PhygitalsGachaProduct | null;
  /** Aggregate realized EV across all pulls = Σfmv / Σprice (FMV basis). */
  realizedEvMultiple: number | null;
  /** Biggest hits this window, ranked by FMV desc (GachaBigHit-shaped). */
  bigHits: GachaBigHit[];
};

export async function readPhygitalsGacha(): Promise<PhygitalsGachaSnapshot | null> {
  return readSnapshot<PhygitalsGachaSnapshot>(PHYGITALS_GACHA_KEY);
}

export async function writePhygitalsGacha(snap: PhygitalsGachaSnapshot): Promise<void> {
  await writeSnapshot(PHYGITALS_GACHA_KEY, snap, snap.generatedAt);
}
