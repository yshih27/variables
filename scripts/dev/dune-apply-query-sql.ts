/**
 * Apply a repo SQL file to its Dune query — the "edit Dune via the API" step
 * dune/README.md describes, made repeatable.
 *
 *   npx tsx --env-file=.env.local scripts/dev/dune-apply-query-sql.ts 8252735 dune/buyback-all-platforms.sql
 *
 * PATCHes /api/v1/query/<id> with the file's text (no execution — the next
 * warmer run executes it). Prints Dune's response so a rejected edit is visible.
 * ⚠️ Order matters when a query's SHAPE changes: merge the loader that accepts
 * the new shape first, then apply. Nothing here runs unless you run it.
 */
import { readFileSync } from "node:fs";

const [id, file] = process.argv.slice(2);
if (!id || !file) {
  console.error("usage: dune-apply-query-sql.ts <queryId> <path/to/query.sql>");
  process.exit(2);
}
const key = process.env.DUNE_API_KEY;
if (!key) {
  console.error("DUNE_API_KEY is not set");
  process.exit(2);
}
const sql = readFileSync(file, "utf8");
const res = await fetch(`https://api.dune.com/api/v1/query/${id}`, {
  method: "PATCH",
  headers: { "X-Dune-API-Key": key, "content-type": "application/json" },
  body: JSON.stringify({ query_sql: sql }),
});
const text = await res.text();
console.log(`${res.status} ${res.statusText}`);
console.log(text.slice(0, 600));
process.exit(res.ok ? 0 : 1);
