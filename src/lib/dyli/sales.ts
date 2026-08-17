/**
 * DYLI sales feed — pagination, lane classification, and the `dyli_sales` row
 * store the daily spine and the core-volume bucket both derive from.
 *
 * Shape of the upstream feed (GET /sales), per its own /overview field
 * reference: one normalized row per sale with `market_type`, `sale_channel`,
 * `sale_event_type` and `source_marketplace` on every row, USD-normalised
 * `price_usd`, and `sale_id` as the stable key. Pagination is page/pageSize
 * with `pagination.{page,page_size,total,has_more}`.
 *
 * ⚠️ pageSize is CAPPED AT 200 server-side (asking for 500/1000/2000 all return
 * 200). At ~400K rows and the 2.2s pacer, a full backfill is ~2,000 requests ≈
 * 75 minutes. That is a one-time cost; the incremental path uses `created_after`
 * and is a handful of requests.
 */
import { dyliGet } from "./client";
import { classifyDyliLane, type DyliLane } from "./lanes";
import { db } from "../db/client";
import type { NormalizedSale } from "../rarible/queries";

/** Server-enforced maximum; asking for more is silently clamped. */
export const DYLI_PAGE_SIZE = 200;

/** A raw row as DYLI returns it (only the fields we persist or classify on). */
export type DyliSaleRow = {
  sale_id: number;
  token_id?: string | null;
  product_id?: number | null;
  product_name?: string | null;
  market_type?: string | null;
  sale_channel?: string | null;
  sale_event_type?: string | null;
  source_marketplace?: string | null;
  sold_at: string;
  price_usd?: number | null;
  buyer?: { wallet?: string | null } | null;
  seller?: { wallet?: string | null } | null;
};

/** A row as we store it — the raw channel fields plus the derived lane. */
export type DyliStoredSale = {
  sale_id: number;
  token_id: string | null;
  product_id: number | null;
  product_name: string | null;
  market_type: string | null;
  sale_channel: string | null;
  sale_event_type: string | null;
  source_marketplace: string | null;
  lane: DyliLane;
  sold_at: string;
  price_usd: number | null;
  buyer: string | null;
  seller: string | null;
};

type SalesResponse = {
  sales?: DyliSaleRow[];
  pagination?: { page: number; page_size: number; total: number; has_more: boolean };
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Classify + normalise one upstream row for storage. */
export function toStoredSale(r: DyliSaleRow): DyliStoredSale {
  const { lane } = classifyDyliLane(r);
  return {
    sale_id: Number(r.sale_id),
    token_id: r.token_id != null ? String(r.token_id) : null,
    product_id: num(r.product_id),
    product_name: r.product_name ?? null,
    market_type: r.market_type ?? null,
    sale_channel: r.sale_channel ?? null,
    sale_event_type: r.sale_event_type ?? null,
    source_marketplace: r.source_marketplace ?? null,
    lane,
    sold_at: r.sold_at,
    price_usd: num(r.price_usd),
    // DYLI nests the wallet under buyer/seller objects; a primary sale has no
    // seller (null) because the inventory is DYLI's own.
    buyer: r.buyer?.wallet ?? null,
    seller: r.seller?.wallet ?? null,
  };
}

export type SalesPage = {
  rows: DyliSaleRow[];
  page: number;
  total: number;
  hasMore: boolean;
};

/** One page of /sales. `createdAfter` is an ISO timestamp (the incremental cursor). */
export async function fetchSalesPage(opts: {
  page: number;
  createdAfter?: string;
  /** Upper bound, pinned for the run — see the warmer's note on page drift. */
  createdBefore?: string;
  pageSize?: number;
}): Promise<SalesPage> {
  const res = await dyliGet<SalesResponse>("/sales", {
    pageSize: opts.pageSize ?? DYLI_PAGE_SIZE,
    page: opts.page,
    created_after: opts.createdAfter,
    created_before: opts.createdBefore,
  });
  const p = res.pagination;
  return {
    rows: res.sales ?? [],
    page: p?.page ?? opts.page,
    total: p?.total ?? 0,
    hasMore: Boolean(p?.has_more),
  };
}

/** Daily GMV from /transactions — the independent series we reconcile against. */
export type DyliDailyGmv = { day: string; gmv: number; txCount: number };

export async function fetchDailyGmv(maxPages = 20): Promise<DyliDailyGmv[]> {
  type TxResponse = {
    items?: { period?: string; date?: string; gmv?: number; tx_count?: number }[];
    pagination?: { has_more?: boolean };
  };
  const out: DyliDailyGmv[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await dyliGet<TxResponse>("/transactions", { timeframe: "day", pageSize: 200, page });
    for (const it of res.items ?? []) {
      const raw = it.period ?? it.date;
      if (!raw) continue;
      out.push({ day: String(raw).slice(0, 10), gmv: Number(it.gmv) || 0, txCount: Number(it.tx_count) || 0 });
    }
    if (!res.pagination?.has_more) break;
  }
  return out;
}

// ── Row store ─────────────────────────────────────────────────────────────

/** Upsert on `sale_id`, so re-running any page (or the whole backfill) is a no-op. */
export async function upsertDyliSales(rows: DyliStoredSale[]): Promise<number> {
  if (!rows.length) return 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db()
      .from("dyli_sales")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "sale_id" });
    if (error) throw new Error(`[dyli_sales] upsert failed: ${error.message}`);
  }
  return rows.length;
}

/** Newest `sold_at` we hold — the incremental cursor. Null when the store is empty. */
export async function latestStoredSoldAt(): Promise<string | null> {
  const { data, error } = await db()
    .from("dyli_sales")
    .select("sold_at")
    .order("sold_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`[dyli_sales] cursor read failed: ${error.message}`);
  return (data?.sold_at as string | undefined) ?? null;
}

/**
 * DYLI's SECONDARY sales as the shared NormalizedSale shape, for core-volume.
 * Marketplace lane only — a first sale (box / fair drop / inventory purchase) is
 * not resale volume and must never reach the marketplace number.
 */
export async function fetchDyliMarketplaceSales(windowMs: number): Promise<NormalizedSale[]> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const rows = await readDyliSales({ since });
  return rows
    .filter((r) => r.lane === "marketplace" && (r.price_usd ?? 0) > 0)
    .map((r) => ({
      date: r.sold_at,
      tokenId: r.token_id ?? String(r.product_id ?? ""),
      buyer: r.buyer ?? "",
      seller: r.seller ?? "",
      priceUsd: Number(r.price_usd),
    }));
}

/** Every stored row, paginated past PostgREST's 1000-row cap. */
export async function readDyliSales(opts: { since?: string } = {}): Promise<DyliStoredSale[]> {
  const PAGE = 1000;
  const out: DyliStoredSale[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db()
      .from("dyli_sales")
      .select("sale_id, token_id, product_id, product_name, market_type, sale_channel, sale_event_type, source_marketplace, lane, sold_at, price_usd, buyer, seller")
      .order("sold_at", { ascending: true })
      .order("sale_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (opts.since) q = q.gte("sold_at", opts.since);
    const { data, error } = await q;
    if (error) throw new Error(`[dyli_sales] read failed: ${error.message}`);
    const rows = (data ?? []) as DyliStoredSale[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
