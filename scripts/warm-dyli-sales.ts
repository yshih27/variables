/**
 * DYLI sales warmer — pages the native /sales feed into the `dyli_sales` row
 * store, classifying every row into a volume lane on the way in.
 *
 *   npm run warm-dyli-sales                      # incremental from the stored cursor
 *   npm run warm-dyli-sales -- --backfill        # full history from inception (~75 min)
 *   npm run warm-dyli-sales -- --limit 3         # cap pages — the dry-run shape
 *   npm run warm-dyli-sales -- --limit 3 --dry-run   # fetch + classify, write NOTHING
 *
 * Pattern follows the Beezie native feed: the platform's own API is the source
 * of truth, no Dune, no aggregator. Everything goes through the shared 2.2s
 * pacer in src/lib/dyli/client.ts (30 req/min ceiling).
 *
 * ⚠️ REQUIRES the `dyli_sales` table — supabase/migrations/20260817000001.
 * Apply it before the first non-dry run.
 *
 * Pagination is pinned with `created_before` = the run's start time. The feed is
 * newest-first, so without that pin a sale landing mid-run shifts every later
 * page down by one and a row is silently skipped. This is not theoretical: a
 * 4-page dry run watched `pagination.total` move 398,044 → 398,045 while it was
 * reading. Pinning freezes the window; `sale_id` upserts make overlap harmless,
 * and anything that lands after the pin is picked up by the next incremental run.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import {
  fetchSalesPage,
  toStoredSale,
  upsertDyliSales,
  latestStoredSoldAt,
  DYLI_PAGE_SIZE,
  type DyliStoredSale,
} from "../src/lib/dyli/sales";
import { classifyDyliLane } from "../src/lib/dyli/lanes";
import { dyliCallCount } from "../src/lib/dyli/client";
import { runWarmer } from "../src/lib/db/runWarmer";

const argv = process.argv;
const backfill = argv.includes("--backfill");
const dryRun = argv.includes("--dry-run");

const limitIdx = argv.indexOf("--limit");
let pageLimit = Infinity;
if (limitIdx >= 0) {
  const raw = argv[limitIdx + 1];
  const parsed = Number(raw);
  if (raw === undefined || !Number.isInteger(parsed) || parsed <= 0) {
    console.error(`--limit requires a positive integer (pages), got: ${raw ?? "(nothing)"}`);
    process.exit(1);
  }
  pageLimit = parsed;
}

async function run() {
  const startedAt = new Date().toISOString();
  const cursor = backfill ? null : await latestStoredSoldAt().catch(() => null);
  console.log(
    `DYLI sales — ${backfill ? "FULL BACKFILL" : cursor ? `incremental since ${cursor}` : "first run (no cursor → full)"}` +
      `${Number.isFinite(pageLimit) ? ` · capped at ${pageLimit} page(s)` : ""}${dryRun ? " · DRY RUN (no writes)" : ""}`,
  );

  const laneCounts: Record<string, { n: number; usd: number }> = {};
  const unknownChannels = new Map<string, number>();
  let fetched = 0;
  let written = 0;
  let total = 0;

  for (let page = 1; page <= pageLimit; page++) {
    const res = await fetchSalesPage({
      page,
      createdAfter: cursor ?? undefined,
      createdBefore: startedAt,
      pageSize: DYLI_PAGE_SIZE,
    });
    total = res.total;
    if (!res.rows.length) break;
    fetched += res.rows.length;

    const stored: DyliStoredSale[] = [];
    for (const r of res.rows) {
      const verdict = classifyDyliLane(r);
      const bucket = (laneCounts[verdict.lane] ??= { n: 0, usd: 0 });
      bucket.n += 1;
      bucket.usd += Number(r.price_usd) || 0;
      if (verdict.unknown) {
        const key = `${r.sale_channel ?? "(null)"} / ${r.source_marketplace ?? "(null)"}`;
        unknownChannels.set(key, (unknownChannels.get(key) ?? 0) + 1);
        console.warn(`  ⚠ UNCLASSIFIED sale ${r.sale_id}: ${verdict.reason}`);
      }
      stored.push(toStoredSale(r));
    }

    if (!dryRun) written += await upsertDyliSales(stored);

    const pct = total ? ((fetched / total) * 100).toFixed(1) : "?";
    console.log(
      `  page ${String(page).padStart(4)} · ${res.rows.length} rows · ${fetched}/${total} (${pct}%)` +
        ` · ${res.rows[0]?.sold_at?.slice(0, 10)} → ${res.rows[res.rows.length - 1]?.sold_at?.slice(0, 10)}`,
    );
    if (!res.hasMore) break;
  }

  console.log(`\nLane split (this run):`);
  for (const [lane, v] of Object.entries(laneCounts).sort((a, b) => b[1].usd - a[1].usd)) {
    console.log(`  ${lane.padEnd(12)} ${String(v.n).padStart(7)} rows  $${Math.round(v.usd).toLocaleString().padStart(12)}`);
  }
  console.log(
    `\n${dryRun ? "Would write" : "Wrote"} ${(dryRun ? fetched : written).toLocaleString()} rows` +
      ` · ${dyliCallCount()} API calls · started ${startedAt}`,
  );

  // A channel we have no rule for means the lane mapping is incomplete and a
  // published total may now be wrong. Rows are already stored (with lane
  // "excluded"), so nothing is lost — but the run FAILS so runWarmer records an
  // error and the health gate reddens until someone classifies it deliberately.
  if (unknownChannels.size) {
    const list = [...unknownChannels.entries()].map(([k, n]) => `${k} ×${n}`).join(", ");
    throw new Error(
      `dyli-sales: ${unknownChannels.size} UNRECOGNISED sale_channel value(s) — ${list}. ` +
        `Rows were stored as "excluded" (not published). Classify them in src/lib/dyli/lanes.ts.`,
    );
  }

  return { rowsWritten: written };
}

// Dry runs must not touch source_freshness — they'd advertise a warm that never
// wrote anything.
const main = dryRun ? run : () => runWarmer("dyli-sales", run);

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
