/**
 * Courtyard primary-market indexer.
 *
 * Counts MINT events from Rarible's activity feed for the Courtyard
 * collection (= cards newly tokenized) over the last 24h and 7d.
 *
 * IMPORTANT: Courtyard's actual USDC payment for tokenization happens
 * OFF-CHAIN (credit card / Stripe). It is NOT visible on-chain — we
 * verified this by probing USDC transfers to Courtyard's operator wallet
 * (zero inbound). So we estimate primary volume as:
 *
 *     estimatedVolumeUsd = mintCount × TOKENIZATION_FEE_USD
 *
 * Edit TOKENIZATION_FEE_USD below when we learn the actual fee from
 * Courtyard (or replace this script entirely with a partner-API call).
 *
 *   npx tsx scripts/warm-courtyard-primary.ts
 *
 * Run hourly.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { iterateActivities } from "../src/lib/rarible/queries";
import { writeCourtyardPrimary } from "../src/lib/data/courtyardPrimaryCache";
import { PLATFORM_SOURCES } from "../src/lib/data/sources";

// Default estimate. Adjust when Courtyard discloses their fee schedule.
const TOKENIZATION_FEE_USD = 2.0;
const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const ct = PLATFORM_SOURCES.find((p) => p.key === "courtyard");
  if (!ct || ct.kind !== "rarible") throw new Error("Courtyard source missing");

  const cutoff7d = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const cutoff24h = new Date(Date.now() - DAY_MS).toISOString();

  console.log(`→ Counting Courtyard MINTs over 7d…`);
  const t0 = Date.now();
  let count24h = 0;
  let count7d = 0;
  for await (const a of iterateActivities(
    { collection: ct.collectionId, types: ["MINT"], sort: "LATEST_FIRST" },
    { date: cutoff7d },
  )) {
    count7d += 1;
    if (a.date >= cutoff24h) count24h += 1;
  }
  console.log(
    `  done in ${((Date.now() - t0) / 1000).toFixed(0)}s — 24h=${count24h} 7d=${count7d}`,
  );

  const snap = {
    generatedAt: new Date().toISOString(),
    treasury: "off-chain (Stripe / credit card)",
    volume24hUsd: count24h * TOKENIZATION_FEE_USD,
    volume7dUsd: count7d * TOKENIZATION_FEE_USD,
    count24h,
  };
  await writeCourtyardPrimary(snap);
  console.log(
    `Wrote .cache/courtyard-primary.json: estimated 24h=$${snap.volume24hUsd.toFixed(0)} (count × $${TOKENIZATION_FEE_USD} fee assumption)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
