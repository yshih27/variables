/**
 * test:sales-store — the `secondary_sales` mappers, keys and write plan.
 *
 * Fixtures (src/lib/data/fixtures/sales-store/):
 *   beezie-activity.json     a real Beezie /activity sale, read Oct 1 2026
 *   courtyard-activity.json  a real Rarible SELL activity for Courtyard, read Oct 1 2026
 *   cc-dune-rows.json        CONSTRUCTED in Dune query 7675297's row shape (labelled inside)
 *
 * No test touches the network or the database: the store is an in-memory Map
 * standing in for the upsert on `sale_id`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  naturalSaleId,
  planStoreWrite,
  storedFromBeezie,
  storedFromCC,
  storedFromCourtyard,
  storedFromSnapshot,
  STORE_OVERLAP_DAYS,
  type StorePlatform,
  type StoredSecondarySale,
} from "./salesStore";
import { ccSaleOf } from "./warmers/core";
import { raribleSaleOf } from "../rarible/queries";
import { beezieSaleOf, type BeezieActivity } from "../beezie/market";
import { cleanSecondarySales } from "./secondaryHygiene";
import type { RaribleSellActivity } from "../rarible/types";
import type { NormalizedSale } from "../rarible/queries";

const FIX = join(__dirname, "fixtures", "sales-store");
const load = <T>(name: string): T => JSON.parse(readFileSync(join(FIX, name), "utf8")) as T;
const beezie = load<BeezieActivity>("beezie-activity.json");
const courtyard = load<RaribleSellActivity>("courtyard-activity.json");
const cc = load<Record<string, Record<string, unknown>>>("cc-dune-rows.json");

const DAY = 86_400_000;

// ── The three mappers ─────────────────────────────────────────────────────────

test("Collector Crypt: a Dune row maps to its sale, keyed naturally until tx_id lands", () => {
  const sale = ccSaleOf(cc.withoutTx)!;
  assert.deepEqual(sale, {
    date: "2026-09-30T05:58:08.000Z",
    tokenId: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    buyer: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    seller: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T",
    priceUsd: 125.5,
  });
  const row = storedFromCC({ sale, raw: cc.withoutTx });
  assert.equal(row.sale_id, "collector-crypt:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU:2026-09-30T05:58:08.000Z:125.5:9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
  assert.equal(row.platform, "collector-crypt");
  assert.equal(row.sold_at, "2026-09-30T05:58:08.000Z");
  assert.equal(row.price_usd, 125.5);
  assert.equal(row.currency, "USDC");
  assert.equal(row.source, "dune:7675297");
  assert.deepEqual(row.raw, cc.withoutTx);

  const withTx = storedFromCC({ sale: ccSaleOf(cc.withTx)!, raw: cc.withTx });
  assert.equal(withTx.sale_id, `collector-crypt:${cc.withTx.tx_id}:0`);

  assert.equal(ccSaleOf(cc.zeroPrice), null);
});

test("Courtyard: a Rarible SELL activity maps to its sale, keyed on transaction and activity id", () => {
  const sale = raribleSaleOf(courtyard)!;
  assert.deepEqual(sale, {
    date: "2026-09-29T14:27:14Z",
    tokenId: "107805133462299590982151323861325155745020266141687428119153289787852269074973",
    buyer: "ETHEREUM:0xe146eb724747bef18d09c645a07ccec7d6e63814",
    seller: "ETHEREUM:0x08c4e146e9e0935c627049cc21dfefbe9e384004",
    priceUsd: parseFloat("464.990995367216115798"),
  });
  const row = storedFromCourtyard({ sale, raw: courtyard });
  assert.equal(row.sale_id, "courtyard:0x3f142c0af3b93b7c3474f65d86b879f964f6ec8a7f2af7adb58f7d7e18e173e3:POLYGON:6abbcac4040767744a7287a7");
  assert.equal(row.currency, "ERC20:POLYGON:0x2791bca1f2de4661ed88a30c99a7a9449aa84174");
  assert.equal(row.source, "rarible:activity");
  assert.deepEqual(row.raw, courtyard);
  assert.equal(raribleSaleOf({ ...courtyard, reverted: true }), null);
  assert.equal(raribleSaleOf({ "@type": "LIST", id: "x", date: courtyard.date }), null);
});

test("Beezie: an /activity sale maps to its sale, keyed on transaction and Beezie's id", () => {
  const sale = beezieSaleOf(beezie)!;
  assert.deepEqual(sale, {
    date: "2026-10-01T03:28:20.000Z",
    tokenId: "21220",
    buyer: "0xf0421d1c4f2767cbc68ad7838a5af387c620628b",
    seller: "0x9deb4f966c8d186e83833b2a111e757997e3de1a",
    priceUsd: 449,
  });
  const row = storedFromBeezie({ sale, raw: beezie });
  assert.equal(row.sale_id, "beezie:0x7da53cdcfdd84e71328abcc1280db8cc3c17e205be6af38041b961337bb21607:BPk9rA4mHLjhUE1H0zI0a");
  assert.equal(row.currency, "USDC");
  assert.equal(row.source, "beezie:/activity");
  // A listing, a burned token and another contract are not sales.
  assert.equal(beezieSaleOf({ ...beezie, type: "order_created" }), null);
  assert.equal(beezieSaleOf({ ...beezie, isBurned: true }), null);
  assert.equal(beezieSaleOf({ ...beezie, tokenAddress: "0x0000000000000000000000000000000000000001" }), null);
});

// ── The key ───────────────────────────────────────────────────────────────────

test("a seeded Collector Crypt row and the core run's row share one key until tx_id lands", () => {
  const sale = ccSaleOf(cc.withoutTx)!;
  assert.equal(storedFromSnapshot("collector-crypt", sale).sale_id, storedFromCC({ sale, raw: cc.withoutTx }).sale_id);
  assert.equal(naturalSaleId("collector-crypt", sale), storedFromCC({ sale, raw: cc.withoutTx }).sale_id);
  for (const p of ["collector-crypt", "courtyard", "beezie"] as const) {
    const id = storedFromSnapshot(p, sale).sale_id;
    assert.ok(id.startsWith(`${p}:`), id);
  }
});

/** A stored row read back as the shape every reader takes. */
const readBack = (r: StoredSecondarySale): NormalizedSale => ({
  date: r.sold_at,
  tokenId: r.token_id,
  buyer: r.buyer ?? "",
  seller: r.seller ?? "",
  priceUsd: r.price_usd,
});

