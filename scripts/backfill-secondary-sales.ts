/**
 * Backfill the `secondary_sales` store with a venue's resale history, one
 * calendar month at a time (brief-backend-index-every-venue B2). The core run
 * keeps every sale from the day the store exists; this fills what came before.
 *
 *   npx tsx scripts/backfill-secondary-sales.ts --platform=beezie                       # DRY RUN: rows per month, writes nothing
 *   npx tsx scripts/backfill-secondary-sales.ts --platform=beezie --out=<dir>           # LOCAL: <dir>/secondary_sales.jsonl
 *   npx tsx scripts/backfill-secondary-sales.ts --platform=beezie --apply               # upserts into the store
 *   npx tsx scripts/backfill-secondary-sales.ts --platform=courtyard [--from=2026-01] [--to=2026-10] [--out=<dir> | --apply]
 *
 *   npx tsx scripts/backfill-secondary-sales.ts --platform=collector-crypt --count --from=YYYY-MM [--to=YYYY-MM]
 *   npx tsx scripts/backfill-secondary-sales.ts --platform=collector-crypt --paid --from=YYYY-MM [--to=YYYY-MM] [--out=<dir> | --apply]
 *
 * THE VENUES
 *   beezie           Beezie's own /activity, the request the panel used to make
 *                    live at every build (free). One request returns the history.
 *   courtyard        Rarible's SELL activities for the Courtyard collection, the
 *                    core run's own read with a longer window (free). Starts at
 *                    2026-01 unless --from says otherwise: its history deepens
 *                    steeply before that (measured Oct 1: 254 sales in Dec 2025,
 *                    1,611 in Nov, 4,298 in Oct, at ~1.8 KB a stored row) and no
 *                    Courtyard row resolves to an identity yet (no `cards` rows),
 *                    so older months would cost store size and buy the index
 *                    nothing. Extending --from is free to do later.
 *   collector-crypt  Dune: dune/cc-secondary-history.sql, one execution per month.
 *                    ⚠️ PAID, on a plan already past its included credits.
 *
 * ⚠️ COLLECTOR CRYPT IS MEASURED BEFORE IT IS BOUGHT. `--count` runs
 * dune/cc-secondary-history-count.sql once over the whole range: one small row
 * per month (sales, volume), and an execution that scans the same rows the
 * backfill's executions will. It prints, per month, the rows, the datapoints and
 * the export they imply, the execution's compute read off the account meter,
 * and the total in credits and dollars at the plan's overage rate. The history
 * read itself refuses to run without `--paid`, which the orchestrator passes
 * only after the owner has approved that figure. Both queries are saved to the
 * Dune workspace by the orchestrator; until their ids are set
 * (DUNE_CC_SECONDARY_HISTORY_COUNT_QUERY_ID, DUNE_CC_SECONDARY_HISTORY_QUERY_ID)
 * the script makes no Dune call at all and says what to do.
 *
 * WRITES. Nothing without `--apply` (Postgres) or `--out` (a local JSONL that
 * `SALES_STORE_LOCAL_DIR=<dir>` makes the panel read, for a shadow build that
 * touches no production table). Both are upserts on `sale_id`: a re-run, or a
 * month that overlaps what the core run already stored, writes nothing new.
 * Rows are stored BEFORE hygiene, with the feed row verbatim, as the core run
 * stores them; the panel applies hygiene at read.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { fetchBeezieSaleRows } from "../src/lib/beezie/market";
import { iterateSaleActivities } from "../src/lib/rarible/queries";
import { ccSaleOf, COURTYARD_COLLECTION } from "../src/lib/data/warmers/core";
import { runQuery, duneSpend, duneUsage, type DuneUsage } from "../src/lib/dune/client";
import { CC_SECONDARY_HISTORY_QUERY_ID, CC_SECONDARY_HISTORY_COUNT_QUERY_ID } from "../src/lib/dune/queryIds";
import {
  planStoreWrite,
  storedFromBeezie,
  storedFromCC,
  storedFromCourtyard,
  upsertSecondarySales,
  writeLocalStore,
  STORE_PLATFORMS,
  type StorePlatform,
  type StoredSecondarySale,
} from "../src/lib/data/salesStore";
import {
  duneDatetime,
  estimateHistoryCost,
  lastCompleteMonth,
  monthWindows,
  parseCountRows,
  splitByMonth,
  CC_HISTORY_BYTES_PER_ROW,
  DUNE_CREDITS_PER_MB,
  type MonthWindow,
} from "../src/lib/data/salesBackfill";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const arg = (name: string): string | null => argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? null;
const PLATFORM = arg("platform") as StorePlatform | null;
const OUT_DIR = arg("out");
const APPLY = argv.includes("--apply") && !argv.includes("--dry-run") && !OUT_DIR;
const COUNT = argv.includes("--count");
const PAID = argv.includes("--paid");

const DAY_MS = 86_400_000;
/**
 * Where a free venue's backfill starts. Beezie's whole history (first sale
 * 2026-01-15) fits inside 2024-01; Courtyard's is bounded (see the header).
 * Collector Crypt has no default: its start is a cost decision.
 */
