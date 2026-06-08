/**
 * Warm CC trait cache by paginating Helius DAS for the entire collection.
 * DAS returns metadata inline, so each page of 1000 fills 1000 cache files.
 *
 *   npx tsx scripts/warm-cc-traits.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { iterateCollectionAssets } from "../src/lib/helius/queries";
import { dasAssetToTokenMetadata, writeCCMetadata } from "../src/lib/data/ccTraits";
import { PLATFORM_SOURCES } from "../src/lib/data/sources";
import { runWarmer } from "../src/lib/db/runWarmer";

async function main() {
  const cc = PLATFORM_SOURCES.find((p) => p.key === "collector-crypt");
  if (!cc || cc.kind !== "helius") throw new Error("CC source not found");

  console.log(`Streaming Collector Crypt collection ${cc.collectionAddress}…`);
  let count = 0;
  const t0 = Date.now();
  for await (const asset of iterateCollectionAssets(cc.collectionAddress, 1000)) {
    const meta = dasAssetToTokenMetadata(asset);
    await writeCCMetadata(asset.id, meta);
    count += 1;
    if (count % 500 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`  ${count} cached (${(count / Math.max(1, Number(elapsed))).toFixed(0)}/s · ${elapsed}s)`);
    }
  }
  console.log(`Done. ${count} CC NFTs cached in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return { rowsWritten: count };
}

runWarmer("cc-traits", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
