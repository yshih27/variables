/**
 * Collector Crypt gacha snapshot store — Postgres `snapshots` blob, key='gacha:cc'.
 *
 * The page-facing view of CC's NATIVE gacha API (gacha.collectorcrypt.com),
 * which replaced the Dune-only platform-grain view: per-PACK stated odds/EV/
 * buyback from the machine catalog + per-pack REALIZED stats measured from the
 * winners feed. fetchGacha/gachaPacks read this; the durable per-pull spine
 * lands in gacha_pulls (see warmers/ccGacha.ts).
 *
 * Honesty note: the realized side is computed over each pack's COMPLETE-coverage
 * window (the winners feed serves most-recent-N per tier, a stratified sample —
 * naive aggregation would overweight rare tiers). `n` and `windowHours` ride
 * along so the UI can flag thin samples.
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";
import type { GachaBigHit } from "./gachaDuneCache";
import type { CCTierKey } from "../cc/gacha";

export const CC_GACHA_KEY = "gacha:cc";

/** One stated odds band (a rarity tier with its prize-value $ range). */
export type CCOddsBand = {
  tier: CCTierKey;
  pct: number; // stated probability 0–1
  minUsd: number | null;
  maxUsd: number | null;
};

export type CCRealized = {
  /** Pulls inside the complete-coverage window (all carry insuredValue). */
  n: number;
  windowHours: number | null;
  fromISO: string | null;
  evMultiple: number | null; // mean(insuredValue / price)
  medianReturn: number | null; // median(insuredValue / price)
  odds: { tier: CCTierKey; pct: number }[] | null; // realized tier shares
  hitOdds: number | null; // share above common
  /** Realized prize-value distribution in the CANONICAL value bands
   *  (5×+ / 2–5× / 1–2× / ½–1× / <½×, shared with Phygitals) — lets CC packs
   *  align row-for-row in cross-platform odds-breakdown comparisons. */
  valueBands: { label: string; pct: number; hit: boolean }[] | null;
  /** Pulls in the last 24h — exact when the window covers 24h, else a rate
   *  estimate (n / windowHours × 24), flagged. */
  pulls24h: number | null;
  pulls24hEstimated: boolean;
  /** Biggest prize pulled (all-time max seen, merged across runs). */
  topHit: {
    mint: string;
    name: string | null;
    image: string | null;
    valueUsd: number;
    at: string;
  } | null;
  /** Top pulled cards (by value) from this run's winners sample — PULLED
   *  examples of what the machine pays, with art. CC publishes no pool, so
   *  these stand in for it downstream, always labeled as already-won. */
  examples: { mint: string; name: string | null; image: string | null; valueUsd: number; at: string }[];
};

export type CCGachaPack = {
  code: string; // durable machine id, e.g. "pokemon_250"
  name: string; // shortName, e.g. "PKMN 250"
  fullName: string; // "Elite Pokémon Gacha Pack"
  category: string | null; // pokemon | one_piece | sports | pop
  priceUsd: number;
  image: string; // pack art (gacha.collectorcrypt.com/{code}.png)
  packType: "graded-single" | "sealed";
  turbo: boolean;
  /** Most recent pull seen (ISO) — the liveness signal. Public machines with no
   *  recent pull are archived (rotated off the menu) and not emitted. */
  lastPullAt: string | null;
  // ── Stated (vendor) ──
  oddsStated: CCOddsBand[]; // rarest → commonest
  hitOddsStated: number | null; // = bigWinChance / 100 (share above common)
  evStatedMultiple: number | null; // targetEV / price
  maxEvMultiple: number | null; // maxEV / price
  buybackPct: number | null; // instantBuyback.percentageOfValue / 100
  // ── Realized (measured from the winners feed) ──
  realized: CCRealized | null;
};

export type CCGachaSnapshot = {
  generatedAt: string;
  /** The raw winners sample this run drew (provenance, not a claim of coverage). */
  sample: { pulls: number; perTier: number; fromISO: string | null; toISO: string | null };
  /** Public machines only (private ones aren't purchasable). */
  packs: CCGachaPack[];
  /** Windowed biggest hits with art, GachaBigHit-shaped for the coverflow. */
  bigHits: GachaBigHit[];
};

export async function readCCGacha(): Promise<CCGachaSnapshot | null> {
  return readSnapshot<CCGachaSnapshot>(CC_GACHA_KEY);
}

export async function writeCCGacha(snap: CCGachaSnapshot): Promise<void> {
  await writeSnapshot(CC_GACHA_KEY, snap, snap.generatedAt);
}
