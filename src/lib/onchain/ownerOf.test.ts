import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeOwnerOfMulticall, decodeOwnerOfMulticall } from "./ownerOf";

const w = (hex: string) => hex.padStart(64, "0");
const n = (x: number) => x.toString(16).padStart(64, "0");

test("aggregate3 call data: selector, one tuple per token, ownerOf(id) inside", () => {
  const data = encodeOwnerOfMulticall("0xBB5EC6FD4B61723BD45C399840F1D868840CA16F", ["8306", "17685"]);
  assert.ok(data.startsWith("0x82ad56cb"));
  const body = data.slice(10);
  assert.equal(body.length % 64, 0);
  // head (offset + length) + 2 offsets + 2 tuples of 6 words
  assert.equal(body.length / 64, 2 + 2 + 12);
  assert.ok(body.includes(`6352211e${n(8306)}`));
  assert.ok(body.includes(`6352211e${n(17685)}`));
  assert.ok(body.includes(w("bb5ec6fd4b61723bd45c399840f1d868840ca16f")));
});

test("decode: an owner, and a revert read as 'none'", () => {
  const owner = "48c27ef6218bc4f0714dd00df6941868b1afa54a";
  // (bool,bytes)[] with [ (true, abi(address)), (false, 0xdf2d9b42 ‖ id) ]
  const t0 = n(1) + n(0x40) + n(32) + w(owner); // 4 words
  const revert = "df2d9b42" + n(17685); // 36 bytes
  const t1 = n(0) + n(0x40) + n(36) + revert.padEnd(128, "0"); // 5 words
  const result = "0x" + n(0x20) + n(2) + n(64) + n(64 + 4 * 32) + t0 + t1;
  const out = decodeOwnerOfMulticall(result, ["8306", "17685"]);
  assert.equal(out.get("8306"), `0x${owner}`);
  assert.equal(out.get("17685"), "none");
});

test("decode refuses a result whose length does not match the calls", () => {
  const result = "0x" + n(0x20) + n(0);
  assert.throws(() => decodeOwnerOfMulticall(result, ["1"]));
});
