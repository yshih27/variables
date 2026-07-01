/**
 * Warm the CC trait cache by paginating Helius DAS for the entire collection
 * (~122K assets). DAS returns metadata inline, so we map each asset to a `cards`
 * row and upsert.
 *
 *   npx tsx scripts/warm-cc-traits.ts
 *
 * BATCHED WRITES: the old version did one `upsertCards([row])` PER asset — 122K
 * sequential DB round-trips (~50ms each ≈ 100min), which blew the weekly job's
 * timeout and left `cc-traits` stuck "error" in source_freshness. We now buffer
 * rows and flush in chunks (upsertCards already sub-chunks at 500), turning 122K
 * round-trips into ~120 flushes → the crawl finishes in minutes, not hours.
 *
 * Runs weekly (Mondays 04:00 UTC) in its own Actions job.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { iterateCollectionAssets } from "../src/lib/helius/queries";
import { dasAssetToTokenMetadata } from "../src/lib/data/ccTraits";
import { cardRowFromMeta, upsertCards, type CardRow } from "../src/lib/data/cards";
import { PLATFORM_SOURCES } from "../src/lib/data/sources";
import { runWarmer } from "../src/lib/db/runWarmer";

const FLUSH_EVERY = 1000;

async function main() {
  const cc = PLATFORM_SOURCES.find((p) => p.key === "collector-crypt");
  if (!cc || cc.kind !== "helius") throw new Error("CC source not found");

  console.log(`Streaming Collector Crypt collection ${cc.collectionAddress}…`);
  let count = 0;
  const t0 = Date.now();
  let buf: CardRow[] = [];
  const flush = async () => {
    if (buf.length === 0) return;
    await upsertCards(buf);
    buf = [];
  };

  for await (const asset of iterateCollectionAssets(cc.collectionAddress, 1000)) {
    buf.push(cardRowFromMeta("collector-crypt", asset.id, dasAssetToTokenMetadata(asset)));
    count += 1;
    if (buf.length >= FLUSH_EVERY) await flush();
    if (count % 5000 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`  ${count} cached (${(count / Math.max(1, Number(elapsed))).toFixed(0)}/s · ${elapsed}s)`);
    }
  }
  await flush(); // trailing partial batch

  console.log(`Done. ${count} CC NFTs cached in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return { rowsWritten: count };
}

runWarmer("cc-traits", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
