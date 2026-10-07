/**
 * Renaiss sales warmer — pages Renaiss's marketplace sales (its own index API,
 * BNB Smart Chain) into `renaiss_sales`, and writes a `cards` row the first time
 * a linked sale names a slab.
 *
 *   npx tsx scripts/warm-renaiss-sales.ts                     # DRY RUN, incremental (the default)
 *   npx tsx scripts/warm-renaiss-sales.ts --apply             # incremental: a day before the newest stored sale
 *   npx tsx scripts/warm-renaiss-sales.ts --backfill --apply  # full history, from the oldest row (Jan 9, 2026)
 *   npx tsx scripts/warm-renaiss-sales.ts --dry-run --limit 3 # at most 3 pages, writes nothing
 *
 * ⚠️ WRITES ONLY WITH --apply. ⚠️ NO KEY, NO RUN: without RENAISS_API_KEY and
 * RENAISS_API_SECRET it prints one line and exits 0 (the anonymous tier is 10
 * requests a day). ⚠️ REQUIRES supabase/migrations/20260930000001 for --apply.
 * Every flag and rule lives in src/lib/renaiss/warm.ts.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { runRenaissWarmer } from "../src/lib/renaiss/warm";

runRenaissWarmer("sales", process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
