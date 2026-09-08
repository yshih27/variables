/**
 * Price-index warmer — builds the sale-price panel, computes the constant-quality
 * REPEAT-SALES weekly price index per IP, builds category + market indices over
 * POOLED pairs, and stores them in the `price-index` snapshot blob.
 *
 *   npx tsx scripts/warm-sale-panel.ts
 *
 * readIndexSeries(kind:"price", …) serves from this blob. Thin IPs fail the
 * liquidity floor (see repeatSalesIndex.ts) and are simply absent → "insufficient
 * data"; there is deliberately NO fallback to the old cell method for them.
 * Isolated + time-bounded in its own warm job so it can't starve the daily batch.
 *
 * ⚠️ AGGREGATES ARE NOT ROLL-UPS ANY MORE. V-MKT and the category indices are built
 * from the pooled pairs of their members, not as cap-weighted means of the IP
 * indices. A weighted mean lets a thin IP inject its noise through its weight; a
 * pooled pair set simply has more pairs. Nothing calls `rollupIndex` or
 * `stratifiedMedianIndex` any more; both stay exported from priceIndex.ts so the
 * old series can be regenerated for comparison (the PR's before/after table is
 * built that way), not because anything ships them.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { buildSalePanel, type SaleRow } from "../src/lib/data/salePanel";
import {
  repeatSalesIndex,
  MIN_PAIRS_BROAD,
  MIN_PAIRS_IP,
} from "../src/lib/data/repeatSalesIndex";
import type { IndexPoint } from "../src/lib/data/indices";
import { ipsInCategory, type IPCategory } from "../src/lib/data/ipCatalog";
import { writeSnapshot } from "../src/lib/db/snapshots";
import { holdingPeriodInvariance } from "../src/lib/data/biasTests";
import { runWarmer } from "../src/lib/db/runWarmer";

async function main() {
  const panel = await buildSalePanel();

  // Group sales by IP (skip "other" — no publishable single-IP index).
  const byIp = new Map<string, SaleRow[]>();
  for (const r of panel) {
    if (r.ip === "other") continue;
    const a = byIp.get(r.ip);
    if (a) a.push(r);
    else byIp.set(r.ip, [r]);
  }

  const series: Record<string, IndexPoint[]> = {};
  const gated: string[] = [];
  for (const [ip, sales] of byIp) {
    const idx = repeatSalesIndex(sales, { minPairs: MIN_PAIRS_IP });
    if (idx.length) series[`ip:${ip}`] = idx;
    else gated.push(`${ip}(${sales.length})`); // too few repeat pairs — publish nothing
  }

  // Categories + market: POOLED pairs, same estimator, broader liquidity floor.
  for (const cat of ["tcg", "sports", "other"] as IPCategory[]) {
    const members = new Set(ipsInCategory(cat));
    const pooled = panel.filter((r) => members.has(r.ip));
    const idx = repeatSalesIndex(pooled, { minPairs: MIN_PAIRS_BROAD });
    if (idx.length) series[`category:${cat}`] = idx;
  }

  const market = repeatSalesIndex(
    panel.filter((r) => r.ip !== "other"),
    { minPairs: MIN_PAIRS_BROAD },
  );
  if (market.length) series["market:total"] = market;

  // INV-12 input: the holding-period invariance test is computed on EVERY index
  // rebuild and stored with the series, so check-invariants can flag a selection
  // bias without re-paying the panel's full dims join. See biasTests.ts for why a
  // smoothness test could not catch what v2 was doing.
  const invariance = holdingPeriodInvariance(panel.filter((r) => r.ip !== "other"));
  console.log(
    `  holding-period invariance: ${invariance.buckets.map((b) => `${b.label}=${b.perWeekPct.toFixed(2)}%/wk(n=${b.n})`).join(" ")} ` +
      `· spread ${invariance.spreadPP.toFixed(2)}pp · ${invariance.pass ? "pass" : "FLAG"}`,
  );

  const now = new Date().toISOString();
  await writeSnapshot("price-index", { generatedAt: now, series, biasTests: { invariance } }, now);

  const published = Object.keys(series);
  console.log(
    `Wrote price-index: ${published.length} series from ${panel.length} panel sales · ` +
      `published: ${published.join(", ") || "none"} · gated(thin): ${gated.join(", ") || "none"}`,
  );
  return { rowsWritten: published.length };
}

runWarmer("price-index", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
