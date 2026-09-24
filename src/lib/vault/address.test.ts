import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWalletAddress, keccak256Hex, toChecksumAddress, base58Decode } from "./address";

test("keccak-256 is Ethereum's (not FIPS sha3-256)", () => {
  assert.equal(keccak256Hex(new Uint8Array()), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(keccak256Hex(new TextEncoder().encode("abc")), "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
});

test("EIP-55 reference vectors round-trip", () => {
  for (const a of [
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
    "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
    "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
  ]) {
    assert.equal(toChecksumAddress(a.slice(2)), a);
  }
});

test("EVM: a valid checksum parses, lower-cased", () => {
  assert.deepEqual(parseWalletAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"), {
    chain: "evm",
    address: "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
  });
});

test("EVM: a mixed-case address that fails the checksum is a typo", () => {
  // One letter's case flipped from the valid form above.
  assert.equal(parseWalletAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD"), null);
  // One character changed, case pattern kept.
  assert.equal(parseWalletAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAee"), null);
});

test("EVM: all-lower and all-upper carry no checksum and are accepted", () => {
  assert.deepEqual(parseWalletAddress("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"), {
    chain: "evm",
    address: "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
  });
  assert.deepEqual(parseWalletAddress("0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED"), {
    chain: "evm",
    address: "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
  });
});

test("EVM: wrong length and non-hex are rejected", () => {
  assert.equal(parseWalletAddress("0x5aaeb6053f3e94c9b9a09f33669435e7ef1bea"), null);
  assert.equal(parseWalletAddress("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed00"), null);
  assert.equal(parseWalletAddress("0xzaaeb6053f3e94c9b9a09f33669435e7ef1beaed"), null);
  assert.equal(parseWalletAddress("5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"), null);
});

test("Solana: a 32-byte base58 key parses, verbatim", () => {
  for (const a of [
    "CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf", // 44 chars
    "11111111111111111111111111111111", // the system program: 32 zero bytes
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  ]) {
    assert.deepEqual(parseWalletAddress(`  ${a}\n`), { chain: "solana", address: a });
  }
  assert.equal(base58Decode("11111111111111111111111111111111")?.length, 32);
});

test("Solana: wrong decoded length and bad alphabet are rejected", () => {
  // 43 chars of "z" decodes to more than 32 bytes.
  assert.equal(parseWalletAddress("z".repeat(44)), null);
  // Valid alphabet, decodes to 31 bytes.
  assert.equal(parseWalletAddress("1111111111111111111111111111111"), null);
  // 0, O, I and l are not base58.
  assert.equal(parseWalletAddress("0Cryptwbyktukhdq2vhgtvcmtjxxyzvw8xnvy64yn2yf"), null);
  assert.equal(parseWalletAddress("CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yl"), null);
});

test("names and empty input are not addresses", () => {
  assert.equal(parseWalletAddress("vitalik.eth"), null);
  assert.equal(parseWalletAddress("toly.sol"), null);
  assert.equal(parseWalletAddress(""), null);
  assert.equal(parseWalletAddress(null), null);
});
