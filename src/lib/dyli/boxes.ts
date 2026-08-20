/**
 * DYLI mystery boxes — the gacha surface.
 *
 *   GET /boxes                 the catalog: price, DECLARED EV, odds buckets
 *   GET /boxes/{id}/history    realized pulls, newest-first, cursor-paged
 *
 * ⚠️ THE EV HERE IS DECLARED, NOT REALIZED. `expected_value_usd` / `fmv_ratio`
 * are DYLI's own published figures for a box, computed from its own FMV marks
 * (`fmv_source: "DYLI"` on every pull). That is a useful thing to show and a
 * dangerous thing to mislabel: it is the house's stated expectation, not an EV
 * we measured from outcomes. Anything derived from `/history` is realized and
 * must be named separately — never blended into these fields.
 *
 * ⚠️ /history CARRIES NO BUYER. Verified 2026-08-20 over a full 100-pull page:
 * no wallet, buyer, owner, user, address or account field anywhere in the
 * payload. So DYLI pulls land in `gacha_pulls` with `buyer = null` and DYLI gets
 * NO player analytics — playerAnalytics already excludes a platform with rows
 * but no attribution, and reports the reason. Do not synthesise an identity.
 */
import { dyliGet } from "./client";

/** One rarity bucket as the catalog declares it. */
export type DyliOddsBucket = {
  range_name?: string | null;
  rate?: number | null;
  hit_rate?: number | null;
  item_count?: number | null;
  unique_item_count?: number | null;
  inventory_value_usd?: number | null;
};

export type DyliBox = {
  box_id: number;
  name: string | null;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  type: string | null;
  price_usd: number | null;
  /** DYLI's declared expected value for one pull. */
  expected_value_usd: number | null;
  /** DYLI's declared EV ÷ price. Published as-is; never recomputed from price. */
  fmv_ratio: number | null;
  avg_item_value_usd: number | null;
  inventory_count: number | null;
  odds_buckets: DyliOddsBucket[];
  buyback_rate: number | null;
  min_buyback_floor: number | null;
  live: boolean;
  out_of_stock: boolean;
  metrics_updated_at: string | null;
};

type BoxesResponse = {
  boxes?: Record<string, unknown>[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function toBox(r: Record<string, unknown>): DyliBox {
  return {
    box_id: Number(r.box_id),
    name: (r.name as string) ?? null,
    brand: (r.brand as string) ?? null,
    category: (r.category as string) ?? null,
    subcategory: (r.subcategory as string) ?? null,
    type: (r.type as string) ?? null,
    price_usd: num(r.price_usd),
    // `expected_value_usd` and `ev_usd` are the same figure in the payload; take
    // the explicit one and fall back rather than assuming both are always sent.
    expected_value_usd: num(r.expected_value_usd) ?? num(r.ev_usd),
    fmv_ratio: num(r.fmv_ratio),
    avg_item_value_usd: num(r.avg_item_value_usd),
    inventory_count: num(r.inventory_count),
    odds_buckets: Array.isArray(r.odds_buckets) ? (r.odds_buckets as DyliOddsBucket[]) : [],
    buyback_rate: num(r.buyback_rate),
    min_buyback_floor: num(r.min_buyback_floor),
    live: Boolean(r.live),
    out_of_stock: Boolean(r.out_of_stock),
    metrics_updated_at: (r.metrics_updated_at as string) ?? null,
  };
}

/** The whole box catalog — 22 boxes at time of writing, so one or two requests. */
export async function fetchAllBoxes(pageSize = 200, maxPages = 20): Promise<DyliBox[]> {
  const out: DyliBox[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await dyliGet<BoxesResponse>("/boxes", { page, pageSize });
    const rows = res.boxes ?? [];
    out.push(...rows.map(toBox));
    const totalPages = Number(res.totalPages) || 1;
    if (page >= totalPages || !rows.length) break;
  }
  return out;
}

/** One realized pull. No buyer field exists upstream — see the header note. */
export type DyliPull = {
  pull_id: number;
  box_id: number;
  collectible_id: number | null;
  title: string | null;
  /** DYLI's fair-market mark for the item pulled. */
  fmv_usd: number | null;
  fmv_source: string | null;
  tier: string | null;
  rarity: number | null;
  pulled_at: string;
  price_paid_usd: number | null;
  buyback_usd: number | null;
  was_buyback: boolean;
};

type HistoryResponse = {
  box?: Record<string, unknown>;
  pulls?: Record<string, unknown>[];
  pagination?: {
    limit?: number;
    returned?: number;
    order?: string;
    has_more?: boolean;
    next_cursor?: number | null;
    newest_pull_id?: number | null;
    oldest_pull_id?: number | null;
  };
};

function toPull(r: Record<string, unknown>, boxId: number): DyliPull {
  return {
    pull_id: Number(r.pull_id),
    box_id: Number(r.box_id ?? boxId),
    collectible_id: num(r.collectible_id),
    title: (r.title as string) ?? null,
    fmv_usd: num(r.fmv_usd),
    fmv_source: (r.fmv_source as string) ?? null,
    tier: (r.tier as string) ?? null,
    rarity: num(r.rarity),
    pulled_at: String(r.pulled_at ?? ""),
    price_paid_usd: num(r.price_paid_usd),
    buyback_usd: num(r.buyback_usd),
    was_buyback: Boolean(r.was_buyback),
  };
}

export type HistoryPage = {
  pulls: DyliPull[];
  /** Feed the next request's `cursor`. Null when the box is exhausted. */
  nextCursor: number | null;
  hasMore: boolean;
  newestPullId: number | null;
};

/**
 * One page of a box's pull history. CURSOR-paged, not page-numbered: the feed
 * returns `next_cursor` (an ascending-exclusive pull id) and ignores `pageSize`
 * in favour of its own `limit` of 100. Newest-first, which is what makes an
 * incremental sweep cheap — stop as soon as you reach a pull you already hold.
 */
export async function fetchBoxHistoryPage(boxId: number, cursor?: number): Promise<HistoryPage> {
  const res = await dyliGet<HistoryResponse>(`/boxes/${boxId}/history`, { cursor });
  const rows = res.pulls ?? [];
  const p = res.pagination ?? {};
  return {
    pulls: rows.map((r) => toPull(r, boxId)),
    nextCursor: p.next_cursor ?? null,
    hasMore: Boolean(p.has_more),
    newestPullId: p.newest_pull_id ?? null,
  };
}
