/**
 * Pack-centric gacha model — the snapshot store behind the /gacha comparison.
 *
 * The UNIT is the PACK, not the platform. Every site sells a catalog of priced
 * packs ("claws"); each pack has its OWN top prize, odds, EV, buyback, floor and
 * popularity. The old decider showed a platform-wide biggest-hit (identical in
 * every budget band) — this model fixes that so a $50 pack and a $1K pack differ.
 *
 * HONESTY IS THE PRODUCT. Two data bases coexist and must never be conflated:
 *   • "stated"   — the vendor's ADVERTISED numbers (Beezie /claw odds + averageValue,
 *                  Phygitals /vm/chase top-hits). Marketing, unverified.
 *   • "realized" — MEASURED on-chain from our pull spine (Phygitals gacha_pulls),
 *                  always carried with a sample size `realizedN`.
 *   • "platform" — only available at platform grain, NOT attributable to a pack
 *                  (Collector Crypt rarity odds / big-hits from Dune).
 * Every metric carries its basis so the UI can label and segregate them — a
 * vendor EV must never silently outrank a measured one.
 *
 * Pack identity is keyed on (platform, category, price) — NOT the native clawId,
 * whose trailing hash rotates on restock and which differs between the advertised
 * feed (`mythic-pack`) and the realized feed (`1-mythic-srpiwq`). That (cat,price)
 * key is also how advertised top-hits join to realized pulls.
 *
 * Stored as a `snapshots` blob (key='gacha:packs') — cache-only reads, no DDL.
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";
import type { Chain } from "@/lib/types";

export const GACHA_PACKS_KEY = "gacha:packs";

/** Where a number came from — drives labeling + visual segregation in the UI.
 *  stated = vendor-advertised · realized = measured on-chain (carries n) ·
 *  platform = only platform-wide (not pack-attributable) · assumed = an
 *  unverified constant we can't source (e.g. Phygitals' ~90% buyback). */
export type MetricBasis = "stated" | "realized" | "platform" | "assumed";

/** One prize in a pack's pool (a "top hit"). `name` is null where the source
 *  only exposes a token id + value (Beezie grails carry no card name). */
export type PackHit = {
  id: string; // mint (Phygitals) / tokenId (Beezie) — for the card link where supported
  name: string | null;
  image: string | null;
  fmvUsd: number;
  grade: string | null;
};

/** One band of a pack's odds — a rarity tier (stated) or a value band (realized). */
export type OddsBand = {
  label: string; // "Grail"|"High"|… (Beezie stated) · "5×+"|"2–5×"|… (Phygitals realized)
  pct: number; // share, 0–1
  hit: boolean; // counts as a "good pull" for the headline hit-odds
  minUsd: number | null; // value-band bounds where known
  maxUsd: number | null;
};

/**
 * One pack on one platform. Carries the full comparison dimension set, with
 * advertised and realized sides held separately + basis tags.
 */
