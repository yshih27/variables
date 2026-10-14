import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVenueSpend } from "./venueSpend";
import type { PlatformPlayerAnalytics } from "./playerAnalytics";

const player = (platform: string, top1: number, top10: number, spend: number, from: string, to: string): PlatformPlayerAnalytics =>
  ({
    platform,
    coverage: { rows: 1, walletAttributedRows: 1, pricedRows: 1, firstPullAt: `${from}T05:00:00Z`, lastPullAt: `${to}T20:00:00Z` },
    tiers: [],
    monthly: [],
    concentration: { totalWallets: 100, totalSpendUsd: spend, avgLifetimeSpendUsd: 1, medianLifetimeSpendUsd: 10, top1PctShare: top1, top10PctShare: top10, activeWallets30d: 1 },
  }) as PlatformPlayerAnalytics;
const daily = (from: string, n: number, v: number) => Array.from({ length: n }, (_, i) => ({ ts: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString(), value: v }));

test("measured venues by the top 1%'s share; coverage over each venue's own days; no wallets = not measured", () => {
  const rows = buildVenueSpend(
    [player("broad", 13.6, 57.4, 300, "2026-10-01", "2026-10-03"), player("whales", 71, 95.9, 150, "2026-10-02", "2026-10-03")],
    { broad: daily("2026-09-25", 10, 100), whales: daily("2026-09-25", 10, 100), boxes: daily("2026-09-25", 10, 100) },
    ["broad", "whales", "boxes"],
  );
  assert.deepEqual(rows.map((r) => r.venue), ["whales", "broad", "boxes"]);
  assert.equal(rows[0].coveragePct, 75, "150 of the 200 spent Oct 2-3");
  assert.equal(rows[1].coveragePct, 100, "300 of the 300 spent Oct 1-3");
  assert.equal(rows[1].since, "2026-10-01");
  assert.equal(rows[2].measured, false);
  assert.equal(rows[2].top1Pct, null);
});
