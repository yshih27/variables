/**
 * `secondary_sales` — every resale row we read, kept. The ONLY module that
 * touches the table (migration 20261001000001).
 *
 * Why it exists: each venue's resale reaches the sale panel through a 30-day
 * window that every core run overwrites (`secondary-sales` snapshot; Beezie
 * live). A month's rows age out before the next month can be compared with it,
 * so a venue's history is lost a day at a time. The core run now also writes
 * the rows it already fetched here, idempotently, before hygiene; nothing reads
 * the store yet (the index reads it from brief-backend-index-every-venue B2).
 *
 * `sale_id` = `<platform>:<transaction or signature>:<index>`:
 *   • collector-crypt  `collector-crypt:<tx_id>:0` once Dune query 7675297
 *     selects `tx_id` (dune/cc-secondary.sql; one sale per transaction by the
 *     query's construction). Until then, and for every row seeded from the
 *     snapshot, the natural key `<platform>:<mint>:<sold_at>:<price>:<buyer>`.
 *   • courtyard        `courtyard:<transactionHash>:<Rarible activity id>`
 *   • beezie           `beezie:<transactionHash>:<Beezie activity id>`
 *
 * ⚠️ TWO KEYS FOR ONE SALE CAN COEXIST, BY DESIGN AND BRIEFLY: a sale stored
 * under its natural key (before `tx_id` lands, or seeded from the snapshot) and
 * again under its transaction key once the feed carries one. Both rows carry
 * the same normalized fields, so the read-time hygiene's first pass (the
 * natural-key dedupe in secondaryHygiene.ts) collapses them, exactly as it
 * collapses a feed's own duplicates today. No new natural-key row is written
 * for a sale whose feed row carries an id.
 */
import { db } from "../db/client";
import type { NormalizedSale } from "../rarible/queries";
import type { RaribleAssetType, RaribleSellActivity } from "../rarible/types";
import type { BeezieActivity } from "../beezie/market";
import { CC_SECONDARY_QUERY_ID } from "../dune/queryIds";

export type StorePlatform = "collector-crypt" | "courtyard" | "beezie";
export const STORE_PLATFORMS: readonly StorePlatform[] = ["collector-crypt", "courtyard", "beezie"];

/** A `secondary_sales` row. */
export type StoredSecondarySale = {
  sale_id: string;
  platform: StorePlatform;
  sold_at: string;
  token_id: string;
  buyer: string | null;
  seller: string | null;
  price_usd: number;
  currency: string | null;
  source: string;
  raw: unknown;
};

/** A sale as a feed delivered it: the normalized row every reader uses, and the feed row verbatim. */
export type ObservedSale<Raw = unknown> = { sale: NormalizedSale; raw: Raw };

const orNull = (s: string): string | null => (s ? s : null);

/** The natural key: what identifies a sale when its feed row carries no transaction id. */
export function naturalSaleId(platform: StorePlatform, s: NormalizedSale): string {
  return `${platform}:${s.tokenId}:${s.date}:${s.priceUsd}:${s.buyer}`;
}

function base(platform: StorePlatform, sale: NormalizedSale): Omit<StoredSecondarySale, "sale_id" | "currency" | "source" | "raw"> {
  return {
    platform,
    sold_at: sale.date,
    token_id: sale.tokenId,
    buyer: orNull(sale.buyer),
    seller: orNull(sale.seller),
    price_usd: sale.priceUsd,
  };
}

/** Collector Crypt, from a row of Dune query 7675297. */
export function storedFromCC(o: ObservedSale<Record<string, unknown>>): StoredSecondarySale {
  const tx = typeof o.raw.tx_id === "string" && o.raw.tx_id ? o.raw.tx_id : null;
  return {
    sale_id: tx ? `collector-crypt:${tx}:0` : naturalSaleId("collector-crypt", o.sale),
    ...base("collector-crypt", o.sale),
    currency: "USDC",
    source: `dune:${CC_SECONDARY_QUERY_ID}`,
    raw: o.raw,
  };
}

/** The payment asset as one string: an ERC-20 as `ERC20:<contract>`, a native coin as its type. */
function paymentCurrency(t: RaribleAssetType | undefined): string | null {
  if (!t) return null;
  return "contract" in t ? `${t["@type"]}:${t.contract}` : t["@type"];
}

/** Courtyard, from a Rarible SELL activity. */
export function storedFromCourtyard(o: ObservedSale<RaribleSellActivity>): StoredSecondarySale {
  return {
    sale_id: `courtyard:${o.raw.transactionHash}:${o.raw.id}`,
    ...base("courtyard", o.sale),
    currency: paymentCurrency(o.raw.payment?.type),
    source: "rarible:activity",
    raw: o.raw,
  };
}

