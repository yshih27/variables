/**
 * Renaiss machine board — 30 complete days of `renaiss_pulls` → the
 * `machines:renaiss` snapshot (src/lib/renaiss/machines.ts).
 *
 *   npx tsx scripts/warm-renaiss-machines.ts               # DRY RUN: builds and prints, writes nothing
 *   npx tsx scripts/warm-renaiss-machines.ts --out=<dir>   # LOCAL: <dir>/machines:renaiss.json
 *   npx tsx scripts/warm-renaiss-machines.ts --apply       # writes the snapshot (core batch)
 *
 * A windowed read (~60,000 pulls, one day per query), never a scan, and no API
 * call: the pulls warmer has already stored them. Its own freshness row,
 * `renaiss-machines`, so a stale board says so on /status.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildRenaissMachineBoard, readBoardPulls, writeRenaissMachineBoard, RENAISS_MACHINES_SNAPSHOT_KEY, RENAISS_MACHINE_WINDOW_DAYS } from "../src/lib/renaiss/machines";
import { runWarmer } from "../src/lib/db/runWarmer";

const argv = process.argv.slice(2);
const OUT = argv.find((a) => a.startsWith("--out="))?.split("=")[1] ?? null;
const APPLY = argv.includes("--apply") && !argv.includes("--dry-run") && !OUT;
const DAY_MS = 86_400_000;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

async function main(): Promise<{ rowsWritten: number }> {
  const t0 = Date.now();
  const now = Date.now();
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const { pulls, queries, preMigration } = await readBoardPulls(todayStart - RENAISS_MACHINE_WINDOW_DAYS * DAY_MS, todayStart, console.log);
  const board = buildRenaissMachineBoard(pulls, now);
  console.log(
    `Renaiss machines — ${pulls.length.toLocaleString()} pulls over ${RENAISS_MACHINE_WINDOW_DAYS} complete days in ${queries} queries` +
      ` (${((Date.now() - t0) / 1000).toFixed(1)}s)${preMigration ? " · pre-migration columns" : ""}${APPLY ? "" : OUT ? ` · LOCAL → ${OUT}` : " · DRY RUN (no writes)"}`,
  );
  if (!board) {
    console.log("  no machine with a pull in the window: nothing to write");
    return { rowsWritten: 0 };
  }
  const spend = board.rows.reduce((s, r) => s + r.spendUsd, 0);
  console.log(`  ${board.rows.length} machines · ${usd(spend)} spend · through ${board.asOf.slice(0, 10)} · value basis: ${board.valueBasis}`);
  console.log(`  ${"machine".padEnd(26)} ${"price".padStart(6)} ${"30d spend".padStart(11)} ${"pulls".padStart(7)} ${"7d spend".padStart(10)} ${"value back".padStart(10)} ${"hit share".padStart(16)}  top prize`);
  for (const r of board.rows.slice(0, 15)) {
    const top = r.topPrize ? `${r.topPrize.cardName ?? "(unnamed)"} · ${r.topPrize.grade ?? "—"} · ${usd(r.topPrize.valueUsd)}` : "—";
    console.log(
      `  ${r.name.slice(0, 26).padEnd(26)} ${(r.priceUsd == null ? "—" : usd(r.priceUsd)).padStart(6)} ${usd(r.spendUsd).padStart(11)} ${r.pulls.toLocaleString().padStart(7)} ${usd(r.spend7dUsd).padStart(10)} ` +
        `${(r.valueBackPct == null ? "—" : `${r.valueBackPct.toFixed(1)}%`).padStart(10)} ${(r.hitSharePct == null ? "—" : `${r.hitSharePct.toFixed(1)}% n=${r.hitN}`).padStart(16)}  ${top}`,
    );
  }
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    const f = join(OUT, `${RENAISS_MACHINES_SNAPSHOT_KEY}.json`);
    writeFileSync(f, JSON.stringify(board));
    console.log(`  wrote LOCAL ${f} (production untouched)`);
  } else if (APPLY) {
    await writeRenaissMachineBoard(board);
    console.log(`  wrote ${RENAISS_MACHINES_SNAPSHOT_KEY}`);
  }
  return { rowsWritten: board.rows.length };
}

(APPLY ? runWarmer("renaiss-machines", main) : main()).then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
