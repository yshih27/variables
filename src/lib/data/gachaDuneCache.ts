/**
 * Gacha snapshot store — backed by Postgres (`snapshots` table, key='gacha').
 *
 * Migrated from local disk (.cache/gacha-dune.json) to the dedicated Supabase
 * DB so the cron warmer and the page reads share one source of truth across
 * serverless instances. The reader/writer signatures are unchanged, so
 * fetchGacha and the warmer are untouched (the migration "seam" — see
 * MIGRATION_PLAN.md §2).
 *
 * Populated by runGachaWarm() (scripts/warm-gacha-dune.ts CLI or the
 * /api/cron/gacha route), read by fetchGacha.
 */
import { db } from "../db/client";

const SNAPSHOT_KEY = "gacha";

export type GachaPriceBucket = {
  /** Pack price in whole USD. */
  price: number;
  pulls24h: number;
  vol24h: number;
  pulls7d: number;
  vol7d: number;
  pulls30d: number;
  vol30d: number;
};

/** Realized odds for one tier — a rarity tier (CC) or a prize-value band (Phygitals). */
export type GachaOddsTier = {
  tier: string; // CC: Low|Mid|High|Epic|LGND|SPrT · Phygitals: "5×+"|"2–5×"|…
  prizes24h: number;
  prizes7d: number;
  prizes30d: number;
  /** Share of prizes in the window (the headline odds), 0–1. */
  pct: number;
  /** Whether this tier counts as "a hit" for the spend-decider. When unset, the
   *  decider falls back to the CC HIT_TIERS allowlist (Epic/LGND/SPrT). */
  hit?: boolean;
};

/** Provenance for a platform's odds — lets the UI label them honestly instead of
 *  hardcoding CC's "realized 7d · on-chain prize delivery". */
export type GachaOddsMeta = {
  /** Window label, e.g. "realized 7d" (CC) or "last ~15h" (Phygitals feed). */
  window: string;
  /** Basis label, e.g. "on-chain prize delivery" or "realized pull value". */
  basis: string;
};

export type GachaDunePlatform = {
  /** "gacha" = pack-pull spend (Courtyard included: aggregate on-chain volume,
   *  no per-tier rows); "tokenization" = pay-to-vault (reserved; unused as of R5
   *  after Courtyard was reclassified gacha per the product owner + $64-avg data). */
  kind: "gacha" | "tokenization";
  pulls24h: number;
  vol24h: number;
  pulls7d: number;
  vol7d: number;
  pulls30d: number;
  vol30d: number;
  /** Per-price-tier breakdown, sorted by 30d volume desc. Empty for aggregate-only
   *  platforms (Courtyard), whose Dune query returns one summary row, not tiers. */
  byPrice: GachaPriceBucket[];
  /** Realized odds, rarest/best→commonest. CC: rarity tiers (on-chain wallets);
   *  Phygitals: prize-value bands (from the CLAW feed). null where neither exists. */
  odds?: GachaOddsTier[];
  /** Provenance for `odds` — window + basis, so the UI never mislabels the source. */
  oddsMeta?: GachaOddsMeta;
  /**
   * Buyback — USDC paid back to players who instantly cashed out a pull.
   * Net house revenue = vol − payout. Present only where the buyback wallet
   * is known on-chain (CC, Phygitals).
   */
  buyback?: {
    payout24h: number;
    payout7d: number;
    payout30d: number;
    count24h: number;
    count7d: number;
    count30d: number;
  };
};

/** A biggest-hit: a high-value NFT delivered as a gacha prize. */
export type GachaBigHit = {
  platform: string;
  mint: string;
  name: string;
  tier: string;
  /** Insured-value FMV of the card pulled, USD. */
  valueUsd: number;
  image: string | null;
  imageFallback: string | null;
  /** ISO timestamp the prize was delivered. */
  at: string;
  /** Display name of the pack/machine the hit came out of (where known). */
  pack?: string | null;
};

export type GachaDuneSnapshot = {
  generatedAt: string;
  /** Keyed by platform key (collector-crypt | beezie | phygitals | courtyard). */
  platforms: Record<string, GachaDunePlatform>;
  /** Biggest hits across platforms, ranked by FMV desc. */
  bigHits: GachaBigHit[];
};

export async function readGachaDune(): Promise<GachaDuneSnapshot | null> {
  const { data, error } = await db()
    .from("snapshots")
    .select("payload")
    .eq("key", SNAPSHOT_KEY)
    .maybeSingle();
  if (error) {
    console.warn(`[gachaDuneCache] read failed: ${error.message}`);
    return null;
  }
  return (data?.payload as GachaDuneSnapshot) ?? null;
}

export async function writeGachaDune(snap: GachaDuneSnapshot): Promise<void> {
  const { error } = await db()
    .from("snapshots")
    .upsert({ key: SNAPSHOT_KEY, payload: snap, generated_at: snap.generatedAt });
  if (error) throw new Error(`[gachaDuneCache] write failed: ${error.message}`);
}