test("when tx_id lands, the old and new keys of one sale collapse at read", () => {
  const sale = ccSaleOf(cc.withTx)!;
  const before = storedFromCC({ sale, raw: cc.withoutTx }); // keyed before tx_id
  const after = storedFromCC({ sale, raw: cc.withTx }); // keyed after
  assert.notEqual(before.sale_id, after.sale_id);
  const { sales } = cleanSecondarySales([before, after].map(readBack));
  assert.equal(sales.length, 1);
});

// ── Idempotence ───────────────────────────────────────────────────────────────

/** The table, as the upsert on `sale_id` leaves it. */
function upsertInto(store: Map<string, StoredSecondarySale>, rows: StoredSecondarySale[]) {
  for (const r of rows) store.set(r.sale_id, r);
}
function newestOf(store: Map<string, StoredSecondarySale>): Map<StorePlatform, string | null> {
  const m = new Map<StorePlatform, string | null>();
  for (const r of store.values()) {
    const cur = m.get(r.platform);
    if (!cur || r.sold_at > cur) m.set(r.platform, r.sold_at);
  }
  return m;
}

test("two runs over the same rows leave the store exactly as one run does", () => {
  const fetched = [
    storedFromCC({ sale: ccSaleOf(cc.withoutTx)!, raw: cc.withoutTx }),
    storedFromCourtyard({ sale: raribleSaleOf(courtyard)!, raw: courtyard }),
    storedFromBeezie({ sale: beezieSaleOf(beezie)!, raw: beezie }),
  ];
  const store = new Map<string, StoredSecondarySale>();
  upsertInto(store, planStoreWrite(fetched, newestOf(store)));
  const once = structuredClone([...store.entries()]);
  upsertInto(store, planStoreWrite(fetched, newestOf(store)));
  assert.deepEqual([...store.entries()], once);
  assert.equal(store.size, 3);
});

test("a run writes each key once, and only from the newest stored sale minus the overlap", () => {
  const sale = beezieSaleOf(beezie)!;
  const row = storedFromBeezie({ sale, raw: beezie });
  // The same sale twice in one fetch → one row (an upsert batch must not touch a key twice).
  assert.equal(planStoreWrite([row, row], new Map()).length, 1);
  // A row older than newest − STORE_OVERLAP_DAYS is already stored and is skipped.
  const newest = new Map<StorePlatform, string | null>([["beezie", row.sold_at]]);
  const old = { ...row, sale_id: "beezie:old:1", sold_at: new Date(Date.parse(row.sold_at) - (STORE_OVERLAP_DAYS + 1) * DAY).toISOString() };
  const recent = { ...row, sale_id: "beezie:recent:1", sold_at: new Date(Date.parse(row.sold_at) - 2 * DAY).toISOString() };
  assert.deepEqual(planStoreWrite([old, recent, row], newest).map((r) => r.sale_id), ["beezie:recent:1", row.sale_id]);
  // A venue with nothing stored writes everything.
  assert.equal(planStoreWrite([old, recent, row], new Map([["beezie", null]])).length, 3);
});
