/**
 * Build per-IP market-cap snapshot from the Postgres `cards` table.
 *
 *   • Collector Crypt: priced by the "Insured Value" trait (cards.insured_value_usd)
 *   • Beezie:          priced by the cheapest active listing (listings snapshot)
 *   • Floor per IP:    min per-token value across the IP
 *   • mcap per IP:     sum of per-token values
 *
 *   npx tsx scripts/warm-marketcap.ts
 *
 * Reads the `cards` table (ip_key + insured_value_usd are precomputed) — NOT the
 * local `.cache/cc-traits` dirs, which don't exist on a fresh CI runner. That was
 * a real bug: on CI the disk scan found 0 cards and wrote an EMPTY market cap.
 * Writes the `marketcap` + `marketcap-history` snapshots, and REFUSES to overwrite
 * with an empty result. Run every 6h (core batch, after warm-listings).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readListings } from "../src/lib/data/listings";
import {
  appendMarketCapHistory,
  writeMarketCap,
  type MarketCapIPEntry,
} from "../src/lib/data/marketcap";
import { readCardValuations } from "../src/lib/data/cards";
import { PLATFORM_SOURCES } from "../src/lib/data/sources";
import { runWarmer } from "../src/lib/db/runWarmer";

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

function accFor(byIp: Map<string, Acc>, key: string): Acc {
  let acc = byIp.get(key);
  if (!acc) {
    acc = newAcc();
    byIp.set(key, acc);
  }
  return acc;
}

// Defensive upper bound. Anything above this is almost certainly a spam listing
// (we've seen $2 × 10^15 / quadrillion-dollar "joke" prices).
const MAX_PER_TOKEN_USD = 5_000_000;

function recordValuation(acc: Acc, usd: number) {
  if (!Number.isFinite(usd) || usd <= 0 || usd > MAX_PER_TOKEN_USD) return;
  acc.cardsValued += 1;
  acc.mcap += usd;
  if (usd < acc.floor) acc.floor = usd;
}

async function processCC(byIp: Map<string, Acc>) {
  const cards = await readCardValuations("collector-crypt");
  let valued = 0;
  for (const c of cards) {
    const acc = accFor(byIp, c.ipKey);
    acc.cards += 1;
    const insured = c.insuredValueUsd ?? 0;
    if (insured > 0) {
      recordValuation(acc, insured);
      acc.insured += insured;
      valued += 1;
    }
  }
  console.log(`→ Collector Crypt: ${cards.length} cards · ${valued} with insured value`);
}

async function processBeezie(byIp: Map<string, Acc>) {
  const beezie = PLATFORM_SOURCES.find((p) => p.key === "beezie");
  if (!beezie || beezie.kind !== "rarible") return;
  const listings = await readListings();
  const byItem = listings?.byItem ?? {};
  const cards = await readCardValuations("beezie");
  let priced = 0;
  for (const c of cards) {
    const acc = accFor(byIp, c.ipKey);
    acc.cards += 1;
    const listing = byItem[`${beezie.collectionId}:${c.tokenId}`];
    if (listing) {
      recordValuation(acc, listing.priceUsd);
      priced += 1;
    }
  }
  console.log(`→ Beezie: ${cards.length} cards · ${priced} matched a listing`);
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
    snap.byIp[key] = {
      cards: acc.cards,
      cardsValued: acc.cardsValued,
      floorUsd: Number.isFinite(acc.floor) ? acc.floor : 0,
      mcapUsd: acc.mcap,
      insuredUsd: acc.insured,
    };
    snap.totals.mcapUsd += acc.mcap;
    snap.totals.insuredUsd += acc.insured;
  }

  // Guard: never overwrite a good snapshot with an empty one. If the cards table
  // is empty/unreachable we'd compute $0 mcap — fail loudly (runWarmer records the
  // error) and leave the prior snapshot intact instead of blanking the homepage.
  const ipCount = Object.keys(snap.byIp).length;
  if (ipCount === 0 || snap.totals.mcapUsd <= 0) {
    throw new Error(
      `marketcap: computed ${ipCount} IPs / $${snap.totals.mcapUsd.toFixed(0)} mcap — refusing to overwrite the snapshot (cards table empty or unreachable?)`,
    );
  }

  await writeMarketCap(snap);
  await appendMarketCapHistory(snap);

  console.log(
    `\nWrote marketcap snapshot in ${((Date.now() - t0) / 1000).toFixed(0)}s · ${ipCount} IPs · $${snap.totals.mcapUsd.toFixed(0)} mcap · $${snap.totals.insuredUsd.toFixed(0)} insured`,
  );
  console.log("\nTop IPs by mcap:");
  const sorted = Object.entries(snap.byIp).sort((a, b) => b[1].mcapUsd - a[1].mcapUsd);
  for (const [k, v] of sorted.slice(0, 8)) {
    console.log(
      `  ${k.padEnd(14)} cards=${v.cards.toString().padStart(6)} valued=${v.cardsValued.toString().padStart(6)} floor=$${v.floorUsd.toFixed(0).padStart(8)} mcap=$${v.mcapUsd.toFixed(0).padStart(11)}`,
    );
  }
  return { rowsWritten: ipCount };
}

runWarmer("marketcap", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
