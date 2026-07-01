/**
 * Price-index warmer — builds the sale-price panel, computes the constant-quality
 * stratified-median weekly price index per IP, rolls up cap-weighted category +
 * market indices, and stores them in the `price-index` snapshot blob.
 *
 *   npx tsx scripts/warm-sale-panel.ts
 *
 * readIndexSeries(kind:"price", …) serves from this blob. Thin IPs fail the
 * liquidity floor (see priceIndex.ts) and are simply absent → "insufficient data".
 * Isolated + time-bounded in its own warm job so it can't starve the daily batch.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { buildSalePanel, type SaleRow } from "../src/lib/data/salePanel";
import { stratifiedMedianIndex, rollupIndex } from "../src/lib/data/priceIndex";
import type { IndexPoint } from "../src/lib/data/indices";
import { readMetricSeries } from "../src/lib/data/metricSnapshots";
import { ipsInCategory, type IPCategory } from "../src/lib/data/ipCatalog";
import { writeSnapshot } from "../src/lib/db/snapshots";
import { runWarmer } from "../src/lib/db/runWarmer";

async function main() {
  const panel = await buildSalePanel({ cachedOnly: true });

  // Group sales by IP (skip "other" — no publishable single-IP index).
  const byIp = new Map<string, SaleRow[]>();
  for (const r of panel) {
    if (r.ip === "other") continue;
    const a = byIp.get(r.ip);
    if (a) a.push(r);
    else byIp.set(r.ip, [r]);
  }

  const series: Record<string, IndexPoint[]> = {};
  const ipIndex = new Map<string, IndexPoint[]>();
  const gated: string[] = [];
  for (const [ip, sales] of byIp) {
    const idx = stratifiedMedianIndex(sales);
    if (idx.length) {
      series[`ip:${ip}`] = idx;
      ipIndex.set(ip, idx);
    } else {
      gated.push(`${ip}(${sales.length})`); // failed the liquidity floor
    }
  }

  // Cap weights = latest mcap per qualifying IP (from the spine).
  const weights = new Map<string, number>();
  for (const ip of ipIndex.keys()) {
    const m = await readMetricSeries("ip", ip, "mcap_usd");
    weights.set(ip, m.length ? m[m.length - 1].value : 0);
  }

  // Category roll-ups (cap-weighted, chained divisor).
  for (const cat of ["tcg", "sports", "other"] as IPCategory[]) {
    const members = new Map<string, IndexPoint[]>();
    for (const ip of ipsInCategory(cat)) {
      const s = ipIndex.get(ip);
      if (s) members.set(ip, s);
    }
    const idx = rollupIndex(members, weights);
    if (idx.length) series[`category:${cat}`] = idx;
  }

  // Market roll-up = all qualifying IP indices, cap-weighted.
  const market = rollupIndex(ipIndex, weights);
  if (market.length) series["market:total"] = market;

  const now = new Date().toISOString();
  await writeSnapshot("price-index", { generatedAt: now, series }, now);

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
