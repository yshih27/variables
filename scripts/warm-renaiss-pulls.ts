/**
 * Renaiss pack-pulls warmer — pages Renaiss's pack pulls (its own index API)
 * into their own table, `renaiss_pulls`. A pull writes no `cards` row: its
 * prize's identity key and card fields ride on the pull row.
 *
 *   npx tsx scripts/warm-renaiss-pulls.ts                     # DRY RUN, incremental (the default)
 *   npx tsx scripts/warm-renaiss-pulls.ts --apply             # incremental: re-reads the trailing window
 *                                                             # (PULLS_REREAD_DAYS), writes only new or changed pulls
 *   npx tsx scripts/warm-renaiss-pulls.ts --backfill --apply  # full history, from the oldest row (Nov 6, 2025)
 *   npx tsx scripts/warm-renaiss-pulls.ts --dry-run --limit 3 # at most 3 pages, writes nothing
 *
 * ⚠️ WRITES ONLY WITH --apply. ⚠️ NO KEY, NO RUN (as the sales warmer).
 * ⚠️ RENAISS_MAX_CALLS (default 1,500) caps a run; a backfill that reaches it
 * keeps what it wrote, fails, and the next run continues from the stored cursor.
 * Every flag and rule lives in src/lib/renaiss/warm.ts.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { runRenaissWarmer } from "../src/lib/renaiss/warm";

runRenaissWarmer("pulls", process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