export type GachaPack = {
  /** Durable id: `${platform}:${category}:${price}`. clawId is NOT used (it rotates). */
  id: string;
  platform: string; // collector-crypt | beezie | phygitals
  platformName: string;
  platformShort: string;
  chain: Chain;
  category: string | null; // pokemon | one_piece | null
  categoryLabel: string; // "Pokémon" | "One Piece" | "Mixed" | "—"
  /** Category is INFERRED (slug/card names), not authoritative — disclosed in UI. */
  categoryDerived: boolean;
  name: string; // "Mythic Pack" | "Platinum TCG"
  image: string | null; // pack art where available
  priceUsd: number;
  currency: string;
  /** graded-single | sealed | mixed — affects liquidity/grading upside. null = unknown. */
  packType: "graded-single" | "sealed" | "mixed" | null;

  // ── Advertised (vendor-stated) ──
  topHitsAvailable: PackHit[]; // the chase pool / grails, ranked by value desc
  topHitAvailableUsd: number | null;
  poolDepth: number | null; // # of top prizes still listed in the pool
  oddsStated: OddsBand[] | null;
  hitOddsStated: number | null; // P(good pull) from stated odds
  evStated: number | null; // gross EV multiple (averageValue / price)
  evStatedUsd: number | null; // stated expected value in $ per pack (vendor)
  /** Typical/common floor (Beezie priceRanges.fromBase). NOT derived from chase. */
  floorUsd: number | null;
  stockCount: number | null;

  // ── Buyback (instant cash-out) ──
  buybackPct: number | null; // e.g. 0.94 (Beezie) / 0.90 (Phygitals)
  buybackBasis: MetricBasis;

  // ── Realized (measured on-chain) ──
  topHitRealized: PackHit | null; // biggest actually pulled so far
  topHitRealizedUsd: number | null;
  oddsRealized: OddsBand[] | null;
  hitOddsRealized: number | null;
  /** Realized prize-value distribution in the CANONICAL 5 bands (5×+ / 2–5× /
   *  1–2× / ½–1× / <½×) — row-aligned across platforms for side-by-side
   *  comparison. Phygitals + CC (measured); null where no per-pull data. */
  valueBands: OddsBand[] | null;
  evRealized: number | null; // mean(fmv)/price
  medianReturn: number | null; // median(fmv/price) — the TYPICAL outcome, not the mean
  realizedN: number | null; // sample size behind the realized numbers
  realizedWindow: string | null; // e.g. "7d"
  pulls24h: number | null; // popularity / liquidity
  /** True when pulls24h is a rate ESTIMATE (complete window < 24h), not a count. */
  pulls24hEstimated?: boolean;

  // ── Provenance ──
  evBasis: MetricBasis; // basis of the EV the UI should lead with
  oddsBasis: MetricBasis;
  /** True for CC: only platform-wide data exists; render in a "not pack-attributable" lane. */
  notDirectlyComparable: boolean;
  asOf: string; // ISO — when this pack's data was sourced
  sources: { advertised: string | null; realized: string | null };
};

/**
 * One prize sitting in an ADVERTISED pool — the unit of the "find your chase"
 * grid. Strictly stated-basis: these are what the platforms publish as
 * winnable right now (Phygitals /vm/chase top ~60 per pack, Beezie grail
 * tiers). Collector Crypt publishes no pool, so it can never appear here —
 * the UI must say so rather than imply completeness.
 */
export type GachaPrize = {
  id: string; // pg mint / bz tokenId — card-page link where supported
  name: string | null;
  image: string | null;
  fmvUsd: number; // platform-advertised value (PH fmv / BZ swapValue)
  grade: string | null;
  /** Beezie pool tier ("Grail" | "High" | "Mid"); null for Phygitals chase. */
  tier: string | null;
  /** Searchable trait strings from on-chain metadata ("Grader PSA",
   *  "Set Name Lost Thunder", …). Beezie only — Phygitals encodes its traits
   *  in the card name itself. */
  traits: string[] | null;
  /** True = ALREADY WON (CC pulled example — pool not published, so its top
   *  pulls stand in). Badged in the UI; never presented as available. */
  pulled?: boolean;
  /** The pack holding it — joins GachaPack.id so the UI can open its drawer. */
  packId: string;
  platform: string;
  platformShort: string;
  packName: string;
  priceUsd: number;
  category: string | null;
};

export type GachaPacksSnapshot = {
  generatedAt: string;
  /** Honest window the realized side rests on (never assumed). */
  window: { fromISO: string | null; toISO: string | null; hours: number | null; pulls: number };
  packs: GachaPack[];
  /** Flat searchable index of every advertised prize (absent on old snapshots). */
  prizes?: GachaPrize[];
};

export async function readGachaPacks(): Promise<GachaPacksSnapshot | null> {
  return readSnapshot<GachaPacksSnapshot>(GACHA_PACKS_KEY);
}

export async function writeGachaPacks(snap: GachaPacksSnapshot): Promise<void> {
  await writeSnapshot(GACHA_PACKS_KEY, snap, snap.generatedAt);
}
