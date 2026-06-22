/**
 * Beezie Claw (gacha) API client — api.beezie.com/claw.
 *
 * Beezie's gacha is uniquely generous with ADVERTISED data: one unauthenticated
 * call (browser UA + Origin) returns the whole pack catalog with stated odds per
 * tier, an averageValue (vendor EV), per-tier value bands, the standing grail
 * prize pool, swap fees (→ buyback %), and live stock. There is NO realized
 * pull-history endpoint (pulls are on-chain only) — so everything here is
 * vendor-STATED and must be labeled as such downstream.
 *
 * The grail items carry only {tokenId, swapValue} — no card name. The image
 * resolves from the tokenId via the CDN (the /4/512.webp thumb is reliable; the
 * /2/original.jpg full-size 403s for some tokens, so we use the thumb).
 */
const BASE = "https://api.beezie.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  Origin: "https://beezie.com",
  Referer: "https://beezie.com/",
  Accept: "application/json",
};

/** One prize in a claw's standing grail pool. swapValue is USDC raw (/1e6). */
export type BeezieGrail = { tokenId: number; swapValue: number };

/** Stated odds % per tier (strings that sum to ~100). */
export type BeezieOdds = {
  base: string;
  low: string;
  medium: string;
  high: string;
  grails: string;
};

/** Per-tier value band in whole USD (from..to). */
export type BeeziePriceRanges = {
  fromBase: number;
  toBase: number;
  fromLow: number;
  toLow: number;
  fromMedium: number;
  toMedium: number;
  fromHigh: number;
  toHigh: number;
  fromGrails: number;
  toGrails: number;
};

export type BeezieClaw = {
  id: number;
  name: string;
  contractAddress: string;
  status: string; // active | …
  isVisible?: boolean;
  description?: string | null;
  priceUsdc: number; // USDC raw (/1e6) = pull price
  averageValue: number; // vendor-stated EV in whole USD (~1.10× price)
  clawStockCount: number;
  maximumSimultaneousPullCount?: number;
  odds: BeezieOdds;
  priceRanges: BeeziePriceRanges;
  /** Standing top-prize pool by tier. base/low (commons) are not enumerated. */
  grails: { grails?: BeezieGrail[]; high?: BeezieGrail[]; medium?: BeezieGrail[] };
  swapFees?: { wallets: string[]; percentages: number[] };
  buyCommission?: number | null;
  maximumDiscountRate?: number | null;
};

/** Image for a Beezie token — the /4/512.webp thumb is the reliable form. */
export function beezieImage(tokenId: number): string {
  return `https://images.beezie.com/base/${tokenId}/4/512.webp`;
}

/** Fetch the full Claw catalog (4 active claws today). Throws on non-200. */
export async function fetchBeezieClaws(): Promise<BeezieClaw[]> {
  const res = await fetch(`${BASE}/claw`, { headers: HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`Beezie /claw ${res.status}`);
  const d = (await res.json()) as { claws?: BeezieClaw[] };
  return d.claws ?? [];
}
