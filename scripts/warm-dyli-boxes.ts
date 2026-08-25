/**
 * DYLI boxes warmer — the gacha surface: catalog first, realized pulls second.
 *
 *   npm run warm-dyli-boxes                       # catalog + incremental pulls
 *   npm run warm-dyli-boxes -- --catalog-only     # inventory/EV only, no history
 *   npm run warm-dyli-boxes -- --backfill         # walk each box to its end
 *   npm run warm-dyli-boxes -- --max-pages 200    # cap the history budget
 *   npm run warm-dyli-boxes -- --dry-run          # fetch + map, write NOTHING
 *
 * Writes:
 *   • gacha_products   one row per box — price, DECLARED EV, odds buckets
 *   • gacha_pulls      one row per realized pull, buyer NULL (see below)
 *
 * ⚠️ INVENTORY FIRST, CLAIMS SECOND — and that is an ordering, not a preference.
 * The catalog is 1 request and rewrites cheaply; the history is unbounded and
 * paged at 100. So the catalog is written BEFORE any history paging starts,
 * which means a run that exhausts its page budget (or dies mid-sweep) still
 * leaves the EV/inventory figures current instead of leaving nothing.
 *
 * ⚠️ NO BUYER EXISTS UPSTREAM. Verified over a full 100-pull page: /history
 * carries no wallet/buyer/owner/user/address field at all. Rows are written with
 * `buyer = null`, which makes DYLI appear in player-analytics' `excluded` list
 * with a true reason rather than as a platform with zero spenders. Do not invent
 * an identity — and note the R3 spender join (warm-metric-snapshots) skips
 * null-buyer rows, so these cannot leak into a payout classification either.
 *
 * ⚠️ THE DAILY RUN KEEPS UP; IT DOES NOT BACKFILL. The incremental cursor is the
 * NEWEST pull already stored for a box, so a run takes the fresh prefix and
 * stops. Whatever sat below the first run's oldest fetched page stays unfetched
 * — `--backfill` is the only thing that walks a box to its end, and at ~100
 * pulls/page against a newest pull id in the 445,000s that is hours of paced
 * requests, not a step you slip into a nightly job.
 *
 * That is a deliberate trade, not an oversight: DYLI's box VOLUME history is
 * already complete and comes from a different feed. `/sales` box-lane rows have
 * fed `gacha_volume_usd` since inception (514 days of it), so nothing on the
 * volume side depends on this. What `/history` adds is realized OUTCOME detail —
 * what was actually pulled, at what FMV, against the declared EV — and for that
 * a rolling recent window answers the question. Backfill deliberately, in
 * bounded chunks, if the deep history is ever wanted.
 *
 * ⚠️ ENDPOINT × CADENCE:
 *   GET /boxes                → 1 request/run, DAILY
 *   GET /boxes/{id}/history   → ≤ MAX_HISTORY_PAGES/run (default 120), DAILY,
 *                               incremental — each box stops at the newest pull
 *                               already stored, so the steady state is ~1 page
 *                               per active box (~22 requests).
 * All through the shared 2.2s pacer (30 req/min).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { fetchAllBoxes, fetchBoxHistoryPage, type DyliBox, type DyliPull } from "../src/lib/dyli/boxes";
import { dyliCallCount } from "../src/lib/dyli/client";
import { db } from "../src/lib/db/client";
import { runWarmer } from "../src/lib/db/runWarmer";

const argv = process.argv;
const dryRun = argv.includes("--dry-run");
const catalogOnly = argv.includes("--catalog-only");
const backfill = argv.includes("--backfill");

function intArg(flag: string, dflt: number): number {
  const i = argv.indexOf(flag);
  if (i < 0) return dflt;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`${flag} requires a positive integer, got: ${argv[i + 1] ?? "(nothing)"}`);
    process.exit(1);
  }
  return n;
}

/** Per-RUN history budget. A daily incremental run needs ~1 page per live box;
 *  the ceiling exists so a backfill cannot silently become a 3-hour job. */
