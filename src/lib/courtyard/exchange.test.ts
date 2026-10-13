import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeTradeLog, COURTYARD_OPS_WALLET, TRADE_EXECUTED_TOPIC0, type RawLog } from "./exchange";

// A real peer-to-peer trade, read from Polygon on Oct 13 2026 (block 0x5b065c9).
const P2P: RawLog = {
  address: "0x5e4943373c2198625bd441ae0629e9e7b4fb4797",
  topics: [
    TRADE_EXECUTED_TOPIC0,
    "0x000000000000000000000000cbde16459e7c29aa1146a5ce8603e6be8853900c",
    "0x00000000000000000000000098cabf4379d79797bd96acc54f061f84eeece63d",
    "0x188190cccb215523216e87e27ece657f8faca9abc5ed5184884f2a859150414f",
  ],
  data:
    "0x0000000000000000000000003c499c542cef5e3811e1192ce70d8cc03d5c3359" +
    "00000000000000000000000000000000000000000000000000000000029a8100" +
    "0000000000000000000000000000000000000000000000000000000000000080" +
    "0000000000000000000000000000000000000000000000000000000000000000",
  blockNumber: "0x5b065c9",
  transactionHash: "0xC6187237527C2A6CB58167B9EE1554C8896093D392B381C2F795F9626761FB29",
  logIndex: "0xaf",
  blockTimestamp: "0x6acdd7bd",
  removed: false,
};

test("a peer-to-peer trade decodes with its price, parties, token and time", () => {
  const t = decodeTradeLog(P2P)!;
  assert.equal(t.kind, "p2p");
  assert.equal(t.usd, 43.68);
  assert.equal(t.bidder, "0xcbde16459e7c29aa1146a5ce8603e6be8853900c");
  assert.equal(t.asker, "0x98cabf4379d79797bd96acc54f061f84eeece63d");
  assert.equal(t.tokenId, BigInt(P2P.topics[3]).toString());
  assert.equal(t.logIndex, 0xaf);
  assert.equal(t.blockNumber, 0x5b065c9);
  assert.equal(t.ts, new Date(0x6acdd7bd * 1000).toISOString());
  assert.equal(t.txHash, P2P.transactionHash.toLowerCase());
});

test("Courtyard's own wallet as bidder is a buyback, not resale", () => {
  const bb = { ...P2P, topics: [P2P.topics[0], `0x000000000000000000000000${COURTYARD_OPS_WALLET.slice(2)}`, P2P.topics[2], P2P.topics[3]] };
  assert.equal(decodeTradeLog(bb)!.kind, "buyback");
});

test("anything that is not a USDC trade on a Courtyard exchange is dropped", () => {
  assert.equal(decodeTradeLog({ ...P2P, removed: true }), null);
  assert.equal(decodeTradeLog({ ...P2P, address: "0x0000000000000000000000000000000000000001" }), null);
  assert.equal(decodeTradeLog({ ...P2P, topics: ["0x" + "1".repeat(64), ...P2P.topics.slice(1)] }), null);
  const weth = P2P.data.replace("3c499c542cef5e3811e1192ce70d8cc03d5c3359", "7ceb23fd6bc0add59e62ac25578270cff1b9f619");
  assert.equal(decodeTradeLog({ ...P2P, data: weth }), null);
  const zero = P2P.data.replace("00000000000000000000000000000000000000000000000000000000029a8100", "0".repeat(64));
  assert.equal(decodeTradeLog({ ...P2P, data: zero }), null);
  assert.equal(decodeTradeLog({ ...P2P, blockTimestamp: undefined }), null);
});
