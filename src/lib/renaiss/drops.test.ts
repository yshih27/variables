import { test } from "node:test";
import assert from "node:assert/strict";
import { detectDrops, halfOf, openingOf, scoreDrops, sellingPastSpan, walletsOf, DROP_MIN_PACKS, OPEN_BURST_MS, OPEN_BURST_PACKS, type DropPull, type DropRow } from "./drops";

const READ_FROM = Date.parse("2026-09-01T00:00:00Z");
const NOW = Date.parse("2026-10-14T03:00:00Z");

/** `n` paid pulls of one product from `startIso`, one a minute, buyers cycling through `buyers`. */
const run = (product: string, startIso: string, n: number, buyers: string[], name: string | null = null, price = 100): DropPull[] =>
  Array.from({ length: n }, (_, i) => ({
    product_id: product,
    machine_name: name,
    buyer: buyers[i % buyers.length],
    price_usd: price,
    pulled_at: new Date(Date.parse(startIso) + i * 60_000).toISOString(),
  }));

test("a drop: enough packs, all within a day of the first, judged once the day has passed", () => {
  const pulls = [
    ...run("sep18", "2026-09-18T09:00:00Z", 666, ["0xa", "0xb"]),
    ...run("lunar", "2026-09-24T09:00:00Z", 666, ["0xc"], "Lunar Pack"),
    ...run("small", "2026-09-25T09:00:00Z", DROP_MIN_PACKS - 1, ["0xd"]), // too few packs
    ...run("machine", "2026-09-26T09:00:00Z", 200, ["0xe"]), // runs past a day: a machine
    ...run("machine", "2026-09-28T09:00:00Z", 200, ["0xe"]),
    ...run("early", "2026-09-01T09:00:00Z", 300, ["0xf"]), // began inside the window's first day: its start may be earlier
    ...run("today", "2026-10-14T01:00:00Z", 300, ["0xg"]), // its day has not passed
    ...run("lull", "2026-10-12T20:00:00Z", 150, ["0xh"]), // its day has passed, but not the settle day after it
  ];
  const drops = detectDrops(pulls, READ_FROM, NOW);
  assert.deepEqual(drops.map((d) => d.productId).sort(), ["lunar", "sep18"]);
  const sep18 = drops.find((d) => d.productId === "sep18")!;
  assert.equal(sep18.name, "Unnamed pack · Sep 18", "no name in the feed: its first day");
  assert.equal(sep18.named, false);
  assert.equal(sep18.packs, 666);
  assert.equal(sep18.priceUsd, 100);
  assert.equal(sep18.buyers, 2);
  assert.equal(sep18.lastAt, new Date(Date.parse("2026-09-18T09:00:00Z") + 665 * 60_000).toISOString());
  assert.equal(drops.find((d) => d.productId === "lunar")!.name, "Lunar Pack");
});

test("top buyers' share counts the ten biggest wallets' packs", () => {
  const whales = Array.from({ length: 10 }, (_, i) => `0xw${i}`);
  const pulls = [...run("d", "2026-09-10T09:00:00Z", 100, whales), ...run("d", "2026-09-10T10:40:00Z", 100, Array.from({ length: 100 }, (_, i) => `0xs${i}`))];
  const [d] = detectDrops(pulls, READ_FROM, NOW);
  assert.equal(d.buyers, 110);
  assert.equal(d.topBuyersSharePct, 50, "the ten whales, ten packs each: 100 of 200");
});

test("new players and returning buyers, scored against the whole history", () => {
  const first = detectDrops(run("aug", "2026-09-05T09:00:00Z", 100, ["0xa", "0xb"]), READ_FROM, NOW);
  const second = detectDrops(run("sep", "2026-09-12T09:00:00Z", 100, ["0xa", "0xc"]), READ_FROM, NOW);
  const firstPull = new Map([
    ["0xa", Date.parse("2026-01-01T00:00:00Z")], // a long-time player
    ["0xb", Date.parse("2026-09-05T09:00:00Z")], // joined in the first drop
    ["0xc", Date.parse("2026-09-12T09:00:30Z")], // joined in the second
  ]);
  const history = scoreDrops(first, second, firstPull);
  assert.deepEqual(history.map((d) => d.productId), ["sep", "aug"], "newest first");
  assert.deepEqual([history[1].newPlayers, history[1].returningBuyers], [1, 0]);
  assert.deepEqual([history[0].newPlayers, history[0].returningBuyers], [1, 1], "0xa bought the earlier drop");
  // A fresh detection replaces the stored row for the same product.
  const again = scoreDrops(history, detectDrops(run("sep", "2026-09-12T09:00:00Z", 150, ["0xa", "0xc"]), READ_FROM, NOW), firstPull);
  assert.equal(again.length, 2);
  assert.equal(again[0].packs, 150);
});

