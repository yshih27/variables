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

  for (const [platform, pa] of Object.entries(snap.partners ?? {})) {
    console.log(
      `\n${platform} partners — ${pa.rows.length} attributed · ${pa.attributedPct.toFixed(2)}% of 30d pulls` +
        ` (24h ${pa.attributedPct24h.toFixed(2)}% · 7d ${pa.attributedPct7d.toFixed(2)}% · lifetime ${pa.attributedPctLifetime.toFixed(2)}%)`,
    );
    console.log(`  floor $${pa.config.minVolumeUsd.toLocaleString()} — rows below it are sent but the component hides them`);
    console.log(`  slug            30d pulls    30d volume     lifetime pulls    lifetime vol   clears floor?`);
    for (const r of [...pa.rows].sort((a, b) => b.volumeUsd30d - a.volumeUsd30d)) {
      console.log(
        `    ${r.slug.padEnd(12)} ${String(r.pulls30d).padStart(9)} $${Math.round(r.volumeUsd30d).toLocaleString().padStart(12)} ` +
          `${String(r.pullsLifetime).padStart(15)} $${Math.round(r.volumeUsdLifetime).toLocaleString().padStart(13)}   ${r.volumeUsd30d >= pa.config.minVolumeUsd ? "YES" : "no"}`,
      );
    }
  }
  if (!snap.partners) console.log(`\n· no partner attribution yet (no pull carries a memo_slug)`);

  // ── Machines ──────────────────────────────────────────────────────────────
  // The share column is of ATTRIBUTED spend, and the header states the rate, so
  // the log reads the same way the published board does. Untagged spend is its
  // own column — never folded into `cc`. See docs/roadmap/cc-machines-findings.md.
  const mb = snap.machines;
  if (mb) {
    console.log(
      `\nmachines — ${mb.rows.length} machine(s) over ${mb.windowDays} complete days ` +
        `(as of ${mb.asOf.slice(0, 10)}) · ${mb.attributedSpendPct.toFixed(1)}% of spend attributed`,
    );
    console.log(`  machine                        price    30d spend    pulls    7d spend   attr%   top partner`);
    for (const r of mb.rows.slice(0, 10)) {
      const attrPct = r.spendUsd > 0 ? (r.attributedUsd / r.spendUsd) * 100 : 0;
      console.log(
        `  ${r.name.slice(0, 28).padEnd(28)} ${(r.priceUsd == null ? "—" : "$" + r.priceUsd).padStart(6)} ` +
          `$${Math.round(r.spendUsd).toLocaleString().padStart(11)} ${String(r.pulls).padStart(8)} ` +
          `$${Math.round(r.spend7dUsd).toLocaleString().padStart(10)} ${attrPct.toFixed(1).padStart(6)}%   ` +
          (r.topPartner ? `${r.topPartner.label} ${r.topPartner.sharePct.toFixed(0)}%` : "—"),
      );
    }
    const noAttr = mb.rows.filter((r) => r.attributedUsd === 0).length;
    console.log(`  ${mb.rows.length - noAttr}/${mb.rows.length} machine(s) carry at least one attributed pull`);
  } else {
    console.log(`\n· no machine board (no complete-day Collector Crypt pulls in the window)`);
  }

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
