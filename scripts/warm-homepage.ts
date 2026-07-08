/**
 * Homepage payload precompute (B9-1) — derives the ONE snapshot blob that
 * fetchHomepage serves, so a cold page render is a single row read instead of
 * the 14–22s live aggregation (bulk spine reads + per-sale metadata lookups).
 *
 *   npx tsx scripts/warm-homepage.ts
 *
 * PURE DERIVATION: reads only what the other warmers already wrote (core-volume,
 * marketcap, holders, gacha-dune, history, metric spine, cached traits) — zero
 * external API calls. It therefore runs LAST in both the core (6h) and daily
 * batches, after every data step it reads from.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { buildPlatformBuckets } from "../src/lib/data/buckets";
import { buildHomepagePayload, HOMEPAGE_SNAPSHOT_KEY } from "../src/lib/data/fetchHomepage";
import { writeSnapshot } from "../src/lib/db/snapshots";
import { runWarmer } from "../src/lib/db/runWarmer";

async function main() {
  const t0 = Date.now();
  // Pass the uncached buckets builder — unstable_cache (the in-app default)
  // throws "incrementalCache missing" outside the Next server.
  const payload = await buildHomepagePayload(buildPlatformBuckets);

  // Sanity: never overwrite a good blob with a hollow derivation. The readers
  // degrade to empty on DB flakiness (observed: transient Supabase 522s mid-run
  // produced 4 platforms but 0 IPs), so require BOTH tables to be populated —
  // ips is non-empty whenever readMarketCap worked (mcap-only rows union in),
  // so 0 ips always means the underlying reads failed, not a quiet market.
  if (payload.platforms.length === 0 || payload.ips.length === 0) {
    throw new Error(
      `derived payload is hollow (${payload.platforms.length} platforms, ${payload.ips.length} ips) — ` +
        "upstream reads failed; keeping previous blob",
    );
  }

  await writeSnapshot(HOMEPAGE_SNAPSHOT_KEY, payload);
  console.log(
    `Homepage payload precomputed in ${((Date.now() - t0) / 1000).toFixed(1)}s · ` +
      `${payload.ips.length} IPs · ${payload.platforms.length} platforms · ` +
      `${payload.topSales.length} top sales · 24h vol $${Math.round(payload.hero.vol24Usd).toLocaleString()}`,
  );
  return { rowsWritten: 1 };
}

runWarmer("homepage", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
