/**
 * Taxonomy → spine migration (D10-3). Run this WHENEVER a reclassification moves
 * cards between IP keys (i.e. every time you run backfill-ip-keys.ts and it changes
 * rows). Without it, the metric spine mis-reads the taxonomy shift as a real market
 * move — e.g. after moonbirds/yugioh/comics/magic were promoted out of "other", the
 * "other" mcap series stepped down and charted as a −92.6% collapse (and the
 * receiving IPs "pump" from nothing).
 *
 *   npx tsx scripts/migrate-taxonomy-spine.ts --keys other --before 2026-07-02
 *   npx tsx scripts/migrate-taxonomy-spine.ts --keys other --before 2026-07-02 --apply
 *
 * WHY ONLY STOCK METRICS:
 *   • FLOW metrics (volume_usd, trades, active_wallets, cards_traded) SELF-HEAL —
 *     warm-metric-snapshots recomputes the trailing 30d from row-level sales tagged
 *     with the CURRENT cards.ip_key every run, so within 30d they already reflect
 *     the new taxonomy. Nothing to migrate.
 *   • STOCK metrics (mcap_usd, holders, floor_usd) are point-in-time and forward-
 *     only — a promoted IP's pre-migration mcap was recorded inside "other" and can
 *     NEVER be decomposed after the fact. So the only honest fix is to RESET the
 *     affected keys' stock series at the migration date: delete pre-migration stock
 *     points so no delta spans the taxonomy change. Deltas then return null until
 *     post-migration history accrues (the codebase's existing "don't fabricate a
 *     change from thin history" rule) instead of a fake ±90%.
 *
 * Pass the SHRINKING bucket(s) — normally just "other". Promoted keys have no
 * pre-migration stock rows, so listing them is harmless but usually unnecessary.
 * Dry-run by default; --apply performs the delete.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../src/lib/db/client";

const STOCK_METRICS = ["mcap_usd", "holders", "floor_usd"];

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const keysArg = arg("--keys");
  const before = arg("--before");
  const metrics = (arg("--metrics") ?? STOCK_METRICS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);

  if (!keysArg || !before) {
    console.error(
      "usage: migrate-taxonomy-spine.ts --keys <ip1,ip2,...> --before <ISO-date> [--metrics mcap_usd,holders,floor_usd] [--apply]",
    );
    process.exit(2);
  }
  const keys = keysArg.split(",").map((s) => s.trim()).filter(Boolean);
  const beforeMs = Date.parse(before);
  if (!Number.isFinite(beforeMs)) {
    console.error(`--before "${before}" is not a valid date`);
    process.exit(2);
  }
  const beforeIso = new Date(beforeMs).toISOString();

  console.log(apply ? "APPLYING taxonomy spine reset" : "DRY RUN (pass --apply to delete)");
  console.log(`  entity_type=ip · keys=[${keys.join(", ")}] · metrics=[${metrics.join(", ")}] · ts < ${beforeIso}\n`);

  let totalWould = 0;
  for (const key of keys) {
    for (const metric of metrics) {
      // Count what matches first (so the dry run is honest about the blast radius).
      const { count, error: cErr } = await db()
        .from("metric_snapshots")
        .select("ts", { count: "exact", head: true })
        .eq("entity_type", "ip")
        .eq("entity_key", key)
        .eq("metric", metric)
        .lt("ts", beforeIso);
      if (cErr) throw new Error(`count ${key}/${metric} failed: ${cErr.message}`);
      const n = count ?? 0;
      totalWould += n;
      if (n === 0) continue;
      console.log(`  ${key}/${metric}: ${n} pre-migration rows`);
      if (apply) {
        const { error: dErr } = await db()
          .from("metric_snapshots")
          .delete()
          .eq("entity_type", "ip")
          .eq("entity_key", key)
          .eq("metric", metric)
          .lt("ts", beforeIso);
        if (dErr) throw new Error(`delete ${key}/${metric} failed: ${dErr.message}`);
        console.log(`    ✓ deleted`);
      }
    }
  }
  console.log(`\n${apply ? "deleted" : "would delete"} ${totalWould} stock rows across ${keys.length} key(s).`);
  console.log(
    "Reminder: flow metrics (volume_usd/trades/…) self-heal over 30d — not touched. " +
      "Re-run warm-homepage after this so the leaderboard deltas refresh.",
  );
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
