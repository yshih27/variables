/**
 * Renaiss pack-pulls warmer — pages Renaiss's pack pulls (its own index API)
 * into `gacha_pulls` (platform_id renaiss), and writes a `cards` row the first
 * time a named prize is seen.
 *
 *   npx tsx scripts/warm-renaiss-pulls.ts                     # DRY RUN, incremental (the default)
 *   npx tsx scripts/warm-renaiss-pulls.ts --apply             # incremental: re-reads the trailing 14 days
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
