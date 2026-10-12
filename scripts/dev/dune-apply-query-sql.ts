/**
 * Apply a repo SQL file to its Dune query — the "edit Dune via the API" step
 * dune/README.md describes, made repeatable.
 *
 *   npx tsx --env-file=.env.local scripts/dev/dune-apply-query-sql.ts 8252735 dune/buyback-all-platforms.sql
 *   npx tsx --env-file=.env.local scripts/dev/dune-apply-query-sql.ts 7845248 dune/cc-secondary-history-count.sql \
 *     --name="TCG.market - CC secondary history count" --params=start:datetime,end:datetime
 *
 * `--params` declares the query's {{parameters}} (key:type, Dune's types: text,
 * number, datetime, enum) so an execution can pass them; `--name` renames it,
 * for a reclaimed dormant slot (dune/README.md).
 * PATCHes /api/v1/query/<id> with the file's text (no execution — the next
 * warmer run executes it). Prints Dune's response so a rejected edit is visible.
 * ⚠️ Order matters when a query's SHAPE changes: merge the loader that accepts
 * the new shape first, then apply. Nothing here runs unless you run it.
 */
import { readFileSync } from "node:fs";

// tsx runs this repo's scripts as CommonJS, so no top-level await here.
async function main(): Promise<number> {
  const [id, file] = process.argv.slice(2);
  if (!id || !file) {
    console.error("usage: dune-apply-query-sql.ts <queryId> <path/to/query.sql>");
    return 2;
  }
  const key = process.env.DUNE_API_KEY;
  if (!key) {
    console.error("DUNE_API_KEY is not set");
    return 2;
  }
  const sql = readFileSync(file, "utf8");
  const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  const body: Record<string, unknown> = { query_sql: sql };
  const name = flag("name");
  if (name) body.name = name;
  const params = flag("params");
  if (params) {
    // A datetime parameter needs a default value; the executions always pass theirs.
    const DEFAULT: Record<string, string> = { datetime: "2026-01-01 00:00:00", number: "0", text: "", enum: "" };
    body.parameters = params.split(",").map((kv) => {
      const [k, type = "text"] = kv.split(":");
      return { key: k, type, value: DEFAULT[type] ?? "" };
    });
  }
  const res = await fetch(`https://api.dune.com/api/v1/query/${id}`, {
    method: "PATCH",
    headers: { "X-Dune-API-Key": key, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`${res.status} ${res.statusText}`);
  console.log(text.slice(0, 600));
  return res.ok ? 0 : 1;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
