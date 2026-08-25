/**
 * DYLI active listings — GET /listings, paged through the shared 2.2s pacer.
 *
 * One row per PRODUCT, not per order: a product with two open orders comes back
 * once, carrying `listing_count: 2`, `quantity_available: 2` and `price` = the
 * cheapest of them. That shape is what makes a floor and a listed-inventory
 * value derivable in one pass — and it is also the trap, because summing `price`
 * across rows would undercount a product with several units.
 *
 * ⚠️ eBay stock is excluded UPSTREAM here, unlike /sales. The feed echoes its own
 * `filters.excluded_marketplaces` and /overview documents
 * `listings_exclude_marketplaces: ["eBay"]` as applying to THIS route. We assert
 * that echo rather than trusting it (see `fetchAllListings`) — if DYLI ever stops
 * excluding, external inventory would silently inflate DYLI's market cap.
 */
import { dyliGet } from "./client";

/** Server page cap. /sales clamps at 200; /listings is the same family. */
export const DYLI_LISTINGS_PAGE_SIZE = 200;

/** A listing row, restricted to the fields this integration reads. */
export type DyliListing = {
  listing_id: string;
  product_id: number;
  token_id: string | null;
  name: string | null;
  market_type: string | null;
  source_marketplace: string | null;
  /** Cheapest active order for this product, in `currency`. */
  price: number | null;
  currency: string | null;
  quantity_available: number | null;
  listing_count: number | null;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  cert: string | null;
};

type ListingsResponse = {
  listings?: Partial<DyliListing>[];
  pagination?: { page: number; page_size: number; total: number; has_more: boolean };
  filters?: { excluded_marketplaces?: string[] };
  summary?: { returned?: number; primary_rows?: number; secondary_rows?: number };
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function toListing(r: Partial<DyliListing>): DyliListing {
  return {
    listing_id: String(r.listing_id ?? ""),
    product_id: Number(r.product_id),
    token_id: r.token_id != null ? String(r.token_id) : null,
    name: r.name ?? null,
    market_type: r.market_type ?? null,
    source_marketplace: r.source_marketplace ?? null,
    price: num(r.price),
    currency: r.currency ?? null,
    quantity_available: num(r.quantity_available),
    listing_count: num(r.listing_count),
    brand: r.brand ?? null,
    category: r.category ?? null,
    subcategory: r.subcategory ?? null,
    cert: r.cert != null ? String(r.cert) : null,
  };
}

export type ListingsPage = {
  rows: DyliListing[];
  page: number;
  total: number;
  hasMore: boolean;
  excludedMarketplaces: string[];
};

export async function fetchListingsPage(page: number, pageSize = DYLI_LISTINGS_PAGE_SIZE): Promise<ListingsPage> {
  const res = await dyliGet<ListingsResponse>("/listings", { page, pageSize });
  const p = res.pagination;
  return {
    rows: (res.listings ?? []).map(toListing),
    page: p?.page ?? page,
    total: p?.total ?? 0,
    hasMore: Boolean(p?.has_more),
    excludedMarketplaces: res.filters?.excluded_marketplaces ?? [],
  };
}

export type ListingsSweep = {
  rows: DyliListing[];
  total: number;
  pages: number;
  excludedMarketplaces: string[];
};

/**
 * Every active listing. Small by design — the whole book was 298 rows when this
 * was built, i.e. two requests. `maxPages` is a runaway guard, not a sample cap:
 * a partial sweep must never reach the aggregate below, because a market cap
 * built from half the book is not a smaller market cap, it is a wrong one.
 */
export async function fetchAllListings(maxPages = 50): Promise<ListingsSweep> {
  const rows: DyliListing[] = [];
  let total = 0;
  let pages = 0;
  let excluded: string[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchListingsPage(page);
    pages = page;
    total = res.total;
    if (page === 1) excluded = res.excludedMarketplaces;
    rows.push(...res.rows);
    if (!res.hasMore || !res.rows.length) break;
  }
  if (rows.length < total) {
    throw new Error(
      `[dyli/listings] incomplete sweep: ${rows.length}/${total} rows after ${pages} page(s). ` +
        `Refusing to aggregate a partial book — raise maxPages or investigate pagination.`,
    );
  }
  return { rows, total, pages, excludedMarketplaces: excluded };
}

export type ListingsAggregate = {
  /** Cheapest active listing across the book, USD. Null when nothing is priced. */
  floorUsd: number | null;
  /** Σ price × quantity_available — the value of LISTED inventory at ask. */
  listedValueUsd: number;
  /** Σ quantity_available — units, not products. */
  listedUnits: number;
  /** Distinct products with at least one priced, in-stock listing. */
  products: number;
  /** Rows dropped, by reason — surfaced so an exclusion is never silent. */
  skipped: Record<string, number>;
  /** Non-USD-pegged currencies seen, with counts. Empty is the expected case. */
  currencies: Record<string, number>;
};

/**
 * DYLI prices in USDC.e — a USD-pegged stablecoin, so `price` is already USD and
 * needs no conversion. Any other currency is NOT silently treated as USD: it is
 * skipped and counted, because quietly assuming parity is how a depegged or
 * token-denominated listing lands in a dollar market cap.
 */
const USD_PEGGED = new Set(["USDC.E", "USDC", "USD", "USDT"]);

/**
 * Dust floor, matching `MIN_PRICE_USD` in scripts/warm-listings.ts.
 *
 * ⚠️ THIS IS ABOUT COMPARABILITY, NOT TIDINESS. Every other platform's floor on
 * the platform table comes from a book already filtered at $1, so an unfiltered
 * DYLI floor would sit in the same column meaning something different. Measured
 * 2026-08-20 the raw book floors at **$0.07** — a single dust listing that would
 * have been published as "DYLI's floor" beside Beezie's and Phygitals'. The
 * value this drops from the market cap is rounding (sub-$1 × a few units); the
 * distortion it prevents is a headline stat off by two orders of magnitude.
 */
export const MIN_LISTING_USD = 1;

export function aggregateListings(rows: DyliListing[]): ListingsAggregate {
  const skipped: Record<string, number> = {};
  const currencies: Record<string, number> = {};
  const skip = (why: string) => {
    skipped[why] = (skipped[why] ?? 0) + 1;
  };

  let floorUsd: number | null = null;
  let listedValueUsd = 0;
  let listedUnits = 0;
  let products = 0;

  for (const r of rows) {
    const cur = (r.currency ?? "").trim().toUpperCase();
    if (cur) currencies[cur] = (currencies[cur] ?? 0) + 1;
    if (!USD_PEGGED.has(cur)) {
      skip(`non-USD currency "${r.currency ?? ""}"`);
      continue;
    }
    const price = r.price;
    if (price == null || !(price > 0)) {
      skip("no positive price");
      continue;
    }
    if (price < MIN_LISTING_USD) {
      skip(`dust (< $${MIN_LISTING_USD})`);
      continue;
    }
    // `quantity_available` is the unit count behind this product's listings. A
    // missing/zero quantity means nothing is actually buyable — not one unit.
    const qty = r.quantity_available;
    if (qty == null || !(qty > 0)) {
      skip("no available quantity");
      continue;
    }
    products += 1;
    listedUnits += qty;
    listedValueUsd += price * qty;
    if (floorUsd == null || price < floorUsd) floorUsd = price;
  }

  return { floorUsd, listedValueUsd, listedUnits, products, skipped, currencies };
}
