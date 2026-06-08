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

const pagesArg = process.argv.indexOf("--pages");
const maxPages = pagesArg >= 0 ? Number(process.argv[pagesArg + 1]) : undefined;

runPhygitalsWarm({ maxPages, log: (m) => console.log(m) })
  .then((r) => console.log(`\n✓ Phygitals: ${r.cards} cards, ${r.listings} listings, floor $${r.floorUsd?.toFixed(2) ?? "—"}`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
