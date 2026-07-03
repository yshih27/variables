/**
 * Extended secondary-sales feed warmer (R4-2). Caches multi-week row-level sales for
 * platforms whose native feed reaches back weeks, so trending's 7d window + momentum
 * work beyond CC.
 *
 *   npx tsx scripts/warm-secondary-sales.ts
 *
 *   • Beezie — one api.beezie.com/activity call (node fetch; WAF blocks curl) yields
 *     ~30d of order_fulfilled sales (~2.6K rows). Real 7d/momentum for Beezie.
 *   • Phygitals is NOT fetched: its /sales feed is 100% gacha (CLAW/BUY) — no P2P
 *     secondary sales — and its real trades live on Tensor/ME (needs a Dune query).
 *
 * Runs in the DAILY batch (Beezie 7d/30d trending refreshes daily is plenty).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { fetchBeezieSales } from "../src/lib/beezie/market";
import { writeSecondarySales } from "../src/lib/data/secondarySalesCache";
import { runWarmer } from "../src/lib/db/runWarmer";

const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

async function main() {
  const platforms: Record<string, Awaited<ReturnType<typeof fetchBeezieSales>>> = {};

  const beezie = await fetchBeezieSales(WINDOW_DAYS * DAY);
  platforms.beezie = beezie;
  const bt = beezie.map((s) => Date.parse(s.date)).filter(Number.isFinite);
  const spanD = bt.length ? ((Math.max(...bt) - Math.min(...bt)) / DAY).toFixed(1) : "0";
  console.log(`Beezie /activity: ${beezie.length} sales spanning ${spanD}d`);

  await writeSecondarySales({
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    platforms,
  });
  const total = Object.values(platforms).reduce((n, arr) => n + arr.length, 0);
  console.log(`Wrote secondary-sales snapshot · ${total} sales across ${Object.keys(platforms).length} platform(s)`);
  return { rowsWritten: total };
}

runWarmer("secondary-sales", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
