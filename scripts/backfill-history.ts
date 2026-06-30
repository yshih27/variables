/**
 * Backfill 7d hourly history per platform.
 * Slow on first run (~90s for Beezie's 38K sales); incremental updates are fast.
 *
 *   npx tsx scripts/backfill-history.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { PLATFORM_SOURCES } from "../src/lib/data/sources";
import { collectSales, type NormalizedSale } from "../src/lib/rarible/queries";
import { fetchBeezieSales } from "../src/lib/beezie/market";
import { fetchCCSecondarySales } from "../src/lib/data/warmers/core";
import { bucketsFromSales, writeHistory, writeIpHistory, type HourBucket } from "../src/lib/data/history";
import { getBeezieMetadataCachedOnly, extractCategoryHints } from "../src/lib/data/beezieTraits";
import { getCCMetadataCachedOnly } from "../src/lib/data/ccTraits";
import { classifyIP } from "../src/lib/data/ipCatalog";
import type { TokenMetadata } from "../src/lib/onchain/tokenUri";
import { runWarmer } from "../src/lib/db/runWarmer";

const HOUR_MS = 60 * 60 * 1000;

async function main() {
  let platforms = 0;
  // Per-IP sales accumulated across platforms (Beezie + CC, which have metadata
  // readers — the same scope fetchIP enriches). Bucketed into history:by-ip below.
  const ipSales = new Map<string, NormalizedSale[]>();
  for (const p of PLATFORM_SOURCES) {
    // CC: Dune cached results (no Helius 429 — the old collectCCSales path that
    // left history:collector-crypt 32 days stale). Rarible for Beezie/Courtyard.
    let sales: NormalizedSale[];
    if (p.key === "collector-crypt") {
      sales = await fetchCCSecondarySales({ cachedOnly: true });
    } else if (p.key === "beezie") {
      sales = await fetchBeezieSales(168 * HOUR_MS); // native /activity, not Rarible
    } else if (p.kind === "rarible") {
      // Courtyard (still on Rarible). Its shared quota may be exhausted — don't
      // let that sink Beezie + CC history; skip this platform on failure.
      try {
        sales = await collectSales(p.collectionId, 168 * HOUR_MS);
      } catch (err) {
        console.warn(`→ ${p.name}: Rarible failed (${(err as Error).message.slice(0, 80)}) — skipped`);
        continue;
      }
    } else {
      continue; // no secondary-sales source yet (e.g. Phygitals)
    }
    const t0 = Date.now();
    const buckets = bucketsFromSales(sales, 168);
    await writeHistory(p.key, { generatedAt: new Date().toISOString(), buckets });
    platforms += 1;
    const totalVol = buckets.reduce((s, b) => s + b.volumeUsd, 0);
    console.log(
      `→ ${p.name}: ${sales.length} 7d sales · $${totalVol.toFixed(0)} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
    );

    // Per-IP rollup — classify each sale by IP via its cached metadata. Only
    // Beezie + CC have a reader; Courtyard/Phygitals are skipped (as in fetchIP).
    let metas: Map<string, TokenMetadata> | null = null;
    if (p.key === "collector-crypt") {
      metas = await getCCMetadataCachedOnly(sales.map((s) => s.tokenId));
    } else if (p.key === "beezie") {
      metas = await getBeezieMetadataCachedOnly(sales.map((s) => s.tokenId));
    }
    if (metas) {
      for (const s of sales) {
        const meta = metas.get(s.tokenId);
        if (!meta) continue;
        const ipKey = classifyIP(extractCategoryHints(meta)).key;
        let arr = ipSales.get(ipKey);
        if (!arr) {
          arr = [];
          ipSales.set(ipKey, arr);
        }
        arr.push(s);
      }
    }
  }

  // Per-IP 7d hourly history (history:by-ip) → IP pages get 7d vol + 24h change.
  const byIp: Record<string, HourBucket[]> = {};
  for (const [ipKey, ipSaleRows] of ipSales) byIp[ipKey] = bucketsFromSales(ipSaleRows, 168);
  await writeIpHistory({ generatedAt: new Date().toISOString(), byIp });
  console.log(`→ per-IP history: ${Object.keys(byIp).length} IPs bucketed`);

  return { rowsWritten: platforms };
}

runWarmer("history", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