/** Beezie, from an `/activity` order_fulfilled row. */
export function storedFromBeezie(o: ObservedSale<BeezieActivity>): StoredSecondarySale {
  const id = o.raw.id != null ? String(o.raw.id) : "";
  return {
    sale_id: id ? `beezie:${o.raw.transactionHash ?? "-"}:${id}` : naturalSaleId("beezie", o.sale),
    ...base("beezie", o.sale),
    currency: "USDC",
    source: "beezie:/activity",
    raw: o.raw,
  };
}

/** A row of the `secondary-sales` snapshot, which carries no id: the natural key. */
export function storedFromSnapshot(platform: StorePlatform, sale: NormalizedSale): StoredSecondarySale {
  return {
    sale_id: naturalSaleId(platform, sale),
    ...base(platform, sale),
    currency: platform === "courtyard" ? null : "USDC",
    source: "snapshot:secondary-sales",
    raw: sale,
  };
}

const DAY_MS = 86_400_000;
/**
 * How far behind the newest stored sale of a venue a run still writes. Dune
 * restates its newest days (about three, measured Sep 22), and an upsert is
 * idempotent, so a week of overlap costs a few hundred identical upserts and
 * never misses a late row.
 */
export const STORE_OVERLAP_DAYS = 7;

/**
 * The rows a run writes — pure. One row per `sale_id` (a feed can repeat a
 * sale; PostgREST refuses an upsert batch that touches one key twice), and for
 * a venue that already has rows, only those from its newest stored sale minus
 * STORE_OVERLAP_DAYS on. A venue with no stored row writes everything.
 */
export function planStoreWrite(
  rows: StoredSecondarySale[],
  newestByPlatform: Map<StorePlatform, string | null>,
): StoredSecondarySale[] {
  const since = new Map<StorePlatform, number>();
  for (const [p, newest] of newestByPlatform) {
    const t = newest ? Date.parse(newest) : NaN;
    if (Number.isFinite(t)) since.set(p, t - STORE_OVERLAP_DAYS * DAY_MS);
  }
  const out = new Map<string, StoredSecondarySale>();
  for (const r of rows) {
    const cut = since.get(r.platform);
    if (cut != null && !(Date.parse(r.sold_at) >= cut)) continue;
    if (!out.has(r.sale_id)) out.set(r.sale_id, r);
  }
  return [...out.values()];
}

// ── Postgres ──────────────────────────────────────────────────────────────────

/** Newest stored `sold_at` for a venue; null when it has none. Throws on a read error. */
export async function newestStoredSoldAt(platform: StorePlatform): Promise<string | null> {
  const { data, error } = await db()
    .from("secondary_sales")
    .select("sold_at")
    .eq("platform", platform)
    .order("sold_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`[secondary_sales] newest read failed: ${error.message}`);
  return (data?.sold_at as string | undefined) ?? null;
}

/** Upsert on `sale_id`; a re-run writes nothing new. */
export async function upsertSecondarySales(rows: StoredSecondarySale[]): Promise<number> {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db().from("secondary_sales").upsert(rows.slice(i, i + CHUNK), { onConflict: "sale_id" });
    if (error) throw new Error(`[secondary_sales] upsert failed: ${error.message}`);
  }
  return rows.length;
}

const missingTable = (msg: string) => /secondary_sales/.test(msg) && /does not exist|schema cache|not find/i.test(msg);

/**
 * The core run's write: plan against each venue's newest stored sale, then
 * upsert. NEVER THROWS — the store is kept alongside the snapshot, and a store
 * failure (the table not created yet, a timeout) must not cost the run its
 * volumes. Returns what it did, for the run's log.
 */
export async function writeSalesStore(rows: StoredSecondarySale[]): Promise<string> {
  if (!rows.length) return "secondary_sales: nothing to write this run";
  try {
    const venues = [...new Set(rows.map((r) => r.platform))];
    const newest = new Map<StorePlatform, string | null>();
    for (const p of venues) newest.set(p, await newestStoredSoldAt(p));
    const plan = planStoreWrite(rows, newest);
    await upsertSecondarySales(plan);
    const by = venues.map((p) => `${p} ${plan.filter((r) => r.platform === p).length}`).join(" · ");
    return `secondary_sales: upserted ${plan.length} of ${rows.length} fetched rows (${by})`;
  } catch (e) {
    const msg = (e as Error).message;
    if (missingTable(msg)) return "secondary_sales: table not created yet (migration 20261001000001 not applied), store write skipped";
    return `secondary_sales: store write FAILED, the snapshot is unaffected: ${msg.slice(0, 200)}`;
  }
}
