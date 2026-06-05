/**
 * Beezie trait warmer. Reads the last 24h of Beezie sales from Rarible and
 * fetches metadata for every tokenId not yet in the Postgres `cards` table,
 * at low concurrency (Beezie's CF rate limit). getBeezieMetadata persists each
 * result to Postgres. Safe to abort and resume.
 *
 *   npx tsx scripts/warm-traits.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { collectSales } from "../src/lib/rarible/queries";
import { getBeezieMetadata } from "../src/lib/data/beezieTraits";
import { readCards } from "../src/lib/data/cards";

const BEEZIE = "BASE:0xbb5ec6fd4b61723bd45c399840f1d868840ca16f";
const DAY = 24 * 60 * 60 * 1000;

async function main() {
  console.log("Pulling 24h Beezie sales…");
  const sales = await collectSales(BEEZIE, DAY);
  const unique = Array.from(new Set(sales.map((s) => s.tokenId)));
  console.log(`  ${sales.length} sales, ${unique.length} unique tokens`);

  // Which tokenIds are already in Postgres?
  const present = await readCards("beezie", unique);
  const missing = unique.filter((id) => !present.has(id));
  console.log(`  cached: ${unique.length - missing.length} | missing: ${missing.length}`);
  if (missing.length === 0) {
    console.log("Nothing to fetch.");
    return;
  }

  console.log("Fetching missing metadata at concurrency=2 with 200ms delay…");
  let done = 0;
  let failed = 0;
  const start = Date.now();
  const queue = [...missing];

  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      if (!id) return;
      const meta = await getBeezieMetadata(id); // persists to Postgres on success
      done += 1;
      if (!meta) failed += 1;
      if (done % 25 === 0) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(0);
        const rate = (done / Math.max(1, Number(elapsed))).toFixed(1);
        console.log(`  ${done}/${missing.length} (${rate}/s · ${failed} failed · ${elapsed}s)`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  await Promise.all([worker(), worker()]);
  console.log(`Done. fetched=${done - failed} failed=${failed} in ${((Date.now() - start) / 1000).toFixed(0)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
