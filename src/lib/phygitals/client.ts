/**
 * Phygitals marketplace API client (api.phygitals.com).
 *
 * Public read endpoints (need a browser UA + Origin). Lights up Phygitals'
 * cards, floor, and FMV — data we previously had none of. The listings feed
 * AGGREGATES Solana marketplaces (Tensor, Magic Eden, native). Gacha aggregates
 * stay on Dune; this client is marketplace/listings + the headline totals.
 *
 * Note: Phygitals cards are compressed NFTs (cNFT). The listings sort
 * price-low-high, so page 1 ≈ the floor.
 */
const BASE = "https://api.phygitals.com/api/marketplace";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  Origin: "https://www.phygitals.com",
  Referer: "https://www.phygitals.com/",
  Accept: "application/json",
};

/** Phygitals collection mints (cNFT) — discovered from the marketplace API. */
export const PHYGITALS_COLLECTIONS = [
  "BSG6DyEihFFtfvxtL9mKYsvTwiZXB1rq5gARMTJC2xAM",
  "phygZDQZJZVHvJGYPGoKPYUtXw7mstSYtTtcuh8LJcC",
];

export type PhygitalsListing = {
  address: string; // Solana mint
  name?: string;
  image?: string; // irys gateway
  slug?: string;
  price?: string; // USDC raw (/1e6)
  altFmv?: string | null;
  fmv_override?: boolean;
  marketplace?: string; // TENSOR | MAGIC_EDEN | native
  currency?: string;
  token_standard?: string; // CNFT
  collection_address?: string;
  listed?: boolean;
  properties?: { category?: unknown; files?: unknown; creators?: unknown };
  metadata?: unknown;
};

export type PhygitalsSale = {
  txid: string;
  time: string; // ISO
  amount: string; // USDC raw
  type: string; // CLAW (pull) | BUY (buyback) | …
  from: string;
  to: string;
  clawId?: string | null; // gacha pack id when present
  currency?: string;
  nft?: { address: string; name?: string; image?: string };
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`Phygitals ${res.status} on ${url.replace(BASE, "")}`);
  return (await res.json()) as T;
}

/**
 * One page of active marketplace listings (sorted cheapest-first).
 * `total` is the count of all matching listings (for pagination).
 */
export async function fetchPhygitalsListings(
  page = 1,
  itemsPerPage = 100,
  metadataConditions: Record<string, unknown> = {},
): Promise<{ listings: PhygitalsListing[]; total: number }> {
  const params = new URLSearchParams({
    searchTerm: "",
    sortBy: "price-low-high",
    itemsPerPage: String(itemsPerPage),
    page: String(page),
    metadataConditions: JSON.stringify(metadataConditions),
    priceRange: "[null,null]",
    fmvRange: "[null,null]",
    listedStatus: "listed",
    collectionAddresses: JSON.stringify(PHYGITALS_COLLECTIONS),
  });
  const d = await getJson<{ listings?: PhygitalsListing[]; amount?: number }>(
    `${BASE}/marketplace-listings?${params.toString()}`,
  );
  return { listings: d.listings ?? [], total: Number(d.amount ?? 0) };
}

/**
 * Recent sales feed (gacha-dominated: CLAW pulls + BUY buybacks, clawId-tagged;
 * peer-to-peer marketplace sales are rare). Fixed 10/page. Also carries the
 * headline totals we surface on the platform page.
 */
export async function fetchPhygitalsSales(page = 0): Promise<{
  sales: PhygitalsSale[];
  totalVolume: number;
  totalActiveListingsCount: number;
}> {
  const d = await getJson<{
    sales?: PhygitalsSale[];
    totalVolume?: number;
    totalActiveListingsCount?: number;
  }>(`${BASE}/sales?page=${page}`);
  return {
    sales: d.sales ?? [],
    totalVolume: Number(d.totalVolume ?? 0),
    totalActiveListingsCount: Number(d.totalActiveListingsCount ?? 0),
  };
}
