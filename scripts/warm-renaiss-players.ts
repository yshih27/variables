/**
 * Renaiss players — lifetime spend per wallet from `renaiss_wallet_spend()`
 * (the repo's first RPC, migration 20261007000002) → the `players:renaiss`
 * snapshot (src/lib/renaiss/players.ts).
 *
 *   npx tsx scripts/warm-renaiss-players.ts               # DRY RUN: builds and prints, writes nothing
 *   npx tsx scripts/warm-renaiss-players.ts --out=<dir>   # LOCAL: <dir>/players:renaiss.json
 *   npx tsx scripts/warm-renaiss-players.ts --apply       # writes the snapshot (core batch)
 *   … --reseed   rebuild players-per-month from the first pull (about 5-7 min); otherwise
 *                only the previous and current month are re-read and older months kept
 *
 * ⚠️ BEFORE THE MIGRATION IS APPLIED the function does not exist: the run says
 * so in one line and exits 0 without writing, so the step stays green until the
 * orchestrator applies it. Never inside the daily job (its player-analytics
 * scan already fills it).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildRenaissPlayers,
  isMissingFunction,
  readMonthlyBuyers,
  readPullCoverage,
  readRenaissPlayers,
  readWalletSpend,
  renaissMonthlyPlayers,
  writeRenaissPlayers,
  RENAISS_PLAYERS_SNAPSHOT_KEY,
  type RenaissPlayersSnapshot,
} from "../src/lib/renaiss/players";
import { runWarmer } from "../src/lib/db/runWarmer";

const argv = process.argv.slice(2);
const OUT = argv.find((a) => a.startsWith("--out="))?.split("=")[1] ?? null;
const APPLY = argv.includes("--apply") && !argv.includes("--dry-run") && !OUT;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

async function main(): Promise<{ rowsWritten: number }> {
  let read: Awaited<ReturnType<typeof readWalletSpend>>;
  try {
    read = await readWalletSpend();
  } catch (e) {
    if (isMissingFunction((e as Error).message)) {
      console.log("renaiss players: renaiss_wallet_spend() is not in the database yet (migration 20261007000002 not applied); nothing written");
      return { rowsWritten: 0 };
    }
    throw e;
  }
  const coverage = await readPullCoverage();
  const platform = buildRenaissPlayers(read.rows, coverage);

  // Players per month. Stored months stay; the previous and current month are
  // re-read (late pulls land there). A failed read keeps the stored months and
  // never fails the snapshot.
  const stored = (await readRenaissPlayers())?.platform.monthlyPlayers;
  const now = Date.now();
  const firstPull = read.rows.reduce((m, r) => (r.first_pull && r.first_pull < m ? r.first_pull : m), "9999");
  const reseed = argv.includes("--reseed") || !stored?.length;
  const prev = new Date(now);
  prev.setUTCDate(1);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const recomputeFrom = reseed ? firstPull.slice(0, 7) : prev.toISOString().slice(0, 7);
  try {
    const t0 = Date.now();
    const monthly = await readMonthlyBuyers(Date.parse(`${recomputeFrom}-01T00:00:00Z`), now, (l) => console.log(l));
    platform.monthlyPlayers = renaissMonthlyPlayers(monthly.months, read.rows, stored, recomputeFrom, monthly.spend);
    console.log(`  players per month: re-read from ${recomputeFrom}${reseed ? " (reseed)" : ""} · ${monthly.rows.toLocaleString()} checkouts · ${monthly.queries} queries · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    for (const m of platform.monthlyPlayers) {
      console.log(`    ${m.month} ${m.players.toLocaleString().padStart(6)} players · ${m.firstTime.toLocaleString().padStart(5)} first-time · ${(m.players ? (100 * (m.players - m.firstTime)) / m.players : 0).toFixed(1)}% returning`);
    }
  } catch (e) {
    platform.monthlyPlayers = stored;
    console.log(`  players per month: read failed, kept ${stored?.length ?? 0} stored month(s): ${e instanceof Error ? e.message : e}`);
  }
  const snap: RenaissPlayersSnapshot = { generatedAt: new Date().toISOString(), platform, read: { pages: read.pages, wallets: read.rows.length, ms: read.ms } };
  const c = platform.concentration;
  console.log(
    `Renaiss players — ${read.rows.length.toLocaleString()} wallets in ${read.pages} page(s), ${read.ms} ms · ` +
      `${coverage.rows.toLocaleString()} pulls, ${coverage.walletAttributedRows.toLocaleString()} with a wallet, ${coverage.pricedRows.toLocaleString()} priced` +
      `${APPLY ? "" : OUT ? ` · LOCAL → ${OUT}` : " · DRY RUN (no writes)"}`,
  );
  console.log(
    `  lifetime ${usd(c.totalSpendUsd)} · avg ${usd(c.avgLifetimeSpendUsd)} · median ${usd(c.medianLifetimeSpendUsd)} · top 1% ${c.top1PctShare.toFixed(1)}% · top 10% ${c.top10PctShare.toFixed(1)}% · active 30d ${c.activeWallets30d.toLocaleString()}`,
  );
  for (const t of platform.tiers) console.log(`  ${t.label.padEnd(10)} ${t.users.toLocaleString().padStart(7)} wallets (${t.pctUsers.toFixed(1)}%) · ${usd(t.totalSpendUsd)} (${t.pctRevenue.toFixed(1)}%)`);
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    const f = join(OUT, `${RENAISS_PLAYERS_SNAPSHOT_KEY}.json`);
    writeFileSync(f, JSON.stringify(snap));
    console.log(`  wrote LOCAL ${f} (production untouched)`);
  } else if (APPLY) {
    await writeRenaissPlayers(snap);
    console.log(`  wrote ${RENAISS_PLAYERS_SNAPSHOT_KEY}`);
  }
  return { rowsWritten: read.rows.length };
}

(APPLY ? runWarmer("renaiss-players", main) : main()).then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