test("a stored drop that a later read sees still selling is removed, and the next drop rescored", () => {
  const firstPull = new Map([["0xa", Date.parse("2026-01-01T00:00:00Z")]]);
  const history = scoreDrops([], detectDrops([...run("aug", "2026-09-05T09:00:00Z", 100, ["0xa"]), ...run("sep", "2026-09-12T09:00:00Z", 100, ["0xa"])], READ_FROM, NOW), firstPull);
  assert.equal(history[0].returningBuyers, 1);
  // A later read: "aug" sold again three days on, so it was a machine in a lull.
  const later = [...run("aug", "2026-09-05T09:00:00Z", 100, ["0xa"]), ...run("aug", "2026-09-08T09:00:00Z", 5, ["0xz"])];
  const notDrops = sellingPastSpan(later);
  assert.deepEqual([...notDrops], ["aug"]);
  const fixed = scoreDrops(history, detectDrops(later, READ_FROM, NOW), firstPull, notDrops);
  assert.deepEqual(fixed.map((d) => d.productId), ["sep"]);
  assert.equal(fixed[0].returningBuyers, 0, "no earlier drop left to have bought");
  // A read that clips a drop's start never shortens it into a removal.
  assert.equal(sellingPastSpan(run("sep", "2026-09-12T12:00:00Z", 50, ["0xa"])).size, 0);
});

test("the clock starts at the opening burst, not at a pack bought early", () => {
  // The Jun 18 2026 shape: two packs the afternoon before, then the run from 09:00, a pack every 5 seconds.
  const early = run("jun", "2026-06-18T13:56:00Z", 2, ["0xt"]);
  const opening = Date.parse("2026-06-19T09:00:00Z");
  const fast = run("jun", "2026-06-19T09:00:00Z", 998, ["0xa", "0xb", "0xc"]).map((p, i) => ({ ...p, pulled_at: new Date(opening + i * 5_000).toISOString() }));
  const pulls = [...early, ...fast];
  const [d] = detectDrops(pulls, Date.parse("2026-06-01T00:00:00Z"), Date.parse("2026-06-25T00:00:00Z"));
  assert.equal(d.packs, 1000, "early packs still count in the run");
  assert.equal(d.firstAt, "2026-06-18T13:56:00.000Z");
  assert.equal(d.openAt, "2026-06-19T09:00:00.000Z");
});

test("openingOf: the first time a burst follows, else the first time", () => {
  const t0 = Date.parse("2026-09-04T09:00:00Z");
  const burst = Array.from({ length: OPEN_BURST_PACKS }, (_, i) => t0 + i * (OPEN_BURST_MS / OPEN_BURST_PACKS));
  assert.equal(openingOf([t0 - 3_600_000, ...burst]), t0);
  assert.equal(openingOf(burst), t0);
  // Constructed: no burst at all (one pack an hour).
  const slow = Array.from({ length: 20 }, (_, i) => t0 + i * 3_600_000);
  assert.equal(openingOf(slow), t0);
  assert.equal(openingOf([]), null);
});

test("buyers and their packs split three ways: an earlier drop, played before, new to Renaiss", () => {
  // Constructed. Drop one: 0xa two packs, 0xb one. Drop two: 0xa (returning) three, 0xc (played before) two, 0xd (new) one.
  const one = detectDrops(run("one", "2026-09-05T09:00:00Z", 3, ["0xa", "0xb", "0xa"]).concat(run("one", "2026-09-05T09:03:00Z", 97, ["0xa"])), READ_FROM, NOW);
  const twoPulls = [
    ...run("two", "2026-09-12T09:00:00Z", 3, ["0xa"]),
    ...run("two", "2026-09-12T09:03:00Z", 2, ["0xc"]),
    ...run("two", "2026-09-12T09:05:00Z", 95, ["0xd"]),
  ];
  const two = detectDrops(twoPulls, READ_FROM, NOW);
  assert.deepEqual(two[0].buyerPacks, { "0xa": 3, "0xc": 2, "0xd": 95 });
  const firstPull = new Map([
    ["0xa", Date.parse("2026-01-01T00:00:00Z")],
    ["0xb", Date.parse("2026-02-01T00:00:00Z")],
    ["0xc", Date.parse("2026-03-01T00:00:00Z")], // played before, first drop
    ["0xd", Date.parse("2026-09-12T09:05:00Z")], // first pull of all in drop two
  ]);
  const [second] = scoreDrops(one, two, firstPull);
  assert.equal(second.productId, "two");
  assert.deepEqual([second.returningBuyers, second.newPlayers, second.buyers - second.returningBuyers - second.newPlayers], [1, 1, 1]);
  assert.deepEqual([second.packsReturning, second.packsNew, second.packs - second.packsReturning! - second.packsNew!], [3, 95, 2]);
});

test("a row stored before packs per buyer still scores its buyers, with no pack split", () => {
  const legacy: DropRow = {
    productId: "old", name: "Unnamed pack · Jul 3", named: false, priceUsd: 100, packs: 2,
    firstAt: "2026-07-03T09:00:00.000Z", lastAt: "2026-07-03T09:01:00.000Z", buyers: 2,
    buyerWallets: ["0xa", "0xb"], topBuyersSharePct: 100, newPlayers: 0, returningBuyers: 0,
  };
  const [d] = scoreDrops([legacy], [], new Map([["0xb", Date.parse("2026-07-03T09:00:30Z")]]));
  assert.deepEqual(walletsOf(d), ["0xa", "0xb"]);
  assert.equal(d.newPlayers, 1);
  assert.equal(d.packsNew, undefined);
  assert.equal(d.packsReturning, undefined);
});

test("halfOf: the pull that completes half the run", () => {
  assert.equal(halfOf([1, 2, 3, 4]), 2);
  assert.equal(halfOf([1, 2, 3]), 2);
  assert.equal(halfOf([7]), 7);
  assert.equal(halfOf([]), null);
});
