/**
 * Build per-IP market-cap snapshot by joining listing data with trait caches.
 *
 *   • Beezie + Courtyard tokens: priced by their listing (Postgres `listings`
 *                                snapshot, via readListings)
 *   • Collector Crypt tokens:    priced by the "Insured Value" trait
 *                                (local .cache/cc-traits/*.json)
 *   • Floor per IP:              min per-token value across the IP
 *   • mcap per IP:               sum of per-token values
 *
 *   npx tsx scripts/warm-marketcap.ts
 *
 * Writes the `marketcap` + `marketcap-history` Postgres snapshots.
 * Run every 6h (core batch, after warm-listings).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { promises as fs } from "node:fs";
import path from "node:path";
import { readListings } from "../src/lib/data/listings";
import {
  appendMarketCapHistory,
  writeMarketCap,
  type MarketCapIPEntry,
} from "../src/lib/data/marketcap";
import { classifyIP } from "../src/lib/data/ipCatalog";
import { extractCategoryHints } from "../src/lib/data/beezieTraits";
import type { TokenMetadata } from "../src/lib/onchain/tokenUri";
import { PLATFORM_SOURCES } from "../src/lib/data/sources";
import { runWarmer } from "../src/lib/db/runWarmer";

const BEEZIE_CACHE = path.join(process.cwd(), ".cache", "beezie-traits");
const CC_CACHE = path.join(process.cwd(), ".cache", "cc-traits");

type Acc = {
  cards: number;
  cardsValued: number;
  floor: number;
  mcap: number;
  insured: number;
};

function newAcc(): Acc {
  return { cards: 0, cardsValued: 0, floor: Infinity, mcap: 0, insured: 0 };
}

// Defensive upper bound. Anything above this is almost certainly a spam
// listing (we've seen $2 × 10^15 / quadrillion-dollar "joke" prices).
const MAX_PER_TOKEN_USD = 5_000_000;

function recordValuation(acc: Acc, usd: number) {
  if (!Number.isFinite(usd) || usd <= 0) return;
  if (usd > MAX_PER_TOKEN_USD) return;
  acc.cardsValued += 1;
  acc.mcap += usd;
  if (usd < acc.floor) acc.floor = usd;
}

function insuredValueFromMeta(meta: TokenMetadata): number {
  const attr = meta.attributes?.find((a) => a.trait_type === "Insured Value");
  if (!attr) return 0;
  const v = parseFloat(String(attr.value));
  return Number.isFinite(v) ? v : 0;
}

async function processBeezie(byIp: Map<string, Acc>) {
  const beezie = PLATFORM_SOURCES.find((p) => p.key === "beezie");
  if (!beezie || beezie.kind !== "rarible") return;
  const listings = await readListings();
  const byItem = listings?.byItem ?? {};

  console.log("→ Beezie trait cache scan");
  const files = await fs.readdir(BEEZIE_CACHE).catch(() => []);
  let priced = 0;
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const tokenId = f.replace(/\.json$/, "");
    let meta: TokenMetadata;
    try {
      meta = JSON.parse(await fs.readFile(path.join(BEEZIE_CACHE, f), "utf8"));
    } catch {
      continue;
    }
    const ip = classifyIP(extractCategoryHints(meta));
    let acc = byIp.get(ip.key);
    if (!acc) {
      acc = newAcc();
      byIp.set(ip.key, acc);
    }
    acc.cards += 1;
    const itemId = `${beezie.collectionId}:${tokenId}`;
    const listing = byItem[itemId];
    if (listing) {
      recordValuation(acc, listing.priceUsd);
      priced += 1;
    }
  }
  console.log(`  scanned ${files.length} files · ${priced} matched a listing`);
}

async function processCC(byIp: Map<string, Acc>) {
  console.log("→ Collector Crypt trait cache scan (insured-value pricing)");
  const files = await fs.readdir(CC_CACHE).catch(() => []);
  let valued = 0;
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    let meta: TokenMetadata;
    try {
      meta = JSON.parse(await fs.readFile(path.join(CC_CACHE, f), "utf8"));
    } catch {
      continue;
    }
    const ip = classifyIP(extractCategoryHints(meta));
    let acc = byIp.get(ip.key);
    if (!acc) {
      acc = newAcc();
      byIp.set(ip.key, acc);
    }
    acc.cards += 1;
    const insured = insuredValueFromMeta(meta);
    if (insured > 0) {
      recordValuation(acc, insured);
      acc.insured += insured;
      valued += 1;
    }
  }
  console.log(`  scanned ${files.length} files · ${valued} had insured value`);
}

async function main() {
  const t0 = Date.now();
  const byIp = new Map<string, Acc>();

  await processBeezie(byIp);
  await processCC(byIp);

  const snap = {
    generatedAt: new Date().toISOString(),
    byIp: {} as Record<string, MarketCapIPEntry>,
    totals: { mcapUsd: 0, insuredUsd: 0 },
  };

  for (const [key, acc] of byIp) {
    const floorUsd = Number.isFinite(acc.floor) ? acc.floor : 0;
    snap.byIp[key] = {
      cards: acc.cards,
      cardsValued: acc.cardsValued,
      floorUsd,
      mcapUsd: acc.mcap,
      insuredUsd: acc.insured,
    };
    snap.totals.mcapUsd += acc.mcap;
    snap.totals.insuredUsd += acc.insured;
  }

  await writeMarketCap(snap);
  await appendMarketCapHistory(snap);

  console.log(`\nWrote marketcap snapshot in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`Total mcap: $${snap.totals.mcapUsd.toFixed(0)} · insured: $${snap.totals.insuredUsd.toFixed(0)}`);
  console.log("\nTop IPs by mcap:");
  const sorted = Object.entries(snap.byIp).sort((a, b) => b[1].mcapUsd - a[1].mcapUsd);
  for (const [k, v] of sorted.slice(0, 10)) {
    console.log(
      `  ${k.padEnd(14)} cards=${v.cards.toString().padStart(6)} valued=${v.cardsValued.toString().padStart(6)} floor=$${v.floorUsd.toFixed(0).padStart(8)} mcap=$${v.mcapUsd.toFixed(0).padStart(10)} insured=$${v.insuredUsd.toFixed(0).padStart(10)}`,
    );
  }
  return { rowsWritten: Object.keys(snap.byIp).length };
}

runWarmer("marketcap", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
