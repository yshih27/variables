/**
 * Taxonomy resets prune the market-cap history blob (pruneHistoryIps), so the
 * daily mcap backfill can't re-create the reset keys' old points.
 *
 *   npm run test:mcap-history
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pruneHistoryIps, type MarketCapHistory } from "./marketcap";

const hist: MarketCapHistory = {
  hourly: [
    { at: "2026-10-20T16:00:00.000Z", totalMcapUsd: 69_000_000, byIp: { pokemon: 57_000_000, other: 191_053, pudgy_penguins: 126_454 } },
    { at: "2026-10-22T16:00:00.000Z", totalMcapUsd: 69_100_000, byIp: { pokemon: 57_100_000, other: 121_378, pudgy_penguins: 156_616 } },
    { at: "2026-10-22T21:53:34.000Z", totalMcapUsd: 69_795_317, byIp: { pokemon: 57_200_000, other: 78_700, nobody_sausage: 42_630 } },
  ],
};

test("readings of the reset keys before the cut-off go; later ones, other keys and totals stay", () => {
  const { hist: out, removed } = pruneHistoryIps(hist, ["other", "pudgy_penguins"], Date.parse("2026-10-22T21:53:00Z"));
  assert.equal(removed, 4);
  assert.deepEqual(out.hourly[0].byIp, { pokemon: 57_000_000 });
  assert.deepEqual(out.hourly[1].byIp, { pokemon: 57_100_000 });
  // The first write of the new taxonomy is kept.
  assert.deepEqual(out.hourly[2].byIp, { pokemon: 57_200_000, other: 78_700, nobody_sausage: 42_630 });
  assert.deepEqual(out.hourly.map((h) => h.totalMcapUsd), [69_000_000, 69_100_000, 69_795_317]);
  // Pure: the input is not changed.
  assert.equal(hist.hourly[0].byIp.other, 191_053);
});

test("nothing before the cut-off, nothing removed", () => {
  assert.equal(pruneHistoryIps(hist, ["other"], Date.parse("2026-01-01T00:00:00Z")).removed, 0);
});
