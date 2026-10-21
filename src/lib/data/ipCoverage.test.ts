/**
 * Per-IP venue coverage lines, and the shared 7-day window the Categories table's
 * 7d column reads.
 *
 *   npm run test:ip-coverage
 *
 * Snapshot shapes are constructed; the venue mix mirrors production on
 * 2026-10-21 (Renaiss below its stated-value floor, so no per-IP entry).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  andList,
  byPlatformCoverageLine,
  ipCoverage,
  ipHolderVenues,
  ipMcapVenues,
  ipTableCoverageLine,
  mcapBasisList,
  railCoverageLine,
} from "./ipCoverage";
import { lastDaysSums, type SeriesPoint } from "./metricSnapshots";
import type { MarketCapSnapshot } from "./marketcap";
import type { HoldersSnapshot } from "./holders";

const plat = (byIp: Record<string, number>) => ({
  cards: 0,
  cardsValued: 0,
  floorUsd: 0,
  mcapUsd: 0,
  insuredUsd: 0,
  byIp: Object.fromEntries(Object.entries(byIp).map(([ip, cards]) => [ip, { cards, cardsValued: cards, floorUsd: 0, mcapUsd: cards * 10 }])),
});

const mcap: MarketCapSnapshot = {
  generatedAt: "2026-10-21T16:10:36Z",
  byIp: {},
  // Insertion order deliberately not registry order.
  byPlatform: {
    "collector-crypt": plat({ pokemon: 120, soccer: 41 }),
    dyli: plat({}),
    beezie: plat({ pokemon: 9 }),
    phygitals: plat({}),
  },
  totals: { mcapUsd: 0, insuredUsd: 0 },
};

const holders: HoldersSnapshot = {
  generatedAt: "2026-10-21T10:36:33Z",
  platforms: {},
  byIp: {
    soccer: { total: 135, perPlatform: { renaiss: 0, phygitals: 94, "collector-crypt": 41, beezie: 0 } },
    pokemon: { total: 9000, perPlatform: { beezie: 500, "collector-crypt": 8000, phygitals: 400, renaiss: 300 } },
  },
};

test("andList joins like prose", () => {
  assert.equal(andList([]), "");
  assert.equal(andList(["A"]), "A");
  assert.equal(andList(["A", "B"]), "A and B");
  assert.equal(andList(["A", "B", "C"]), "A, B and C");
});

test("market-cap venues = venues with a per-IP entry, in registry order", () => {
  assert.deepEqual(ipMcapVenues(mcap), ["beezie", "collector-crypt"]);
  assert.deepEqual(ipMcapVenues(null), []);
  assert.equal(mcapBasisList(ipMcapVenues(mcap)), "Beezie lowest listing, Collector Crypt insured value");
});

test("holder venues = every venue the scan wrote per IP, in registry order", () => {
  assert.deepEqual(ipHolderVenues(holders), ["beezie", "collector-crypt", "phygitals", "renaiss"]);
  assert.deepEqual(ipHolderVenues(null), []);
});

test("coverage lines name each figure's venues", () => {
  const c = ipCoverage(mcap, holders);
  assert.equal(
    railCoverageLine(c),
    "24h figures: Beezie and Collector Crypt resale · market cap: Beezie lowest listing, Collector Crypt insured value",
  );
  assert.equal(
    byPlatformCoverageLine(c),
    "24h vol, trades and avg trade: Beezie and Collector Crypt resale · cards and market cap: Beezie and Collector Crypt · holders: wallets on Beezie, Collector Crypt, Phygitals and Renaiss",
  );
  // Resale venues with a feed now, in any order: the per-IP ones drop out.
  assert.equal(
    ipTableCoverageLine(c, ["renaiss", "collector-crypt", "courtyard", "beezie", "dyli"]),
    "per IP: volume, cards, buyers and avg trade count Beezie and Collector Crypt resale · market cap: Beezie lowest listing, Collector Crypt insured value · holders: wallets on Beezie, Collector Crypt, Phygitals and Renaiss · Courtyard, DYLI and Renaiss resale counts in venue totals only",
  );
});

test("coverage lines without snapshots still name the resale venues", () => {
  const c = ipCoverage(null, null);
  assert.equal(railCoverageLine(c), "24h figures: Beezie and Collector Crypt resale · market cap: no venue valued by IP");
  assert.equal(byPlatformCoverageLine(c), "24h vol, trades and avg trade: Beezie and Collector Crypt resale");
});

const day = (d: string, value: number): SeriesPoint => ({ ts: `2026-10-${d}T00:00:00.000Z`, value });

test("7d window: every key on the window ending at the newest day any key recorded", () => {
  const bulk = new Map<string, SeriesPoint[]>([
    // Trades every day.
    ["pokemon", ["14", "15", "16", "17", "18", "19", "20"].map((d) => day(d, 100))],
    // Sparse: two days in the window, one long before it (outside).
    ["soccer", [day("02", 999), day("15", 30), day("19", 20)]],
  ]);
  const w = lastDaysSums(bulk, 7);
  assert.equal(w.complete, true);
  assert.equal(w.endDay, "2026-10-20");
  assert.equal(w.sumFor("pokemon"), 700);
  // Missing days are quiet days, and the Oct 2 sale is outside the window: not a
  // week that ended on its last sale.
  assert.equal(w.sumFor("soccer"), 50);
  // Never traded at all: $0 over a complete window, not "—".
  assert.equal(w.sumFor("hockey"), 0);
});

test("7d window: a day no key recorded leaves every key NaN", () => {
  const bulk = new Map<string, SeriesPoint[]>([
    ["pokemon", ["14", "15", "16", "18", "19", "20"].map((d) => day(d, 100))], // Oct 17 missing everywhere
    ["soccer", [day("15", 30)]],
  ]);
  const w = lastDaysSums(bulk, 7);
  assert.equal(w.complete, false);
  assert.ok(Number.isNaN(w.sumFor("pokemon")));
  assert.ok(Number.isNaN(w.sumFor("soccer")));
});

test("7d window: empty input or a bad window reads NaN", () => {
  assert.ok(Number.isNaN(lastDaysSums(new Map(), 7).sumFor("pokemon")));
  assert.ok(Number.isNaN(lastDaysSums(new Map([["pokemon", [day("20", 1)]]]), 0).sumFor("pokemon")));
});
