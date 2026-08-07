/**
 * Gacha data warmer — CLI entry point.
 *
 *   npm run warm-gacha-dune                  # fresh Dune executions (costs credits)
 *   npm run warm-gacha-dune -- --cached      # read Dune's last cached results
 *   npm run warm-gacha-dune -- --big-hits    # ALSO refresh the Notable Pulls feed
 *
 * Writes the snapshot to Postgres (snapshots table, key='gacha') + records
 * source_freshness. The actual logic lives in src/lib/data/warmers/gacha.ts so
 * the cron Route Handler (app/api/cron/gacha) can share it.
 *
 * Cadence: every ~6h is plenty (gacha volume moves slowly at that scale).
 * `--big-hits` runs WEEKLY only (Monday, after cc-traits and before the report
 * build) — it's the sole input to the weekly report's Notable Pulls, and Dune
 * bills per execution. Runs without the flag carry the previous hits forward.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { runGachaWarm } from "../src/lib/data/warmers/gacha";
import { runWarmer } from "../src/lib/db/runWarmer";

const cachedOnly = process.argv.includes("--cached");
const bigHits = process.argv.includes("--big-hits");

// runWarmer records source_freshness on EVERY outcome (ok / soft-fail throw /
// mid-run throw) and re-throws, so the Actions health gate sees a dead warmer.
runWarmer("gacha-dune", () => runGachaWarm({ cachedOnly, bigHits, log: (m) => console.log(m) }))
  .then((r) => {
    console.log(
      `\nWrote gacha snapshot to Postgres — ${r.platforms}/${r.totalPlatforms} platforms, ${r.bigHits} big hits, top hit $${Math.round(r.topHitUsd).toLocaleString()}`,
    );
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
