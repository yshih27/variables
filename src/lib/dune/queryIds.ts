/**
 * Dune query IDs powering the gacha page.
 *
 * Created via the Dune API from the team's validated SQL. Private queries
 * named "TCG.market — …" in the Dune workspace. To inspect/edit, open
 * https://dune.com/queries/<id>.
 *
 * Pulls queries return per-price-tier rows:
 *   { pack_price, pulls_7d, volume_7d, pulls_24h, volume_24h }
 * Courtyard (tokenization) returns a single aggregate row:
 *   { txns_7d, volume_7d, txns_24h, volume_24h }
 */
export const GACHA_QUERY_IDS = {
  "collector-crypt": 7642633,
  beezie: 7642705,
  phygitals: 7642707,
  courtyard: 7642710,
} as const;

export type GachaQueryPlatform = keyof typeof GACHA_QUERY_IDS;

/**
 * Realized rarity-tier odds (CC only — it's the one platform whose prize
 * inventory is split into named tier wallets). Returns per-tier prize counts
 * for 24h/7d/30d. 7d is the headline window (24h is small-sample; 30d can
 * include occasional bulk inventory moves).
 */
export const CC_ODDS_QUERY_ID = 7643215;

/**
 * High-tier prize deliveries (Epic/LGND/SPrT) last 7d → the big-hit
 * candidates. Returns (block_time, mint, tier); the warmer joins each mint to
 * its Insured Value + name + image from the local cc-traits cache and ranks.
 */
export const CC_BIG_HITS_QUERY_ID = 7643571;

/**
 * Buyback payouts — USDC sent FROM a platform's gacha wallets back to players
 * (instant cash-out of a pulled card), excluding internal/house wallets.
 * Net house revenue = gacha spend − buyback payout. Returns 24h/7d/30d
 * payout volume + count. Only where the buyback wallet is known on-chain.
 */
export const BUYBACK_QUERY_IDS = {
  "collector-crypt": 7644128,
  phygitals: 7644129,
} as const;