const DEFAULT_FROM: Record<"beezie" | "courtyard", string> = { beezie: "2024-01", courtyard: "2026-01" };
const USD_PER_CREDIT = Number(process.env.DUNE_OVERAGE_USD_PER_CREDIT ?? 0.016);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

function mode(): string {
  if (OUT_DIR) return `LOCAL → ${join(OUT_DIR, "secondary_sales.jsonl")} (production untouched)`;
  return APPLY ? "APPLY: upserting into secondary_sales" : "DRY RUN (no writes)";
}

/** Write one venue's rows the way the mode says; returns a log fragment. */
async function write(rows: StoredSecondarySale[]): Promise<string> {
  if (!rows.length) return "nothing to write";
  if (OUT_DIR) {
    const r = writeLocalStore(OUT_DIR, rows);
    return `local file now ${r.rows.toLocaleString()} rows (+${r.added.toLocaleString()})`;
  }
  if (APPLY) return `upserted ${(await upsertSecondarySales(rows)).toLocaleString()}`;
  return `would upsert ${rows.length.toLocaleString()}`;
}

function monthTable(windows: MonthWindow[], byMonth: Map<string, StoredSecondarySale[]>): void {
  console.log(`\n  ${"month".padEnd(8)} ${"rows".padStart(7)} ${"tokens".padStart(7)} ${"volume".padStart(12)}  first → last`);
  // The months before the venue's first sale, as one line.
  const first = windows.findIndex((w) => (byMonth.get(w.month) ?? []).length > 0);
  const lead = first < 0 ? windows.length : first;
  if (lead) console.log(`  ${windows[0].month} → ${windows[lead - 1].month}: no sales`);
  for (const w of windows.slice(lead)) {
    const rows = byMonth.get(w.month) ?? [];
    if (!rows.length) {
      console.log(`  ${w.month.padEnd(8)} ${"0".padStart(7)}`);
      continue;
    }
    const sorted = rows.map((r) => r.sold_at).sort();
    const vol = rows.reduce((s, r) => s + Number(r.price_usd), 0);
    console.log(
      `  ${w.month.padEnd(8)} ${rows.length.toLocaleString().padStart(7)} ${new Set(rows.map((r) => r.token_id)).size.toLocaleString().padStart(7)} ` +
        `${usd(vol).padStart(12)}  ${sorted[0].slice(0, 16)} → ${sorted[sorted.length - 1].slice(0, 16)}`,
    );
  }
}

