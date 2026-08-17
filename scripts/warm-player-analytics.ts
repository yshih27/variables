/**
 * Player spending analytics warmer — re-aggregates our own `gacha_pulls` table
 * into the `player-analytics` snapshot.
 *
 *   npm run warm-player-analytics                  # full scan (minutes)
 *   npm run warm-player-analytics -- --pages 20    # bounded, for a dry run
 *   npm run warm-player-analytics -- --pages 20 --dry-run   # print, write NOTHING
 *
 * DAILY, never per-request: PostgREST caps every response at 1000 rows, so a full
 * pass over ~1.5M pull rows is ~1,525 sequential requests. Precomputing is the
 * whole point — no page may ever do this work itself.
 *
 * Privacy: wallet addresses are aggregation keys only. The snapshot this writes
 * contains counts, sums and shares — no addresses, not even truncated.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { aggregatePlayerAnalytics, writePlayerAnalytics } from "../src/lib/data/playerAnalytics";
import { runWarmer } from "../src/lib/db/runWarmer";

const argv = process.argv;
const dryRun = argv.includes("--dry-run");
const pagesIdx = argv.indexOf("--pages");
let maxPages = Infinity;
if (pagesIdx >= 0) {
  const raw = argv[pagesIdx + 1];
  const parsed = Number(raw);
  if (raw === undefined || !Number.isInteger(parsed) || parsed <= 0) {
    console.error(`--pages requires a positive integer, got: ${raw ?? "(nothing)"}`);
    process.exit(1);
  }
  maxPages = parsed;
}

async function run() {
  const t0 = Date.now();
  const snap = await aggregatePlayerAnalytics({ maxPages, log: (m) => console.log(m) });

  for (const p of snap.platforms) {
    const c = p.concentration;
    console.log(
      `\n${p.platform} — ${c.totalWallets.toLocaleString()} wallets · $${Math.round(c.totalSpendUsd).toLocaleString()} lifetime spend`,
    );
    console.log(
      `  coverage ${p.coverage.rows.toLocaleString()} rows · wallet-attributed ${((p.coverage.walletAttributedRows / Math.max(p.coverage.rows, 1)) * 100).toFixed(1)}%` +
        ` · ${(p.coverage.firstPullAt ?? "—").slice(0, 10)} → ${(p.coverage.lastPullAt ?? "—").slice(0, 10)}`,
    );
    console.log(
      `  avg $${Math.round(c.avgLifetimeSpendUsd).toLocaleString()} · median $${Math.round(c.medianLifetimeSpendUsd).toLocaleString()}` +
        ` · top1% ${c.top1PctShare.toFixed(1)}% · top10% ${c.top10PctShare.toFixed(1)}% · active30d ${c.activeWallets30d.toLocaleString()}`,
    );
    console.log(`  tier                users     %users     spend        %rev`);
    for (const t of p.tiers) {
      console.log(
        `    ${t.label.padEnd(12)} ${String(t.users).padStart(9)} ${t.pctUsers.toFixed(1).padStart(9)}% ` +
          `$${Math.round(t.totalSpendUsd).toLocaleString().padStart(12)} ${t.pctRevenue.toFixed(1).padStart(7)}%`,
      );
    }
    console.log(`  months: ${p.monthly.length} (${p.monthly[0]?.month ?? "—"} → ${p.monthly[p.monthly.length - 1]?.month ?? "—"})`);
  }
  for (const e of snap.excluded) console.log(`\n· excluded ${e.platform}: ${e.reason}`);

  if (dryRun) {
    console.log(`\nDRY RUN — nothing written. (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    return { rowsWritten: 0 };
  }
  await writePlayerAnalytics(snap);
  console.log(
    `\nWrote player-analytics: ${snap.platforms.length} platform(s), ${snap.rowsScanned.toLocaleString()} rows scanned (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
  );
  return { rowsWritten: snap.platforms.length };
}

// A bounded or dry run must not touch source_freshness — it would advertise a
// complete aggregation that never happened.
const partial = dryRun || Number.isFinite(maxPages);
const main = partial ? run : () => runWarmer("player-analytics", run);

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
