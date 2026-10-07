/**
 * Renaiss marketplace sales — the feed, the `renaiss_sales` row store, and the
 * reads the sale panel, core-volume and the daily spine take from it.
 *
 * Upstream (`GET /v1/renaiss/sales`, spec'd in /v1/openapi.json): every sale on
 * the Renaiss marketplace on BNB Smart Chain, OLDEST first, one row per
 * `TradeExecutedV2` log: `id` = `{txHash}:{logIndex}`, the token, both wallets,
 * the price in the payment token (`currency` USDT) as a decimal string and in
 * USD cents, and the slab + catalog card once the index has linked them. The
 * seller's fee is not in the row, so a sale is recorded at the buyer-paid price.
 *
 * ⚠️ NO REQUEST PATH CALLS THE API. `readRenaissSales` reads the row store the
 * warmer fills; the API client lives behind the warmer only.
 */
import { renaissGet, RENAISS_PAGE_SIZE, type FeedPage, type FeedQuery, type RenaissEnv } from "./client";
import type { FeedCatalogCard, FeedSlab } from "./cards";
import { db } from "../db/client";
import { cleanSecondarySales, type HygieneStats } from "../data/secondaryHygiene";
import type { NormalizedSale } from "../rarible/queries";

/** A sale as the feed returns it. */
export type RenaissSaleRow = {
  id: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  soldAt: string;
  contract: string;
  tokenId: string;
  seller: string | null;
  buyer: string | null;
  currency: string;
  price: string | null;
  priceUsdCents: number | null;
  slab: FeedSlab | null;
  catalogCard: FeedCatalogCard | null;
};

type SalesResponse = { sales?: RenaissSaleRow[]; nextCursor?: string | null; hasMore?: boolean };

/** A sale as `renaiss_sales` stores it. */
export type RenaissStoredSale = {
  sale_id: string;
  block_number: number;
  sold_at: string;
  contract: string;
  token_id: string;
  seller: string | null;
  buyer: string | null;
  currency: string;
  price: string | null;
  price_usd: number | null;
  cert: string | null;
  grader: string | null;
  grade_raw: string | null;
  catalog_id: string | null;
  renaiss_item_id: string | null;
  card_name: string | null;
  set_name: string | null;
  set_code: string | null;
  card_number: string | null;
  year: number | null;
  language: string | null;
  image_url: string | null;
  raw: RenaissSaleRow;
};

const lower = (s: string | null | undefined): string | null => (s ? s.toLowerCase() : null);

/**
 * One feed row → its stored row. `price_usd` is `priceUsdCents / 100`: USDT is
 * counted as dollars, as USDC is everywhere else (the migration says so once).
 * Wallets are lowercased so the hygiene pass compares like with like.
 */
export function toStoredSale(r: RenaissSaleRow): RenaissStoredSale {
  const cents = r.priceUsdCents;
  return {
    sale_id: r.id,
    block_number: r.blockNumber,
    sold_at: r.soldAt,
    contract: r.contract,
    token_id: r.tokenId,
    seller: lower(r.seller),
    buyer: lower(r.buyer),
    currency: r.currency,
    price: r.price,
    price_usd: typeof cents === "number" && Number.isFinite(cents) ? cents / 100 : null,
    cert: r.slab?.cert ?? null,
    grader: r.slab?.company ?? null,
    grade_raw: r.slab?.grade ?? null,
    catalog_id: r.catalogCard?.id ?? null,
    renaiss_item_id: r.catalogCard?.renaissItemId ?? null,
    card_name: r.catalogCard?.name ?? null,
    set_name: r.catalogCard?.setName ?? null,
    set_code: r.catalogCard?.setCode ?? null,
    card_number: r.catalogCard?.cardNumber ?? null,
    year: r.catalogCard?.year ?? null,
    language: r.catalogCard?.language ?? null,
    image_url: r.catalogCard?.imageUrl ?? null,
    raw: r,
  };
}

/** The slab + card of a linked row, for its `cards` row; null for an unlinked one. */
export function linkedCardOfSale(r: RenaissSaleRow): { tokenId: string; slab: FeedSlab; card: FeedCatalogCard } | null {
  return r.slab && r.catalogCard ? { tokenId: r.tokenId, slab: r.slab, card: r.catalogCard } : null;
}

