/**
 * Pack spend by IP → the `ip-pack-spend` snapshot (src/lib/data/ipPackSpend.ts).
 *
 * Reads, with no API call: Collector Crypt's machine board (the player-analytics
 * snapshot, 30 complete days of captured pulls per machine), Renaiss's pulls over
 * the last 30 complete days (renaiss_pulls, one day per query, as the machine
 * board reads them), and each venue's gacha_volume_usd over the same window
 * (spine), for the coverage line.
 *
 *   npx tsx scripts/warm-ip-pack-spend.ts           # dry run: prints the split, writes nothing
 *   npx tsx scripts/warm-ip-pack-spend.ts --apply
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { runWarmer } from "../src/lib/db/runWarmer";
import { readPlayerAnalytics } from "../src/lib/data/playerAnalytics";
import { readMetricSeries, sumLastCompleteDays } from "../src/lib/data/metricSnapshots";
import { readBoardPulls } from "../src/lib/renaiss/machines";
import { buildIpPackSpend, writeIpPackSpend, PACK_SPEND_WINDOW_DAYS } from "../src/lib/data/ipPackSpend";

const DAY = 86_400_000;
const VENUES = ["collector-crypt", "courtyard", "phygitals", "renaiss", "beezie", "dyli"];
const apply = process.argv.includes("--apply");

async function main() {
  const now = new Date();
  const windowEndMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startMs = windowEndMs - PACK_SPEND_WINDOW_DAYS * DAY;

  const [players, { pulls, queries }, ...series] = await Promise.all([
    readPlayerAnalytics(),
    readBoardPulls(startMs, windowEndMs),
    ...VENUES.map((v) => readMetricSeries("platform", v, "gacha_volume_usd").catch(() => [])),
  ]);
  const venueTotals: Record<string, number | null> = {};
  VENUES.forEach((v, i) => {
    const s = sumLastCompleteDays(series[i], PACK_SPEND_WINDOW_DAYS);
    venueTotals[v] = Number.isFinite(s) ? s : null;
  });

  const snap = buildIpPackSpend({
    ccBoard: players?.machines ?? null,
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
