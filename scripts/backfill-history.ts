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
import { fetchCCSecondarySales } from "../src/lib/data/warmers/core";
import { bucketsFromSales, writeHistory } from "../src/lib/data/history";
import { runWarmer } from "../src/lib/db/runWarmer";

const HOUR_MS = 60 * 60 * 1000;

async function main() {
  let platforms = 0;
  for (const p of PLATFORM_SOURCES) {
    // CC: Dune cached results (no Helius 429 — the old collectCCSales path that
    // left history:collector-crypt 32 days stale). Rarible for Beezie/Courtyard.
    let sales: NormalizedSale[];
    if (p.key === "collector-crypt") {
      sales = await fetchCCSecondarySales({ cachedOnly: true });
    } else if (p.kind === "rarible") {
      sales = await collectSales(p.collectionId, 168 * HOUR_MS);
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
  }
  return { rowsWritten: platforms };
}

runWarmer("history", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
