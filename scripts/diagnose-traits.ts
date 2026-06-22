/** Diagnose: how many Beezie 24h-sold tokens have cached metadata, and what does the rest look like? */
import { config } from "dotenv";
config({ path: ".env.local" });

import { promises as fs } from "node:fs";
import path from "node:path";
import { collectSales } from "../src/lib/rarible/queries";
import { getTokenMetadata } from "../src/lib/onchain/tokenUri";

const BEEZIE = "BASE:0xbb5ec6fd4b61723bd45c399840f1d868840ca16f";
const CACHE_DIR = path.join(process.cwd(), ".cache", "beezie-traits");

async function isCached(tokenId: string): Promise<boolean> {
  try {
    await fs.stat(path.join(CACHE_DIR, `${tokenId}.json`));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log("Pulling 24h Beezie sales...");
  const sales = await collectSales(BEEZIE, 24 * 60 * 60 * 1000);
  console.log(`  ${sales.length} sales, $${sales.reduce((s, x) => s + x.priceUsd, 0).toFixed(0)} total`);

  const uniq = new Map<string, number>();
  for (const s of sales) uniq.set(s.tokenId, (uniq.get(s.tokenId) ?? 0) + s.priceUsd);
  console.log(`  ${uniq.size} unique tokens`);

  const missing: { tokenId: string; volume: number }[] = [];
  for (const [tid, vol] of uniq) {
    if (!(await isCached(tid))) missing.push({ tokenId: tid, volume: vol });
  }
  missing.sort((a, b) => b.volume - a.volume);
  console.log(`  ${uniq.size - missing.length} cached, ${missing.length} missing`);
  console.log(`  missing-tokens volume: $${missing.reduce((s, m) => s + m.volume, 0).toFixed(0)}`);

  console.log("\nTop 5 missing tokens by volume — fetch a sample and report:");
  const sample = missing.slice(0, 5);
  for (const { tokenId, volume } of sample) {
    process.stdout.write(`  ${tokenId} ($${volume.toFixed(0)}): `);
    try {
      const meta = await getTokenMetadata("base", "0xbb5ec6fd4b61723bd45c399840f1d868840ca16f", tokenId);
      if (!meta) {
        console.log("FETCH FAILED");
        continue;
      }
      const cat = meta.attributes?.find((a) => a.trait_type === "Category")?.value;
      console.log(`name=${meta.name?.slice(0, 60)} | Category=${cat}`);
    } catch (e) {
      console.log(`ERROR ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
