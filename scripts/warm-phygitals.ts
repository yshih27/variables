/**
 * Phygitals marketplace warmer — CLI.
 *
 *   npx tsx scripts/warm-phygitals.ts            # default 30 pages
 *   npx tsx scripts/warm-phygitals.ts --pages 5  # limit pages (testing)
 *
 * Writes Phygitals cards + listings + headline stats to Postgres.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { runPhygitalsWarm } from "../src/lib/data/warmers/phygitals";
import { runWarmer } from "../src/lib/db/runWarmer";

const pagesArg = process.argv.indexOf("--pages");
const maxPages = pagesArg >= 0 ? Number(process.argv[pagesArg + 1]) : undefined;

// runWarmer records an honest source_freshness row on EVERY outcome — including
// failure (status "error") — so a rate-limited crawl can never again rot silently
// as "stale". It re-throws, so the Actions step still surfaces red.
runWarmer("phygitals", async () => {
  const r = await runPhygitalsWarm({ maxPages, log: (m) => console.log(m) });
  console.log(`\n✓ Phygitals: ${r.cards} cards, ${r.listings} listings, floor $${r.floorUsd?.toFixed(2) ?? "—"}`);
  return { rowsWritten: r.cards };
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
