/**
 * test:every-venue — the index read from the `secondary_sales` store (B2): the
 * store reader and its local override, the natural-key fold, the panel's store
 * leg and its cutover guard, the backfill's month windows and Collector Crypt
 * cost estimate, and the shadow report's diff. Synthetic rows; the store is a
 * JSONL file in a temp dir (SALES_STORE_LOCAL_DIR), never Postgres.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStoredSales, readStoreFeed, storedFromSnapshot, storedFromCC, dedupeNatural, storedToSale, writeLocalStore, type StoredSecondarySale } from "./salesStore";
import { readSaleFeed, storeHistoryProblem, STORE_MIN_BEEZIE_HISTORY_DAYS, PANEL_MIN_PRICE_USD } from "./salePanel";
import { monthWindows, lastCompleteMonth, splitByMonth, duneDatetime, parseCountRows, estimateHistoryCost, CC_HISTORY_COLUMNS, CC_HISTORY_BYTES_PER_ROW } from "./salesBackfill";
import { diffVenues, nextMethodVersion } from "./venuesReport";
import type { IndexPoint } from "./indices";
import type { NormalizedSale } from "../rarible/queries";

const DAY = 86_400_000;
const sale = (tokenId: string, date: string, priceUsd: number, buyer = "b", seller = "s"): NormalizedSale => ({ date, tokenId, buyer, seller, priceUsd });

function withLocalStore<T>(rows: StoredSecondarySale[], fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "every-venue-"));
  writeLocalStore(dir, rows);
  const prev = process.env.SALES_STORE_LOCAL_DIR;
  process.env.SALES_STORE_LOCAL_DIR = dir;
  return fn().finally(() => {
    if (prev == null) delete process.env.SALES_STORE_LOCAL_DIR;
    else process.env.SALES_STORE_LOCAL_DIR = prev;
  });
}

// ── The store reader ──────────────────────────────────────────────────────────

test("the local store: upserts on sale_id, reads one venue oldest first, honours sinceMs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "every-venue-"));
  const rows = [
    storedFromSnapshot("beezie", sale("2", "2026-03-02T00:00:00.000Z", 20)),
    storedFromSnapshot("beezie", sale("1", "2026-01-05T00:00:00.000Z", 10)),
    storedFromSnapshot("collector-crypt", sale("m", "2026-02-01T00:00:00.000Z", 5)),
  ];
  assert.deepEqual(writeLocalStore(dir, rows).added, 3);
  assert.deepEqual(writeLocalStore(dir, rows).added, 0, "a re-run writes nothing new");
  const prev = process.env.SALES_STORE_LOCAL_DIR;
  process.env.SALES_STORE_LOCAL_DIR = dir;
  try {
    assert.deepEqual((await readStoredSales("beezie")).map((r) => r.token_id), ["1", "2"]);
    assert.deepEqual((await readStoredSales("beezie", { sinceMs: Date.parse("2026-02-01T00:00:00Z") })).map((r) => r.token_id), ["2"]);
    assert.equal((await readStoredSales("courtyard")).length, 0);
  } finally {
    if (prev == null) delete process.env.SALES_STORE_LOCAL_DIR;
    else process.env.SALES_STORE_LOCAL_DIR = prev;
  }
});

test("one sale under two keys (natural, then tx) reads once", async () => {
  const s = sale("mint", "2026-09-30T05:58:08.000Z", 464.99, "buyer", "seller");
  const natural = storedFromSnapshot("collector-crypt", s);
  const byTx = storedFromCC({ sale: s, raw: { tx_id: "5sig" } });
  assert.notEqual(natural.sale_id, byTx.sale_id);
  // Postgres hands back a numeric and its own timestamp format; the fold still matches.
  const fromDb = { ...byTx, sold_at: "2026-09-30 05:58:08+00", price_usd: "464.99" as unknown as number };
  assert.deepEqual(storedToSale(fromDb), s);
  await withLocalStore([natural, byTx], async () => {
    assert.equal((await readStoredSales("collector-crypt")).length, 2);
    assert.deepEqual(await readStoreFeed("collector-crypt"), [s]);
  });
  assert.equal(dedupeNatural([s, { ...s }, { ...s, buyer: "other" }]).length, 2);
});

// ── The panel's store leg ─────────────────────────────────────────────────────

test("the panel reads the store: hygiene at read, as the legs had it", async () => {
  const now = Date.now();
  const iso = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();
  const rows = [
    // Beezie history reaching back past the guard; a self-trade the panel drops.
    storedFromSnapshot("beezie", sale("b1", iso(200), 100)),
    storedFromSnapshot("beezie", sale("b2", iso(3), 120)),
    storedFromSnapshot("beezie", sale("b3", iso(2), 50, "same", "same")),
    // Collector Crypt: a ring wash (A→B twice and B→A twice on one token) the hygiene pass removes.
    ...[40, 38].map((d) => storedFromSnapshot("collector-crypt", sale("ring", iso(d), 200, "B", "A"))),
    ...[39, 37].map((d) => storedFromSnapshot("collector-crypt", sale("ring", iso(d), 200, "A", "B"))),
    storedFromSnapshot("collector-crypt", sale("c1", iso(1), 80, "x", "y")),
  ];
  await withLocalStore(rows, async () => {
    const feed = await readSaleFeed({ source: "store" });
    const by = (p: string) => feed.filter((r) => r.platform === p).map((r) => r.tokenId).sort();
    assert.deepEqual(by("beezie"), ["b1", "b2"]);
    assert.deepEqual(by("collector-crypt"), ["c1"]);
  });
});

test("the dust floor: a sale under a dollar never reaches the panel, on any venue", async () => {
  const now = Date.now();
  const iso = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();
  const rows = [
    storedFromSnapshot("beezie", sale("b-deep", iso(200), 100)),
    // Oct 7: a Renaiss PSA 9 traded hundreds of times at $0.01 in one month.
    storedFromSnapshot("beezie", sale("b-dust", iso(3), 0.01)),
    storedFromSnapshot("beezie", sale("b-dollar", iso(3), PANEL_MIN_PRICE_USD)),
    storedFromSnapshot("courtyard", sale("cy-dust", iso(2), 0.99, "x", "y")),
    storedFromSnapshot("courtyard", sale("cy-ok", iso(2), 12, "x", "y")),
  ];
  await withLocalStore(rows, async () => {
    const feed = await readSaleFeed({ source: "store" });
    assert.deepEqual(feed.map((r) => r.tokenId).sort(), ["b-deep", "b-dollar", "cy-ok"]);
  });
});

test("the cutover guard: a store without Beezie history fails the build instead of shrinking the index", async () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  const recent = [sale("b", "2026-09-20T00:00:00.000Z", 10)];
  const deep = [sale("a", new Date(now - (STORE_MIN_BEEZIE_HISTORY_DAYS + 1) * DAY).toISOString(), 10), ...recent];
  assert.match(storeHistoryProblem([], undefined, now)!, /no Beezie rows/);
  assert.match(storeHistoryProblem(recent, undefined, now)!, /Beezie only from 2026-09-20.*--platform=beezie --apply/);
  assert.equal(storeHistoryProblem(deep, undefined, now), null);
  assert.equal(storeHistoryProblem([], now - DAY, now), null, "a windowed read asks for less history on purpose");
  await withLocalStore([storedFromSnapshot("beezie", recent[0])], async () => {
    await assert.rejects(readSaleFeed({ source: "store" }), /backfill-secondary-sales/);
  });
});

// ── The backfill's months and cost ────────────────────────────────────────────

test("month windows: half-open UTC months, inclusive range, across a year end", () => {
  assert.deepEqual(monthWindows("2025-11", "2026-02"), [
    { month: "2025-11", start: "2025-11-01T00:00:00.000Z", end: "2025-12-01T00:00:00.000Z" },
    { month: "2025-12", start: "2025-12-01T00:00:00.000Z", end: "2026-01-01T00:00:00.000Z" },
    { month: "2026-01", start: "2026-01-01T00:00:00.000Z", end: "2026-02-01T00:00:00.000Z" },
    { month: "2026-02", start: "2026-02-01T00:00:00.000Z", end: "2026-03-01T00:00:00.000Z" },
  ]);
  assert.deepEqual(monthWindows("2026-03", "2026-02"), []);
  assert.throws(() => monthWindows("2026-3", "2026-04"), /YYYY-MM/);
  assert.equal(lastCompleteMonth(Date.parse("2026-01-15T00:00:00Z")), "2025-12");
  assert.equal(duneDatetime("2026-03-01T00:00:00.000Z"), "2026-03-01 00:00:00");

  const rows = [{ sold_at: "2026-01-31T23:59:59.999Z" }, { sold_at: "2026-02-01T00:00:00.000Z" }, { sold_at: "2026-03-01T00:00:00.000Z" }];
  const { byMonth, outside } = splitByMonth(rows, monthWindows("2026-01", "2026-02"));
  assert.deepEqual([...byMonth].map(([m, r]) => [m, r.length]), [["2026-01", 1], ["2026-02", 1]]);
  assert.equal(outside, 1, "a row past the range is counted, not dropped silently");
});

test("--count: datapoints, export and credits per month from the count rows", () => {
  const counts = parseCountRows([
    { month: "2026-02-01 00:00:00.000 UTC", sales: 2000, volume_usd: 150000 },
    { month: "2026-01-01 00:00:00.000 UTC", sales: 1000, volume_usd: 90000 },
    { month: "garbage", sales: 5 },
  ]);
  assert.deepEqual(counts.map((c) => [c.month, c.sales]), [["2026-01", 1000], ["2026-02", 2000]]);
  const est = estimateHistoryCost(counts, { executionCredits: 40, usdPerCredit: 0.016 });
  assert.equal(est.datapoints, 3000 * CC_HISTORY_COLUMNS);
  const mb = (3000 * CC_HISTORY_BYTES_PER_ROW) / (1024 * 1024);
  assert.ok(Math.abs(est.exportMb - mb) < 1e-12);
  assert.ok(Math.abs(est.exportCredits - mb * 10) < 1e-9);
  assert.ok(Math.abs(est.totalCredits! - (mb * 10 + 40)) < 1e-9);
  assert.ok(Math.abs(est.usd! - (mb * 10 + 40) * 0.016) < 1e-9);
  // No measured compute: no total is claimed.
  const unmeasured = estimateHistoryCost(counts, { executionCredits: null, usdPerCredit: 0.016 });
  assert.equal(unmeasured.totalCredits, null);
  assert.equal(unmeasured.usd, null);
});

// ── The shadow report ─────────────────────────────────────────────────────────

const pt = (month: string, value: number, n: number, venues: Record<string, number>, thin = false): IndexPoint => ({
  ts: `${month}-28T23:59:59.999Z`,
  value,
  n,
  thin,
  venues: { byVenue: Object.fromEntries(Object.entries(venues).map(([v, k]) => [v, { identities: k, sales: k * 2 }])), identities: n, sales: n * 2, multiVenue: 0 },
});

test("the shadow diff: gains, cleared holds and thin flags, venues, and the fewer-identities check", () => {
  const before = {
    points: [pt("2026-03", 100, 22, { beezie: 22 }), pt("2026-04", 104, 30, { beezie: 30 }, true)],
    holds: [{ ts: "2026-05-31T23:59:59.999Z", reason: "below-floor" as const, overlap: 12, floor: 20, stepPct: 3 }],
  };
  const after = {
    points: [pt("2026-03", 100, 22, { beezie: 22 }), pt("2026-04", 103, 64, { beezie: 30, "collector-crypt": 40 }), pt("2026-05", 106, 41, { beezie: 12, "collector-crypt": 33 }, true)],
    holds: [],
  };
  const d = diffVenues("market:total", before, after);
  assert.deepEqual(d.monthsGained, ["2026-05"]);
  assert.deepEqual(d.monthsLost, []);
  assert.deepEqual(d.holdsClear, ["2026-05 below-floor"]);
  assert.deepEqual(d.holdsAppear, []);
  assert.deepEqual(d.thinCleared, ["2026-04"]);
  assert.deepEqual(d.fewerIdentities, []);
  const apr = d.months.find((m) => m.month === "2026-04")!;
  assert.deepEqual([apr.identitiesBefore, apr.identitiesAfter], [30, 64]);
  assert.deepEqual(apr.venuesAfter, { beezie: 30, "collector-crypt": 40 });
  assert.ok(Math.abs(apr.stepBefore! - 4) < 1e-9 && Math.abs(apr.stepAfter! - 3) < 1e-9);

  assert.deepEqual(d.baseIdentitiesChanged, []);

  // A store missing history the legs had: a step on fewer identities, or a month lost.
  const worse = diffVenues("ip:pokemon", before, { points: [pt("2026-03", 100, 21, { beezie: 21 }), pt("2026-04", 104, 29, { beezie: 29 })], holds: [] });
  assert.deepEqual(worse.fewerIdentities, ["2026-04 30 → 29"]);
  // The base month has no step: its count is reported apart, not as a failed step.
  assert.deepEqual(worse.baseIdentitiesChanged, ["2026-03 22 → 21"]);
  assert.deepEqual(diffVenues("ip:pokemon", before, { points: [pt("2026-03", 100, 22, { beezie: 22 })], holds: [] }).monthsLost, ["2026-04"]);
});

test("the ledger's next version", () => {
  assert.equal(nextMethodVersion(["v4.2"]), "v4.3");
  assert.equal(nextMethodVersion(["v4.1", "v4.2", "v4.10", "junk"]), "v4.11");
  assert.equal(nextMethodVersion(["v5.0", "v4.9"]), "v5.1");
});
