/**
 * One-time migration: copy the existing disk snapshot blobs (.cache/*.json)
 * into the Postgres `snapshots` table, preserving each one's generatedAt. This
 * populates the site with the last-known local data immediately (no re-fetch);
 * the warmers then refresh on schedule. The honest "as of" badge will show each
 * blob's real age.
 *
 *   npx tsx scripts/load-snapshots.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { promises as fs } from "node:fs";
import path from "node:path";
import { writeSnapshot } from "../src/lib/db/snapshots";

const ROOT = path.join(process.cwd(), ".cache");

const BLOBS: Array<{ file: string; key: string }> = [
  { file: "marketcap.json", key: "marketcap" },
  { file: "marketcap-history.json", key: "marketcap-history" },
  { file: "listings.json", key: "listings" },
  { file: "holders.json", key: "holders" },
  { file: "cc-sales-24h.json", key: "cc-sales" },
  { file: "courtyard-primary.json", key: "courtyard-primary" },
  { file: "primary-revenue.json", key: "primary-revenue" },
];

async function loadBlob(relFile: string, key: string): Promise<void> {
  try {
    const raw = await fs.readFile(path.join(ROOT, relFile), "utf8");
    const payload = JSON.parse(raw) as { generatedAt?: string };
    await writeSnapshot(key, payload, payload?.generatedAt);
    console.log(
      `✓ ${key.padEnd(20)} ← ${relFile} (${(raw.length / 1024).toFixed(0)} KB, as of ${payload?.generatedAt ?? "—"})`,
    );
  } catch (e) {
    console.log(`· skip ${key} (${relFile}): ${(e as Error).message}`);
  }
}

(async () => {
  for (const { file, key } of BLOBS) await loadBlob(file, key);
  // Per-platform history blobs.
  try {
    const dir = path.join(ROOT, "history");
    for (const f of (await fs.readdir(dir)).filter((x) => x.endsWith(".json"))) {
      await loadBlob(path.join("history", f), `history:${f.slice(0, -5)}`);
    }
  } catch {
    /* no history dir */
  }
  console.log("Done migrating snapshots.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
