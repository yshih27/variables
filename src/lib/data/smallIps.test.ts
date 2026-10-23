/**
 * Which IPs the Categories table groups as "Smaller IPs".
 *
 *   npm run test:ip-catalog
 *
 * Values are the live table's on Oct 23 2026 (market cap, trades in the last
 * 24h, the Packs 30d column), except where a case says it is constructed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSmallIp, SMALL_IP_FLOOR_LABEL } from "./smallIps";

const ip = (key: string, mcapUsd: number, trades24h: number) => ({ key, mcapUsd, trades24h });
const PACKS: Record<string, number> = {
  pokemon: 82_455_590, one_piece: 6_819_548, watches: 6_192_000, dragon_ball: 3_478_600, riftbound: 3_426_450,
  soccer: 1_354_775, basketball: 792_175, football: 664_400, baseball: 476_725, lorcana: 358_250, comics: 61_175,
};

test("tiny, quiet IPs that sold no packs are grouped", () => {
  assert.equal(isSmallIp(ip("f1", 515, 0), PACKS), true);
  assert.equal(isSmallIp(ip("veefriends", 30.03, 0), PACKS), true);
  assert.equal(isSmallIp(ip("sneakers", 6.8, 0), PACKS), true);
});

test("market cap, a trade today or pack spend keeps an IP in the main rows", () => {
  assert.equal(isSmallIp(ip("lorcana", 241, 0), PACKS), false); // pack spend
  assert.equal(isSmallIp(ip("hockey", 30_213, 0), PACKS), false); // market cap
  assert.equal(isSmallIp(ip("nobody_sausage", 42_630, 2), PACKS), false);
  assert.equal(isSmallIp(ip("f1", 515, 1), PACKS), false); // constructed: one trade in the last 24h
  assert.equal(isSmallIp(ip("other", 0, 0), PACKS), false); // constructed: the catch-all is never grouped
});

test("an unknown measure is not under the floor", () => {
  // Watches: tokens not indexed, so no market cap or trades (and $6.2M of packs).
  assert.equal(isSmallIp(ip("watches", NaN, NaN), PACKS), false);
  // Constructed: the pack-spend read failed; Lorcana would otherwise look packless.
  assert.equal(isSmallIp(ip("lorcana", 241, 0), null), false);
  assert.equal(isSmallIp(ip("f1", 515, 0), undefined), false);
  // Constructed: no market cap, or an IP's pack spend unknown.
  assert.equal(isSmallIp(ip("f1", NaN, 0), PACKS), false);
  assert.equal(isSmallIp(ip("f1", 515, 0), { ...PACKS, f1: null }), false);
});

test("the rule prints the floor as set", () => {
  assert.equal(SMALL_IP_FLOOR_LABEL, "$10K");
});
