/**
 * Pack spend by IP → the `ip-pack-spend` snapshot (src/lib/data/ipPackSpend.ts).
 *
 * Reads, with no API call: Collector Crypt's machine board (the player-analytics
 * snapshot, 30 complete days of captured pulls per machine), Renaiss's pulls
 * (renaiss_pulls, one day per query, as the machine board reads them) and each
 * venue's gacha_volume_usd (spine), for the coverage line — all three over ONE
 * window, the board's 30 complete days (packSpendWindow).
 *
 *   npx tsx scripts/warm-ip-pack-spend.ts           # dry run: prints the split, writes nothing
 *   npx tsx scripts/warm-ip-pack-spend.ts --apply
 *   npx tsx scripts/warm-ip-pack-spend.ts --out=<dir>   # LOCAL: writes <dir>/ip-pack-spend.json,
 *       not the database; serve it with SNAPSHOT_LOCAL_DIR=<dir>
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { runWarmer } from "../src/lib/db/runWarmer";
import { readPlayerAnalytics } from "../src/lib/data/playerAnalytics";
import { readMetricSeries, sumLastCompleteDays, sumWindowDays } from "../src/lib/data/metricSnapshots";
import { readBoardPulls } from "../src/lib/renaiss/machines";
import { buildIpPackSpend, packSpendWindow, writeIpPackSpend, IP_PACK_SPEND_KEY, PACK_SPEND_WINDOW_DAYS } from "../src/lib/data/ipPackSpend";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DAY = 86_400_000;
const VENUES = ["collector-crypt", "courtyard", "phygitals", "renaiss", "beezie", "dyli"];
const apply = process.argv.includes("--apply");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const outDir = outArg ? outArg.slice("--out=".length) : null;

async function main() {
  const players = await readPlayerAnalytics();
  const board = players?.machines ?? null;
  if (board && board.windowDays !== PACK_SPEND_WINDOW_DAYS) {
    console.warn(`  Collector Crypt board covers ${board.windowDays} days, not ${PACK_SPEND_WINDOW_DAYS}: its machines are credited over its own window`);
  }
  const { startMs, endMs: windowEndMs } = packSpendWindow(board?.asOf, Date.now());

  const [{ pulls, queries }, ...series] = await Promise.all([
    readBoardPulls(startMs, windowEndMs),
    ...VENUES.map((v) => readMetricSeries("platform", v, "gacha_volume_usd").catch(() => [])),
  ]);
  // Each venue's pack spend over exactly the window's days. A venue whose spine
  // stops short of the window's last day keeps its own latest 30 complete days
  // instead of dropping out of the total: Beezie's Claw lands on Dune after the
  // daily run (Oct 21: Sep 21–Oct 20 complete for every venue but Beezie, through
  // Oct 19). That shifts one venue's share of the "of $Y" denominator by a day;
  // the credited figures always use the window.
  const venueTotals: Record<string, number | null> = {};
  VENUES.forEach((v, i) => {
    const exact = sumWindowDays(series[i], startMs, windowEndMs);
    const s = Number.isFinite(exact) ? exact : sumLastCompleteDays(series[i], PACK_SPEND_WINDOW_DAYS);
    venueTotals[v] = Number.isFinite(s) ? s : null;
    if (!Number.isFinite(exact) && Number.isFinite(s)) console.log(`  ${v}: spine short of the window's last day — total from its own latest ${PACK_SPEND_WINDOW_DAYS} complete days`);
  });

  const snap = buildIpPackSpend({
    ccBoard: board,
    renaissPulls: pulls.map((p) => ({ product_id: p.product_id, price_usd: p.price_usd, pulled_at: p.pulled_at, prize_card_name: p.prize_card_name, prize_set_name: null })),
    windowEndMs,
    venueTotals,
  });

  const fmt = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);
  console.log(`window: ${PACK_SPEND_WINDOW_DAYS} complete days to ${new Date(windowEndMs - DAY).toISOString().slice(0, 10)} · Renaiss pulls read ${pulls.length} (${queries} queries)`);
  for (const [ip, row] of Object.entries(snap.byIp).sort((a, b) => b[1].usd30d - a[1].usd30d)) {
    console.log(`  ${ip.padEnd(15)} 30d ${fmt(row.usd30d).padStart(12)} · 7d ${fmt(row.usd7d).padStart(11)} · ${Object.entries(row.byVenue).map(([v, x]) => `${v} ${fmt(x.usd30d)}`).join(" · ")}`);
  }
  for (const [v, c] of Object.entries(snap.venues)) console.log(`  ${v.padEnd(16)} credited ${fmt(c.creditedUsd30d)} of ${fmt(c.packSpend30dUsd)} · ${c.basis}`);

  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${IP_PACK_SPEND_KEY}.json`), JSON.stringify(snap));
    console.log(`wrote ${join(outDir, `${IP_PACK_SPEND_KEY}.json`)} (local only)`);
    return { rowsWritten: 0 };
  }
  if (!apply) {
    console.log("dry run: pass --apply to write the snapshot");
    return { rowsWritten: 0 };
  }
  await writeIpPackSpend(snap);
  console.log(`wrote ip-pack-spend: ${Object.keys(snap.byIp).length} IPs`);
  return { rowsWritten: Object.keys(snap.byIp).length };
}

// A dry run records nothing: runWarmer writes a freshness row on every outcome,
// and a dry run that wrote "ok" would tell /status the snapshot was refreshed.
(apply ? runWarmer("ip-pack-spend", main) : main()).catch((e) => {
  console.error(e);
  process.exit(1);
});
