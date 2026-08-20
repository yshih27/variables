/**
 * DYLI listings warmer — a daily snapshot of the active book, from which DYLI
 * gets its floor and its first market cap.
 *
 *   npm run warm-dyli-listings
 *   npm run warm-dyli-listings -- --dry-run   # fetch + aggregate, write NOTHING
 *
 * Writes:
 *   • snapshot `dyli-listings`      floor + listed value + provenance
 *   • entity_metrics platform/dyli  floor_usd (period "all")
 *
 * The market cap itself is assembled by warm-marketcap, which reads the snapshot
 * — same split as Phygitals, whose floor comes from warm-phygitals and whose
 * mcap is computed in warm-marketcap. Keeping the arithmetic in one place is
 * what stops two warmers publishing two different market caps.
 *
 * ⚠️ ENDPOINT × CADENCE: GET /listings, ~2 requests/run (the book was 298 rows at
 * pageSize 200), DAILY. Everything goes through the shared 2.2s pacer, so a run
 * is ~5s of wall clock and ~2 of the 30 req/min budget.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { fetchAllListings, aggregateListings } from "../src/lib/dyli/listings";
import { dyliCallCount } from "../src/lib/dyli/client";
import { writeSnapshot } from "../src/lib/db/snapshots";
import { db } from "../src/lib/db/client";
import { runWarmer } from "../src/lib/db/runWarmer";

export const DYLI_LISTINGS_SNAPSHOT_KEY = "dyli-listings";

/** What warm-marketcap reads. */
export type DyliListingsSnapshot = {
  generatedAt: string;
  floorUsd: number | null;
  listedValueUsd: number;
  listedUnits: number;
  products: number;
  /** Rows the aggregate refused, by reason. */
  skipped: Record<string, number>;
  currencies: Record<string, number>;
  /** Echoed from the feed — see the assertion below. */
  excludedMarketplaces: string[];
};

const dryRun = process.argv.includes("--dry-run");

async function run() {
  const sweep = await fetchAllListings();
  const agg = aggregateListings(sweep.rows);

  // ⚠️ HONESTY GATE. /overview documents eBay as excluded from THIS route, and
  // the response echoes the filter it applied. If that echo ever comes back
  // empty, eBay's externally-custodied stock is in the book and would inflate
  // DYLI's market cap with inventory DYLI does not hold. Fail loudly rather than
  // publish it — the same call src/lib/dyli/lanes.ts makes for the sales feed.
  const excludesEbay = sweep.excludedMarketplaces.some((m) => /ebay/i.test(m));
  if (!excludesEbay) {
    throw new Error(
      `[dyli-listings] feed no longer excludes eBay (filters.excluded_marketplaces = ` +
        `${JSON.stringify(sweep.excludedMarketplaces)}). External stock would inflate the ` +
        `market cap — classify it before publishing.`,
    );
  }

  // A book with no priced, in-stock row has no floor. Publishing 0 would read as
  // "cards are worthless" rather than "we could not price them".
  if (agg.floorUsd == null || !(agg.listedValueUsd > 0)) {
    throw new Error(
      `[dyli-listings] nothing priceable in ${sweep.rows.length} listing(s) ` +
        `(skipped: ${JSON.stringify(agg.skipped)}) — refusing to write a zero floor.`,
    );
  }

  const snapshot: DyliListingsSnapshot = {
    generatedAt: new Date().toISOString(),
    floorUsd: agg.floorUsd,
    listedValueUsd: agg.listedValueUsd,
    listedUnits: agg.listedUnits,
    products: agg.products,
    skipped: agg.skipped,
    currencies: agg.currencies,
    excludedMarketplaces: sweep.excludedMarketplaces,
  };

  const skippedTotal = Object.values(agg.skipped).reduce((s, n) => s + n, 0);
  console.log(
    `DYLI listings — ${sweep.rows.length}/${sweep.total} rows over ${sweep.pages} page(s)\n` +
      `  floor        $${agg.floorUsd.toFixed(2)}\n` +
      `  listed value $${Math.round(agg.listedValueUsd).toLocaleString()} over ${agg.listedUnits.toLocaleString()} unit(s) / ${agg.products.toLocaleString()} product(s)\n` +
      `  currencies   ${JSON.stringify(agg.currencies)}\n` +
      (skippedTotal ? `  skipped      ${skippedTotal} row(s): ${JSON.stringify(agg.skipped)}\n` : "") +
      `  excluded mkts ${JSON.stringify(sweep.excludedMarketplaces)}`,
  );

  if (dryRun) {
    console.log("\nDRY RUN — nothing written.");
    return { rowsWritten: 0, listings: sweep.rows.length, calls: dyliCallCount() };
  }

  await writeSnapshot(DYLI_LISTINGS_SNAPSHOT_KEY, snapshot, snapshot.generatedAt);

  // Mirror the floor into entity_metrics, where warm-marketcap already looks for
  // Phygitals'. One shape for "a platform's floor", whoever wrote it.
  const { error } = await db()
    .from("entity_metrics")
    .upsert(
      {
        entity_type: "platform",
        entity_id: "dyli",
        period: "all",
        floor_usd: agg.floorUsd,
        generated_at: snapshot.generatedAt,
        source: "dyli-listings",
      },
      { onConflict: "entity_type,entity_id,period" },
    );
  if (error) throw new Error(`[dyli-listings] entity_metrics upsert failed: ${error.message}`);

  return { rowsWritten: 1, listings: sweep.rows.length, calls: dyliCallCount() };
}

runWarmer("dyli-listings", run);
