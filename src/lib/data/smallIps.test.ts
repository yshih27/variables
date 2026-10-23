/**
 * Which IPs the Categories table groups as "Smaller IPs".
 *
 *   npm run test:ip-catalog
 *
 * Values are the live table's on Oct 23 2026 (market cap, trades in the last
 * 24h, 30-day pack spend), except where a case says it is constructed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSmallIp, SMALL_IP_FLOOR_LABEL } from "./smallIps";

const ip = (key: string, mcapUsd: number, trades24h: number) => ({ key, mcapUsd, trades24h });

test("tiny, quiet IPs with no pack spend are grouped", () => {
  assert.equal(isSmallIp(ip("f1", 515, 0)), true);
  assert.equal(isSmallIp(ip("veefriends", 30.03, 0), null), true);
  assert.equal(isSmallIp(ip("sneakers", 6.8, 0)), true);
  // Constructed: no market cap at all, nothing else measured.
  assert.equal(isSmallIp(ip("unpriced", NaN, 0)), true);
});

test("market cap, a trade today or pack spend keeps an IP in the main rows", () => {
  assert.equal(isSmallIp(ip("lorcana", 241, 0), 358_250), false); // pack spend
  assert.equal(isSmallIp(ip("watches", NaN, NaN), 6_192_000), false); // pack spend; tokens not indexed
  assert.equal(isSmallIp(ip("hockey", 30_213, 0)), false); // market cap
  assert.equal(isSmallIp(ip("nobody_sausage", 42_630, 2)), false);
  assert.equal(isSmallIp(ip("f1", 515, 1)), false); // constructed: one trade in the last 24h
  assert.equal(isSmallIp(ip("other", 0, 0)), false); // constructed: the catch-all is never grouped
});

test("the rule prints the floor as set", () => {
  assert.equal(SMALL_IP_FLOOR_LABEL, "$10K");
});