/** One page of the sales feed. */
export async function fetchSalesPage(q: FeedQuery, env: RenaissEnv = process.env): Promise<FeedPage<RenaissSaleRow>> {
  const { body, rate } = await renaissGet<SalesResponse>(
    "/renaiss/sales",
    { after: q.after, from: q.from, limit: q.limit ?? RENAISS_PAGE_SIZE },
    { env },
  );
  return { rows: body.sales ?? [], nextCursor: body.nextCursor ?? null, hasMore: Boolean(body.hasMore), rate };
}

// ── Row store ─────────────────────────────────────────────────────────────

/** Upsert on `sale_id`, so an overlapping page (or the whole backfill, re-run) is a no-op. */
export async function upsertRenaissSales(rows: RenaissStoredSale[]): Promise<number> {
  if (!rows.length) return 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db().from("renaiss_sales").upsert(rows.slice(i, i + CHUNK), { onConflict: "sale_id" });
    if (error) throw new Error(`[renaiss_sales] upsert failed: ${error.message}`);
  }
  return rows.length;
}

/** Newest `sold_at` we hold — the incremental cursor. Null when the store is empty. */
export async function latestStoredSoldAt(): Promise<string | null> {
  const { data, error } = await db()
    .from("renaiss_sales")
    .select("sold_at")
    .order("sold_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`[renaiss_sales] cursor read failed: ${error.message}`);
  return (data?.sold_at as string | undefined) ?? null;
}

/** Oldest `sold_at` we hold — where the daily resale series starts. Null when the store is empty. */
export async function oldestStoredSoldAt(): Promise<string | null> {
  const { data, error } = await db()
    .from("renaiss_sales")
    .select("sold_at")
    .order("sold_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`[renaiss_sales] oldest read failed: ${error.message}`);
  return (data?.sold_at as string | undefined) ?? null;
}

const DAY_MS = 86_400_000;

/**
 * Where an incremental run starts: a day before the newest stored sale. The
 * overlap re-reads rows already stored, and the upsert on `sale_id` makes that
 * free; it covers a sale the index linked or wrote a little late.
 */
export function salesIncrementalFrom(newestSoldAt: string | null): string | null {
  const t = newestSoldAt ? Date.parse(newestSoldAt) : NaN;
  return Number.isFinite(t) ? new Date(t - DAY_MS).toISOString() : null;
}

type ReadRow = Pick<RenaissStoredSale, "sale_id" | "sold_at" | "token_id" | "buyer" | "seller" | "price_usd">;

/** Stored rows since `since` (ISO), oldest first, paged past PostgREST's 1,000-row cap. */
async function readStored(since: string | null): Promise<ReadRow[]> {
  const PAGE = 1000;
  const out: ReadRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db()
      .from("renaiss_sales")
      .select("sale_id, sold_at, token_id, buyer, seller, price_usd")
      .order("sold_at", { ascending: true })
      .order("sale_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (since) q = q.gte("sold_at", since);
    const { data, error } = await q;
    if (error) throw new Error(`[renaiss_sales] read failed: ${error.message}`);
    const rows = (data ?? []) as ReadRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Stored rows → the shared sale shape, priced rows only. */
export function toNormalizedSales(rows: ReadRow[]): NormalizedSale[] {
  const out: NormalizedSale[] = [];
  for (const r of rows) {
    const usd = Number(r.price_usd);
    if (!(usd > 0)) continue;
    out.push({ date: new Date(r.sold_at).toISOString(), tokenId: r.token_id, buyer: r.buyer ?? "", seller: r.seller ?? "", priceUsd: usd });
  }
  return out;
}

/**
 * Renaiss sales since `sinceMs` (all of them when omitted) as `NormalizedSale`,
 * through the same hygiene every feed passes (`cleanSecondarySales`: duplicates,
 * self-trades, wallet-pair ring washes, one-seller bulk sweeps). The sale
 * panel's leg, the core-volume entry and the daily spine all read it here, so
 * the three count the same rows.
 */
export async function readRenaissSales(opts: { sinceMs?: number } = {}): Promise<{ sales: NormalizedSale[]; stats: HygieneStats }> {
  const since = opts.sinceMs != null ? new Date(opts.sinceMs).toISOString() : null;
  return cleanSecondarySales(toNormalizedSales(await readStored(since)));
}