const MAX_HISTORY_PAGES = intArg("--max-pages", backfill ? 2_000 : 120);

const productId = (boxId: number) => `dyli:${boxId}`;
const pullKey = (pullId: number) => `dyli:${pullId}`;

/** Catalog row → gacha_products. */
function toProductRow(b: DyliBox) {
  return {
    product_id: productId(b.box_id),
    platform_id: "dyli",
    category_id: b.category ?? b.type ?? null,
    name: b.name,
    claw_id: null,
    price_usd: b.price_usd,
    // `odds_stated` is the column that already holds every platform's DECLARED
    // odds, so DYLI's declared economics ride with them. Named `declared_*`
    // where the figure is the house's own claim, so nothing downstream can
    // mistake it for something we measured off realized pulls.
    odds_stated: {
      source: "dyli:/boxes",
      declared_expected_value_usd: b.expected_value_usd,
      declared_fmv_ratio: b.fmv_ratio,
      declared_avg_item_value_usd: b.avg_item_value_usd,
      declared_buyback_rate: b.buyback_rate,
      declared_min_buyback_floor: b.min_buyback_floor,
      inventory_count: b.inventory_count,
      brand: b.brand,
      type: b.type,
      odds_buckets: b.odds_buckets,
      metrics_updated_at: b.metrics_updated_at,
    },
    // A box that is off or out of stock is not buyable now, but its history
    // stays valid — `active` gates display, it never deletes the record.
    active: b.live && !b.out_of_stock,
    updated_at: new Date().toISOString(),
  };
}

/** Realized pull → gacha_pulls. */
function toPullRow(p: DyliPull) {
  return {
    pull_id: pullKey(p.pull_id),
    platform_id: "dyli",
    product_id: productId(p.box_id),
    // No buyer upstream — see the header. NULL, never a placeholder.
    buyer: null,
    price_usd: p.price_paid_usd,
    prize_instance_id: null,
    prize_canonical_id: p.collectible_id != null ? `dyli:collectible:${p.collectible_id}` : null,
    prize_value_usd: p.fmv_usd,
    tx_hash: null,
    source: "dyli:/boxes/history",
    memo_slug: null,
    pulled_at: p.pulled_at,
  };
}

/** Newest pull id we already hold for a box — the incremental stop condition. */
async function latestStoredPullId(boxId: number): Promise<number | null> {
  const { data, error } = await db()
    .from("gacha_pulls")
    .select("pull_id")
    .eq("platform_id", "dyli")
    .eq("product_id", productId(boxId))
    .order("pulled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`[dyli-boxes] cursor read failed: ${error.message}`);
  const raw = (data as { pull_id?: string } | null)?.pull_id;
  if (!raw) return null;
  const n = Number(String(raw).split(":").pop());
  return Number.isFinite(n) ? n : null;
}

async function upsertPulls(rows: ReturnType<typeof toPullRow>[]): Promise<number> {
  if (!rows.length) return 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db()
      .from("gacha_pulls")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "pull_id" });
    if (error) throw new Error(`[dyli-boxes] gacha_pulls upsert failed: ${error.message}`);
  }
  return rows.length;
}

