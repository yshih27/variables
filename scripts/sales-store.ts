/**
 * The `secondary_sales` store's one-off seed: every row the current
 * `secondary-sales` snapshot holds, upserted on its natural key.
 *
 *   npx tsx scripts/sales-store.ts --seed-from-snapshot                    # DRY RUN: what it would write
 *   npx tsx scripts/sales-store.ts --seed-from-snapshot --apply            # writes
 *   npx tsx scripts/sales-store.ts --seed-from-snapshot --platform=collector-crypt --apply
 *
 * ⚠️ RUN IT THE DAY migration 20261001000001 IS APPLIED. The snapshot is a
 * 30-day window every core run overwrites; each day before the seed loses that
 * window's oldest day of Collector Crypt, recoverable afterwards only through a
 * paid Dune backfill. Courtyard and Beezie history is free to backfill later.
 *
 * Snapshot rows carry no transaction or activity id, so they key on the natural
 * key (salesStore.ts). For Collector Crypt that is the very key the core run
 * writes until query 7675297 selects tx_id, so the two never duplicate. For
 * Courtyard and Beezie the core run writes the same 30 days under their feed
 * ids within one cycle, so their seeded rows are duplicates the read-time
 * hygiene collapses: `--platform=collector-crypt` seeds only what would be lost.
 *
 * Reads the snapshot through readSnapshot, so SNAPSHOT_LOCAL_DIR is honoured.
 * Writes nothing without --apply. Touches no API and no Dune query.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readSecondarySalesSnapshot } from "../src/lib/data/secondarySalesCache";
import {
  planStoreWrite,
  storedFromSnapshot,
  upsertSecondarySales,
  STORE_PLATFORMS,
  type StorePlatform,
  type StoredSecondarySale,
} from "../src/lib/data/salesStore";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply") && !argv.includes("--dry-run");
const SEED = argv.includes("--seed-from-snapshot");
const ONLY = argv.find((a) => a.startsWith("--platform="))?.split("=")[1] ?? null;

const DAY_MS = 86_400_000;
const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2);

async function main(): Promise<number> {
  if (!SEED) {
    console.error("✗ pass --seed-from-snapshot (the only mode)");
    return 1;
  }
  if (ONLY && !STORE_PLATFORMS.includes(ONLY as StorePlatform)) {
    console.error(`✗ --platform must be one of ${STORE_PLATFORMS.join(", ")}`);
    return 1;
  }
  const snap = await readSecondarySalesSnapshot();
  if (!snap) {
    console.error("✗ the secondary-sales snapshot is not readable");
    return 1;
  }
  console.log(
    `secondary_sales seed from the secondary-sales snapshot (generated ${snap.generatedAt}, ${snap.windowDays}-day window)` +
      `${ONLY ? ` · ${ONLY} only` : ""}${APPLY ? "" : " · DRY RUN (no writes)"}`,
  );

  const rows: StoredSecondarySale[] = [];
  for (const [platform, sales] of Object.entries(snap.platforms)) {
    if (!STORE_PLATFORMS.includes(platform as StorePlatform)) {
      console.log(`  ${platform}: ${sales.length} rows, not a store venue, skipped`);
      continue;
    }
    if (ONLY && platform !== ONLY) continue;
    for (const s of sales) rows.push(storedFromSnapshot(platform as StorePlatform, s));
  }
  // The seed writes everything it holds: no newest-row cut.
  const plan = planStoreWrite(rows, new Map());

  console.log(`\n  ${"venue".padEnd(16)} ${"rows".padStart(7)} ${"keys".padStart(7)}  oldest → newest                                  ${"rows/day".padStart(8)}  bytes/row  MB/day`);
  for (const p of STORE_PLATFORMS) {
    const mine = rows.filter((r) => r.platform === p);
    if (!mine.length) continue;
    const planned = plan.filter((r) => r.platform === p);
    const times = planned.map((r) => Date.parse(r.sold_at)).filter(Number.isFinite);
    const lo = Math.min(...times);
    const hi = Math.max(...times);
    const spanDays = Math.max((hi - lo) / DAY_MS, 1);
    const perDay = planned.length / spanDays;
    const bytes = planned.reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r)), 0) / planned.length;
    console.log(
      `  ${p.padEnd(16)} ${String(mine.length).padStart(7)} ${String(planned.length).padStart(7)}  ` +
        `${new Date(lo).toISOString()} → ${new Date(hi).toISOString()}  ${perDay.toFixed(1).padStart(8)}  ${bytes.toFixed(0).padStart(9)}  ${mb(perDay * bytes)}`,
    );
  }
  const dupes = rows.length - plan.length;
  console.log(`\n  ${APPLY ? "Writing" : "Would write"} ${plan.length.toLocaleString()} rows (${dupes} duplicate natural keys in the snapshot collapsed)`);

  if (APPLY) {
    const n = await upsertSecondarySales(plan);
    console.log(`  ✓ upserted ${n.toLocaleString()} rows into secondary_sales`);
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
