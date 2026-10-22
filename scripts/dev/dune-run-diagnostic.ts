/**
 * Execute one saved Dune query once and print its rows, with the account's
 * credits before and after (`/usage` is free metadata). For the one-shot
 * diagnostics in dune/README.md: apply the SQL to a reclaimed slot
 * (dune-apply-query-sql.ts), run it here, then re-apply the slot's own SQL.
 *
 *   npx tsx --env-file=.env.local scripts/dev/dune-run-diagnostic.ts 7845248
 */
import { duneUsage, runQuery } from "../../src/lib/dune/client";

// tsx runs this repo's scripts as CommonJS, so no top-level await here.
async function main(): Promise<number> {
  const id = Number(process.argv[2]);
  if (!Number.isFinite(id) || id <= 0) {
    console.error("usage: dune-run-diagnostic.ts <queryId>");
    return 2;
  }
  const before = await duneUsage();
  console.log(`credits before: ${before?.creditsUsed ?? "?"} / ${before?.creditsIncluded ?? "?"}`);
  const rows = await runQuery(id, { maxWaitMs: 15 * 60_000, maxRows: 2_000 });
  for (const r of rows) console.log(JSON.stringify(r));
  const after = await duneUsage();
  const spent = after && before ? (after.creditsUsed - before.creditsUsed).toFixed(1) : "?";
  console.log(`rows: ${rows.length} · credits after: ${after?.creditsUsed ?? "?"} (this run ≈ ${spent}; the meter can lag the execution)`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
