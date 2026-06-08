/**
 * Backfill 7d hourly history per platform.
 * Slow on first run (~90s for Beezie's 38K sales); incremental updates are fast.
 *
 *   npx tsx scripts/backfill-history.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { PLATFORM_SOURCES } from "../src/lib/data/sources";
import { collectSales } from "../src/lib/rarible/queries";
import { collectCCSales } from "../src/lib/helius/queries";
import { bucketsFromSales, writeHistory } from "../src/lib/data/history";
import { runWarmer } from "../src/lib/db/runWarmer";

const HOUR_MS = 60 * 60 * 1000;

async function main() {
  for (const p of PLATFORM_SOURCES) {
    process.stdout.write(`→ ${p.name} — fetching 7d sales… `);
    const t0 = Date.now();
    const sales =
      p.kind === "helius"
        ? await collectCCSales(p.marketplaceProgram, 168 * HOUR_MS)
        : await collectSales(p.collectionId, 168 * HOUR_MS);
    const buckets = bucketsFromSales(sales, 168);
    await writeHistory(p.key, { generatedAt: new Date().toISOString(), buckets });
    const totalVol = buckets.reduce((s, b) => s + b.volumeUsd, 0);
    console.log(
      `done in ${((Date.now() - t0) / 1000).toFixed(0)}s — ${sales.length} sales, $${totalVol.toFixed(0)} 7d`,
    );
  }
  return { rowsWritten: PLATFORM_SOURCES.length };
}

runWarmer("history", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