/** Beezie and Courtyard: one free read over the whole range, split by month, written month by month. */
async function backfillFree(platform: "beezie" | "courtyard", windows: MonthWindow[]): Promise<number> {
  const sinceMs = Date.parse(windows[0].start);
  const windowMs = Date.now() - sinceMs + DAY_MS;
  const t0 = Date.now();
  const rows: StoredSecondarySale[] = [];
  if (platform === "beezie") rows.push(...(await fetchBeezieSaleRows(windowMs)).map(storedFromBeezie));
  else {
    // Newest first, 200 a page: a progress line every 5,000 rows says how far back it has reached.
    for await (const o of iterateSaleActivities(COURTYARD_COLLECTION, windowMs)) {
      rows.push(storedFromCourtyard(o));
      if (rows.length % 5000 === 0) console.log(`  … ${rows.length.toLocaleString()} rows, back to ${o.sale.date.slice(0, 10)} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
  }
  // One row per key, as the upsert needs; the same plan the core run's write uses.
  const keyed = planStoreWrite(rows, new Map());
  const { byMonth, outside } = splitByMonth(keyed, windows);
  console.log(
    `  read ${rows.length.toLocaleString()} sale rows in ${((Date.now() - t0) / 1000).toFixed(1)}s · ${keyed.length.toLocaleString()} keys` +
      `${rows.length - keyed.length ? ` (${(rows.length - keyed.length).toLocaleString()} repeated keys folded)` : ""}` +
      `${outside ? ` · ${outside.toLocaleString()} outside ${windows[0].month} → ${windows[windows.length - 1].month}, not written` : ""}`,
  );
  monthTable(windows, byMonth);
  let total = 0;
  for (const w of windows) {
    const m = byMonth.get(w.month) ?? [];
    if (!m.length) continue;
    total += m.length;
    if (APPLY || OUT_DIR) console.log(`  ${w.month}: ${await write(m)}`);
  }
  const bytes = [...byMonth.values()].flat().reduce((s, r) => s + JSON.stringify(r).length, 0);
  console.log(`\n  ${platform}: ${total.toLocaleString()} rows over ${windows.length} months · ${(bytes / 1024 / 1024).toFixed(2)} MB of row data · ${APPLY || OUT_DIR ? "written" : await write([...byMonth.values()].flat())}`);
  return 0;
}

const SAVE_INSTRUCTION = (file: string, env: string) =>
  `✗ ${file} is not saved to the Dune workspace yet (${env} unset), so no Dune call was made.\n` +
  `  The orchestrator saves it as a query with two "datetime" parameters, start and end, then reruns with ${env}=<its id>.`;

/** Wait for the account meter to move past `before` (it lags the execution). Null when it never does. */
async function usageAfter(before: DuneUsage | null): Promise<DuneUsage | null> {
  if (!before) return null;
  for (let i = 0; i < 9; i++) {
    await sleep(10_000);
    const now = await duneUsage().catch(() => null);
    if (now && now.creditsUsed > before.creditsUsed) return now;
  }
  return null;
}

/** Collector Crypt `--count`: the measured cost of the backfill, before any of it is bought. */
async function countCC(windows: MonthWindow[]): Promise<number> {
  if (CC_SECONDARY_HISTORY_COUNT_QUERY_ID == null) {
    console.error(SAVE_INSTRUCTION("dune/cc-secondary-history-count.sql", "DUNE_CC_SECONDARY_HISTORY_COUNT_QUERY_ID"));
    return 2;
  }
  const start = duneDatetime(windows[0].start);
  const end = duneDatetime(windows[windows.length - 1].end);
  const before = await duneUsage().catch(() => null);
  const t0 = Date.now();
  const rows = await runQuery(CC_SECONDARY_HISTORY_COUNT_QUERY_ID, { params: { start, end }, maxWaitMs: 900_000 });
  const ms = Date.now() - t0;
  const spend = duneSpend();
  const after = await usageAfter(before);
  // The meter's move is the count execution's compute plus its own (tiny) export.
  const ownExport = (spend.bytes / (1024 * 1024)) * DUNE_CREDITS_PER_MB;
  const executionCredits = before && after ? Math.max(0, after.creditsUsed - before.creditsUsed - ownExport) : null;
  const est = estimateHistoryCost(parseCountRows(rows), { executionCredits, usdPerCredit: USD_PER_CREDIT });

  console.log(`\n  count query ${CC_SECONDARY_HISTORY_COUNT_QUERY_ID} over [${start}, ${end}): ${(ms / 1000).toFixed(0)}s, ${spend.datapoints} datapoints, ${spend.bytes} B exported`);
  console.log(`\n  ${"month".padEnd(8)} ${"sales".padStart(8)} ${"volume".padStart(12)} ${"datapoints".padStart(11)} ${"export MB".padStart(10)} ${"export cr".padStart(10)}`);
  for (const m of est.months) {
    console.log(
      `  ${m.month.padEnd(8)} ${m.sales.toLocaleString().padStart(8)} ${usd(m.volumeUsd).padStart(12)} ${m.datapoints.toLocaleString().padStart(11)} ` +
        `${m.exportMb.toFixed(2).padStart(10)} ${m.exportCredits.toFixed(1).padStart(10)}`,
    );
  }
  console.log(
    `  ${"total".padEnd(8)} ${est.sales.toLocaleString().padStart(8)} ${"".padStart(12)} ${est.datapoints.toLocaleString().padStart(11)} ` +
      `${est.exportMb.toFixed(2).padStart(10)} ${est.exportCredits.toFixed(1).padStart(10)}`,
  );
  console.log(
    `\n  export: ${CC_HISTORY_BYTES_PER_ROW} B/row (7675297 measured + tx_id) × ${DUNE_CREDITS_PER_MB} cr/MB → ${est.exportCredits.toFixed(1)} credits` +
      `\n  compute: ${executionCredits != null ? `${executionCredits.toFixed(1)} credits, measured on the account meter for this count's execution (the same scan the ${windows.length} monthly executions split)` : "NOT MEASURED: the account meter had not moved 90 s after the execution; read the next check-freshness DUNE ACCOUNT CREDITS line"}`,
  );
  if (est.totalCredits != null && est.usd != null) {
    const billed = after ? Math.max(0, Math.min(est.totalCredits, after.creditsUsed + est.totalCredits - after.creditsIncluded)) : est.totalCredits;
    console.log(
      `  TOTAL ≈ ${est.totalCredits.toFixed(0)} credits ≈ ${usd(est.usd)} at $${USD_PER_CREDIT}/credit` +
        (after ? ` · account ${Math.round(after.creditsUsed).toLocaleString()} / ${after.creditsIncluded.toLocaleString()} included, so ${billed.toFixed(0)} of them are billed extra (${usd(billed * USD_PER_CREDIT)})` : ""),
    );
  }
  if (OUT_DIR) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, "cc-history-count.json"), JSON.stringify({ generatedAt: new Date().toISOString(), start, end, queryId: CC_SECONDARY_HISTORY_COUNT_QUERY_ID, spend, before, after, estimate: est }, null, 2));
    console.log(`  wrote ${join(OUT_DIR, "cc-history-count.json")}`);
  }
  console.log(`\n  Nothing was backfilled. The history read runs with --paid, after the owner approves this figure.`);
  return 0;
}

/** Collector Crypt history: one execution per month, each month written as it lands. PAID. */
async function backfillCC(windows: MonthWindow[]): Promise<number> {
  if (CC_SECONDARY_HISTORY_QUERY_ID == null) {
    console.error(SAVE_INSTRUCTION("dune/cc-secondary-history.sql", "DUNE_CC_SECONDARY_HISTORY_QUERY_ID"));
    return 2;
  }
  const queryId = CC_SECONDARY_HISTORY_QUERY_ID;
  let total = 0;
  for (const w of windows) {
    const s0 = duneSpend();
    const t0 = Date.now();
    const rows = await runQuery(queryId, { params: { start: duneDatetime(w.start), end: duneDatetime(w.end) }, maxWaitMs: 900_000, maxRows: 1_000_000 });
    const s1 = duneSpend();
    const stored = planStoreWrite(
      rows.flatMap((r) => {
        const sale = ccSaleOf(r);
        return sale ? [storedFromCC({ sale, raw: r }, `dune:${queryId}`)] : [];
      }),
      new Map(),
    );
    total += stored.length;
    console.log(
      `  ${w.month}: ${rows.length.toLocaleString()} rows → ${stored.length.toLocaleString()} keys · ${(s1.datapoints - s0.datapoints).toLocaleString()} datapoints · ` +
        `${((s1.bytes - s0.bytes) / 1024 / 1024).toFixed(2)} MB · ${((Date.now() - t0) / 1000).toFixed(0)}s · ${await write(stored)}`,
    );
  }
  const s = duneSpend();
  console.log(`\n  collector-crypt: ${total.toLocaleString()} rows over ${windows.length} months · ${s.datapoints.toLocaleString()} datapoints · ${(s.bytes / 1024 / 1024).toFixed(2)} MB exported in ${s.calls} result pages`);
  return 0;
}

async function main(): Promise<number> {
  if (!PLATFORM || !STORE_PLATFORMS.includes(PLATFORM)) {
    console.error(`✗ --platform must be one of ${STORE_PLATFORMS.join(", ")}`);
    return 1;
  }
  const cc = PLATFORM === "collector-crypt";
  const from = arg("from") ?? (cc ? null : DEFAULT_FROM[PLATFORM as "beezie" | "courtyard"]);
  if (!from) {
    console.error("✗ Collector Crypt needs --from=YYYY-MM: where its history starts is a cost decision, not a default");
    return 1;
  }
  // Free venues read through the running month, so a store built from them alone
  // is current; Collector Crypt stops at the last complete month, since the core
  // run's 30-day window already keeps the rest.
  const to = arg("to") ?? (cc ? lastCompleteMonth(Date.now()) : new Date().toISOString().slice(0, 7));
  const windows = monthWindows(from, to);
  if (!windows.length) {
    console.error(`✗ --to (${to}) precedes --from (${from})`);
    return 1;
  }
  if (COUNT && !cc) {
    console.error("✗ --count is Collector Crypt's: the other venues' history is free to read");
    return 1;
  }
  console.log(`secondary_sales backfill · ${PLATFORM} · ${windows[0].month} → ${windows[windows.length - 1].month} (${windows.length} months) · ${COUNT ? "COUNT ONLY (no rows read, nothing written)" : mode()}`);

  if (!cc) return backfillFree(PLATFORM, windows);
  if (COUNT) return countCC(windows);
  if (!PAID) {
    console.error(
      "✗ the Collector Crypt history read is PAID and runs only with --paid, after the owner approves the cost --count measures.\n" +
        "  Run --count first; it reads one small row per month and writes nothing.",
    );
    return 1;
  }
  return backfillCC(windows);
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
