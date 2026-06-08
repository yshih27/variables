/**
 * Pre-warm Collector Crypt's 24h sales feed via Helius Enhanced TX.
 * Writes the `cc-sales` Postgres snapshot (read by the homepage/buckets so
 * Helius rate limits never block a render).
 *
 *   npx tsx scripts/warm-cc-sales.ts
 *
 * NOTE: the Helius marketplace-program scan is the known-undercounting path
 * (≈3.6× low vs Dune) and is being replaced by the Dune-backed core-volume
 * warmer — see plan Phase 2. Kept only until that cutover lands.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { collectCCSales } from "../src/lib/helius/queries";
import { writeCCSales } from "../src/lib/data/ccSalesCache";
import { PLATFORM_SOURCES } from "../src/lib/data/sources";
import { runWarmer } from "../src/lib/db/runWarmer";

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const cc = PLATFORM_SOURCES.find((p) => p.key === "collector-crypt");
  if (!cc || cc.kind !== "helius") throw new Error("CC source missing");

  const t0 = Date.now();
  console.log(`Pulling CC 24h sales from Helius marketplace program ${cc.marketplaceProgram}…`);
  const sales = await collectCCSales(cc.marketplaceProgram, DAY);
  const volume = sales.reduce((s, x) => s + x.priceUsd, 0);
  await writeCCSales({ generatedAt: new Date().toISOString(), sales });
  console.log(
    `Wrote cc-sales snapshot: ${sales.length} sales, $${volume.toFixed(0)} 24h vol (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
  );
  return { rowsWritten: sales.length };
}

runWarmer("cc-sales", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
