import { test } from "node:test";
import assert from "node:assert/strict";
import { ArbitrageMatcher, ARBITRAGE_WINDOW_MS, arbitrageIds, exchangeSaleId, tallyByDay } from "./arbitrage";
import { COURTYARD_OPS_WALLET, type ExchangeTrade } from "./exchange";

const H = 3_600_000;
const T0 = Date.parse("2026-08-03T12:00:00Z");
const BOT = "0x48c4a3ae57c5d0964dcc43ee59f0ebe1979aec41";
const PLAYER = "0x00000000000000000000000000000000000000a1";
const COLLECTOR = "0x00000000000000000000000000000000000000c1";

let seq = 0;
const trade = (kind: "p2p" | "buyback", bidder: string, asker: string, tokenId: string, atMs: number, usd = 20): ExchangeTrade => ({
  txHash: `0x${(++seq).toString(16).padStart(64, "0")}`,
  logIndex: 0,
  blockNumber: seq,
  ts: new Date(atMs).toISOString(),
  bidder,
  asker,
  tokenId,
  usd,
  kind,
});
const buy = (bidder: string, seller: string, tokenId: string, atMs: number, usd?: number) => trade("p2p", bidder, seller, tokenId, atMs, usd);
const sellToCourtyard = (seller: string, tokenId: string, atMs: number, usd?: number) => trade("buyback", COURTYARD_OPS_WALLET, seller, tokenId, atMs, usd);

test("a purchase sold to Courtyard's buyback within 24 hours is arbitrage", () => {
  const p = buy(BOT, PLAYER, "7", T0);
  const ids = arbitrageIds([p, sellToCourtyard(BOT, "7", T0 + 3 * 60_000)]);
  assert.deepEqual([...ids], [exchangeSaleId(p)]);
});

test("a purchase and its buyback in the same block match", () => {
  const p = buy(BOT, PLAYER, "7", T0);
  assert.equal(arbitrageIds([p, sellToCourtyard(BOT, "7", T0)]).size, 1);
});

test("a buyback after the window, by another wallet, or of another card is not arbitrage", () => {
  const p = buy(BOT, PLAYER, "7", T0);
  assert.equal(arbitrageIds([p, sellToCourtyard(BOT, "7", T0 + ARBITRAGE_WINDOW_MS + 1)]).size, 0, "after 24 h");
  assert.equal(arbitrageIds([p, sellToCourtyard(PLAYER, "7", T0 + H)]).size, 0, "the seller, not the buyer");
  assert.equal(arbitrageIds([p, sellToCourtyard(BOT, "8", T0 + H)]).size, 0, "another card");
});

test("a buyback never settles a purchase that comes after it", () => {
  const ids = arbitrageIds([sellToCourtyard(BOT, "7", T0), buy(BOT, PLAYER, "7", T0 + H)]);
  assert.equal(ids.size, 0);
});

test("one buyback settles one purchase: the wallet's latest open one", () => {
  const first = buy(BOT, PLAYER, "7", T0);
  const second = buy(BOT, COLLECTOR, "7", T0 + 2 * H);
  const ids = arbitrageIds([first, second, sellToCourtyard(BOT, "7", T0 + 3 * H)]);
  assert.deepEqual([...ids], [exchangeSaleId(second)]);
});

test("a collector who keeps the card is resale; the bot's round trips are not (Aug 3, in miniature)", () => {
  const trades = [
    buy(BOT, PLAYER, "1", T0, 19),
    buy(COLLECTOR, PLAYER, "2", T0 + 60_000, 120),
    sellToCourtyard(BOT, "1", T0 + 5 * 60_000, 21),
    buy(BOT, PLAYER, "3", T0 + 10 * 60_000, 18),
    sellToCourtyard(BOT, "3", T0 + 12 * 60_000, 20),
  ];
  const arb = arbitrageIds(trades);
  const day = tallyByDay(trades, arb).get("2026-08-03T00:00:00.000Z")!;
  assert.deepEqual(day, { resaleN: 1, resaleUsd: 120, arbN: 2, arbUsd: 37, buybackN: 2, buybackUsd: 41 });
});

test("the matcher carries purchases across reads, and prune forgets only what can no longer match", () => {
  const m = new ArbitrageMatcher();
  m.purchase({ id: "a", bidder: BOT, tokenId: "7", ms: T0 });
  m.purchase({ id: "b", bidder: BOT, tokenId: "9", ms: T0 + 20 * H });
  m.prune(T0 + ARBITRAGE_WINDOW_MS + 1);
  assert.equal(m.pending, 1, "a is past its window, b is not");
  assert.equal(m.buyback(BOT, "7", T0 + 23 * H), null);
  assert.equal(m.buyback(BOT, "9", T0 + 23 * H), "b");
  assert.equal(m.pending, 0);
});
