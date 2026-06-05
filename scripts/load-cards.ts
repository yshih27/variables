/**
 * One-time bulk loader: read the existing disk trait caches into the Postgres
 * `cards` table. Reads .cache/beezie-traits/* + .cache/cc-traits/* (no API
 * calls), computes derived columns, and upserts in batches.
 *
 *   npx tsx scripts/load-cards.ts
 *
 * Idempotent (upsert on id) — safe to re-run.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { promises as fs } from "node:fs";
import path from "node:path";
import type { TokenMetadata } from "../src/lib/onchain/tokenUri";
import {
  cardRowFromMeta,
  upsertCards,
  type CardPlatform,
  type CardRow,
} from "../src/lib/data/cards";
import { fixBeezieImage } from "../src/lib/data/beezieTraits";

const ROOT = path.join(process.cwd(), ".cache");
const READ_CONCURRENCY = 64;
const CHUNK = 500;

async function loadDir(dir: string, platform: CardPlatform): Promise<void> {
  const full = path.join(ROOT, dir);
  let files: string[];
  try {
    files = (await fs.readdir(full)).filter((f) => f.endsWith(".json"));
  } catch {
    console.log(`(${dir} not found — skipping)`);
    return;
  }
  console.log(`${platform}: ${files.length.toLocaleString()} files`);
  const t0 = Date.now();
  let loaded = 0;
  let skipped = 0;

  for (let i = 0; i < files.length; i += CHUNK) {
    const slice = files.slice(i, i + CHUNK);
    const rows: CardRow[] = [];
    let idx = 0;
    async function reader() {
      while (idx < slice.length) {
        const f = slice[idx++];
        const tokenId = f.slice(0, -5); // strip ".json"
        try {
          let meta = JSON.parse(
            await fs.readFile(path.join(full, f), "utf8"),
          ) as TokenMetadata;
          if (platform === "beezie") meta = fixBeezieImage(meta);
          rows.push(cardRowFromMeta(platform, tokenId, meta));
        } catch {
          skipped++;
        }
      }
    }
    await Promise.all(Array.from({ length: READ_CONCURRENCY }, reader));
    if (rows.length) await upsertCards(rows);
    loaded += rows.length;
    const done = Math.min(i + CHUNK, files.length);
    if (done % (CHUNK * 10) === 0 || done >= files.length) {
      const el = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(
        `  ${loaded.toLocaleString()}/${files.length.toLocaleString()} (${el}s, ${skipped} skipped)`,
      );
    }
  }
  console.log(
    `${platform}: ${loaded.toLocaleString()} loaded, ${skipped} skipped in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`,
  );
}

(async () => {
  await loadDir("beezie-traits", "beezie");
  await loadDir("cc-traits", "collector-crypt");
  console.log("Done loading cards.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
