/**
 * Collector Crypt MARKETPLACE API client — api.collectorcrypt.com.
 *
 * This is the NestJS backend behind the main site's card marketplace, distinct
 * from the gacha app (gacha.collectorcrypt.com, see ./gacha.ts). Public read;
 * needs a browser UA + Origin. Endpoint captured from the live site 2026-06-22.
 *
 *   GET /marketplace?page&step&cardType=Card&orderBy=listedDateDesc
 *     → LISTED cards only (each row carries a `listing`), 96 per page — the API
 *       rejects larger `step` with HTTP 400. `listing.price` is already whole
 *       USD (currency USDC). `nftAddress` is the Solana mint. findTotal = listed
 *       count (~57.8K), totalPages = ceil(findTotal/step).
 */
const BASE = "https://api.collectorcrypt.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  Accept: "application/json",
  Origin: "https://collectorcrypt.com",
  Referer: "https://collectorcrypt.com/",
};

/** API caps page size at 96 (>96 → HTTP 400). */
export const CC_MARKETPLACE_STEP = 96;

export type CCListingCard = {
  /** Solana mint — the card's tokenId. */
  nftAddress: string;
  /** Active listing price in USD (listing.price is already whole USDC). */
  priceUsd: number;
  /** CC's own FMV basis, where present. */
  insuredValueUsd: number | null;
};

type RawCard = {
  nftAddress?: string;
  insuredValue?: string | null;
  listing?: { price?: number; currency?: string } | null;
};
type RawResp = { findTotal?: number; totalPages?: number; filterNFtCard?: RawCard[] };

/**
 * One page of LISTED cards. Rows without a numeric `listing.price` are dropped
 * (defensive — the query only returns listed cards, but the field is optional
 * in the raw shape). Throws on non-200.
 */
export async function fetchCCListingsPage(
  page: number,
  step = CC_MARKETPLACE_STEP,
): Promise<{ cards: CCListingCard[]; totalPages: number; findTotal: number }> {
  const url = `${BASE}/marketplace?page=${page}&step=${step}&cardType=Card&orderBy=listedDateDesc`;
  const res = await fetch(url, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`CC /marketplace ${res.status}`);
  const d = (await res.json()) as RawResp;
  const cards: CCListingCard[] = [];
  for (const c of d.filterNFtCard ?? []) {
    const mint = c.nftAddress;
    const price = c.listing?.price;
    if (!mint || typeof price !== "number" || !Number.isFinite(price)) continue;
    cards.push({
      nftAddress: mint,
      priceUsd: price,
      insuredValueUsd: c.insuredValue != null ? Number(c.insuredValue) || null : null,
    });
  }
  return { cards, totalPages: Number(d.totalPages ?? 0), findTotal: Number(d.findTotal ?? 0) };
}
