/**
 * Core secondary-volume warmer (CLI).
 *
 *   npx tsx scripts/warm-core-dune.ts            # fresh Dune execution + Rarible
 *   npx tsx scripts/warm-core-dune.ts --cached   # read Dune's cached results (0 credits)
 *
 * Writes the `core-volume` Postgres snapshot (CC via Dune, Beezie/Courtyard via
 * Rarible) and records `source_freshness`. The 6h core batch runs `--cached`
 * (instant); the daily batch runs fresh to keep Dune's cache warm.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { runCoreWarm } from "../src/lib/data/warmers/core";
import { runWarmer } from "../src/lib/db/runWarmer";

const cachedOnly = process.argv.includes("--cached");

runWarmer("core-volume", async () => {
  const r = await runCoreWarm({ cachedOnly, log: (m) => console.log(m) });
  console.log(
    `Wrote core-volume snapshot: ${r.platforms} platforms · 24h $${Math.round(
      r.vol24hUsd,
    ).toLocaleString()} · CC ${r.ccSales30d.toLocaleString()} sales/30d`,
  );
  return { rowsWritten: r.rowsWritten };
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