async function run() {
  // ── 1. Catalog. Cheap, and written first so a truncated history sweep still
  //       leaves EV/inventory fresh. ──────────────────────────────────────────
  const boxes = await fetchAllBoxes();
  const withEv = boxes.filter((b) => b.expected_value_usd != null).length;
  const live = boxes.filter((b) => b.live && !b.out_of_stock).length;
  console.log(
    `DYLI boxes — catalog: ${boxes.length} box(es), ${live} live · declared EV on ${withEv}/${boxes.length}`,
  );
  for (const b of boxes.slice(0, 5)) {
    console.log(
      `    ${String(b.box_id).padEnd(6)} ${(b.name ?? "").slice(0, 28).padEnd(28)} ` +
        `$${b.price_usd ?? "—"} · EV $${b.expected_value_usd ?? "—"} · fmv ${b.fmv_ratio ?? "—"} · inv ${b.inventory_count ?? "—"}`,
    );
  }
  if (boxes.length > 5) console.log(`    … ${boxes.length - 5} more`);

  if (!dryRun && boxes.length) {
    const { error } = await db()
      .from("gacha_products")
      .upsert(boxes.map(toProductRow), { onConflict: "product_id" });
    if (error) throw new Error(`[dyli-boxes] gacha_products upsert failed: ${error.message}`);
  }

  if (catalogOnly) {
    console.log("--catalog-only — history skipped.");
    return { rowsWritten: boxes.length, boxes: boxes.length, pulls: 0, calls: dyliCallCount() };
  }

  // ── 2. Realized pulls, newest-first per box, stopping at what we hold. ─────
  let pagesUsed = 0;
  let pullsWritten = 0;
  let boxesTouched = 0;
  const truncated: number[] = [];

  for (const b of boxes) {
    if (pagesUsed >= MAX_HISTORY_PAGES) {
      truncated.push(b.box_id);
      continue;
    }
    const known = backfill ? null : await latestStoredPullId(b.box_id).catch(() => null);
    let cursor: number | undefined;
    let boxPulls = 0;
    let reachedKnown = false;

    for (;;) {
      if (pagesUsed >= MAX_HISTORY_PAGES) {
        truncated.push(b.box_id);
        break;
      }
      const page = await fetchBoxHistoryPage(b.box_id, cursor);
      pagesUsed++;
      if (!page.pulls.length) break;

      // Newest-first: everything at or below the newest id we already stored is
      // already ours. Take the fresh prefix and stop — no need to walk history
      // we have. `>` not `>=` so the boundary row isn't re-fetched forever.
      const fresh = known == null ? page.pulls : page.pulls.filter((p) => p.pull_id > known);
      if (known != null && fresh.length < page.pulls.length) reachedKnown = true;

      const rows = fresh.filter((p) => Number.isFinite(p.pull_id) && p.pulled_at).map(toPullRow);
      if (!dryRun) pullsWritten += await upsertPulls(rows);
      else pullsWritten += rows.length;
      boxPulls += rows.length;

      if (reachedKnown || !page.hasMore || page.nextCursor == null) break;
      cursor = page.nextCursor;
    }

    if (boxPulls) boxesTouched++;
    if (boxPulls) {
      console.log(
        `    box ${b.box_id} (${(b.name ?? "").slice(0, 24)}): +${boxPulls.toLocaleString()} pull(s)` +
          (known == null ? " [full walk]" : ` [incremental from ${known}]`),
      );
    }
  }

  console.log(
    `DYLI pulls — +${pullsWritten.toLocaleString()} across ${boxesTouched} box(es) · ${pagesUsed} history page(s)` +
      (dryRun ? " · DRY RUN (nothing written)" : ""),
  );
  // A silent cap is how a backfill quietly stops being a backfill.
  if (truncated.length) {
    console.warn(
      `  ⚠ history page budget (${MAX_HISTORY_PAGES}) exhausted — ${truncated.length} box(es) not fully swept ` +
        `(${truncated.slice(0, 8).join(", ")}${truncated.length > 8 ? ", …" : ""}).\n` +
        `    New pulls are NOT lost: the next run resumes each box from its newest stored pull. ` +
        `Deep history below this run's oldest page needs an explicit --backfill.`,
    );
  }
  console.log(`  DYLI API calls this run: ${dyliCallCount()}`);

  return {
    rowsWritten: boxes.length + pullsWritten,
    boxes: boxes.length,
    pulls: pullsWritten,
    calls: dyliCallCount(),
  };
}

runWarmer("dyli-boxes", run);
