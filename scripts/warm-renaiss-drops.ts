/**
 * Renaiss's limited drops → `renaiss-drops` (src/lib/renaiss/drops.ts).
 *
 *   npx tsx --env-file=.env.local scripts/warm-renaiss-drops.ts                    # DRY RUN: prints, writes nothing
 *   npx tsx --env-file=.env.local scripts/warm-renaiss-drops.ts --apply            # the last DROPS_READ_DAYS days, merged into the history
 *   npx tsx --env-file=.env.local scripts/warm-renaiss-drops.ts --days=120 --apply # seed, or widen the history
 *   … --out=<dir>   LOCAL: <dir>/renaiss-drops.json (SNAPSHOT_LOCAL_DIR), nothing written to the database
 *
 * Reads paid pulls one UTC day at a time over the `pulled_at` index (no API
 * call), detects drops, and scores every drop in the history against the ones
 * before it, with each wallet's first Renaiss pull from renaiss_wallet_spend. A
 * re-read drop replaces its stored row, so a run that caught a drop mid-sale is
 * corrected by the next one.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectDrops, readDropPulls, readRenaissDrops, scoreDrops, writeRenaissDrops, DROPS_READ_DAYS, RENAISS_DROPS_SNAPSHOT_KEY } from "../src/lib/renaiss/drops";
import { readWalletSpend } from "../src/lib/renaiss/players";
import { runWarmer } from "../src/lib/db/runWarmer";

const DAY = 86_400_000;
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? null;
const APPLY = process.argv.includes("--apply");
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? null;

async function main() {
  const t0 = Date.now();
  const days = Math.max(2, Number(arg("days") ?? DROPS_READ_DAYS));
  const nowMs = Date.now();
  const fromMs = Math.floor(nowMs / DAY) * DAY - days * DAY;
  const [stored, pulls, wallets] = await Promise.all([readRenaissDrops(), readDropPulls(fromMs, nowMs), readWalletSpend()]);
  const fresh = detectDrops(pulls, fromMs, nowMs);
  const firstPull = new Map(wallets.rows.map((w) => [w.buyer.toLowerCase(), Date.parse(w.first_pull)]));
  const drops = scoreDrops(stored?.drops ?? [], fresh, firstPull);
  const fromIso = new Date(fromMs).toISOString();
  const historyFrom = stored && stored.historyFrom < fromIso ? stored.historyFrom : fromIso;

  console.log(`Renaiss drops · read ${days} day(s) from ${fromIso.slice(0, 10)}: ${pulls.length.toLocaleString()} paid pulls, ${fresh.length} drop(s) detected · history ${drops.length} drop(s) since ${historyFrom.slice(0, 10)} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`\n| Drop | Price | Packs | Last pack after | Buyers | Top 10 | New players | Bought an earlier drop |\n|---|---|---|---|---|---|---|---|`);
  for (const d of drops) {
    const mins = Math.round((Date.parse(d.lastAt) - Date.parse(d.firstAt)) / 60_000);
    console.log(
      `| ${d.firstAt.slice(0, 10)} ${d.name} | $${d.priceUsd ?? "—"} | ${d.packs} | ${Math.floor(mins / 60)}h ${mins % 60}m | ${d.buyers} | ${d.topBuyersSharePct.toFixed(0)}% | ${d.newPlayers} | ${d.returningBuyers} |`,
    );
  }

  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${RENAISS_DROPS_SNAPSHOT_KEY}.json`), JSON.stringify({ generatedAt: new Date().toISOString(), historyFrom, drops }));
    console.log(`\nwrote ${join(OUT, `${RENAISS_DROPS_SNAPSHOT_KEY}.json`)} (local, for SNAPSHOT_LOCAL_DIR)`);
    return { rowsWritten: 0 };
  }
  if (!APPLY) {
    console.log("\nDry run: nothing written. Pass --apply to write.");
    return { rowsWritten: 0 };
  }
  await writeRenaissDrops({ generatedAt: new Date().toISOString(), historyFrom, drops });
  console.log("\nwrote renaiss-drops");
  return { rowsWritten: drops.length };
}

(APPLY ? runWarmer("renaiss-drops", main) : main()).catch((e) => {
  console.error(e);
  process.exit(1);
});
