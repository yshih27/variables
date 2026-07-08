/**
 * Weekly report warmer (B9-2) — composes the just-completed Mon→Mon UTC week
 * into the `weekly-report` snapshot (movers, index WoW vs benchmarks, biggest
 * sales, notable pulls). See src/lib/data/weeklyReport.ts for the methodology.
 *
 *   npx tsx scripts/warm-weekly-report.ts
 *
 * Scheduled Mondays 08:00 UTC — after cc-traits (04:00), daily (05:30), and
 * indices (06:00) so it reads a fully-refreshed week. Pure derivation over the
 * spine + already-cached feeds; safe to re-run (it just overwrites the blob).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { buildWeeklyReport, WEEKLY_REPORT_SNAPSHOT_KEY } from "../src/lib/data/weeklyReport";
import { writeSnapshot } from "../src/lib/db/snapshots";
import { runWarmer } from "../src/lib/db/runWarmer";

async function main() {
  const t0 = Date.now();
  const report = await buildWeeklyReport();

  const fmtPct = (p: number | null) => (p == null ? "—" : `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`);
  const moverCount =
    report.movers.ipVolume.gainers.length +
    report.movers.ipVolume.losers.length +
    report.movers.ipMcap.gainers.length +
    report.movers.ipMcap.losers.length +
    report.movers.platformVolume.gainers.length +
    report.movers.platformVolume.losers.length +
    report.movers.setVolume.gainers.length +
    report.movers.setVolume.losers.length;

  await writeSnapshot(WEEKLY_REPORT_SNAPSHOT_KEY, report, report.generatedAt);
  console.log(
    `Weekly report ${report.weekStart.slice(0, 10)} → ${report.weekEnd.slice(0, 10)} ` +
      `(${((Date.now() - t0) / 1000).toFixed(1)}s)\n` +
      `  index ${fmtPct(report.index.wowPct)} WoW · volume $${Math.round(report.volume.weekUsd).toLocaleString()} (${fmtPct(report.volume.wowPct)}) · ` +
      `mcap ${fmtPct(report.mcap.wowPct)}\n` +
      `  ${moverCount} movers · ${report.biggestSales.length} biggest sales · ${report.notablePulls.length} notable pulls`,
  );
  return { rowsWritten: 1 };
}

runWarmer("weekly-report", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
