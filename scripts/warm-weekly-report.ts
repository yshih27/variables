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

  // ── Sanity guard: refuse to publish a mass collapse ────────────────────────
  // Several platforms all losing ~all of their weekly activity at once is not a
  // market event, it is a broken pipeline — a dead spine writer, an upstream feed
  // that stopped, a window that shifted. The report is the most quotable surface
  // we have, so it must fail loudly rather than publish "-97% across the board".
  // Deliberately checked AFTER buildWeeklyReport and BEFORE the write, so the
  // previous week's snapshot survives intact and can be served while this is
  // investigated. Throwing reaches runWarmer → an "error" freshness row → the
  // health gate reddens; the .catch below makes the exit non-zero.
  //
  // The losers board is ranked most-negative-first and capped at TOP_N (5 > 3),
  // so any platform at or below the threshold is guaranteed to appear on it.
  // Platforms whose PRIOR week was below the mover base floor never rank at all,
  // so a genuinely tiny platform can't trip this.
  const COLLAPSE_PCT = -90;
  const COLLAPSE_MIN_PLATFORMS = 3;
  const collapsed = report.movers.platformVolume.losers.filter((m) => m.pct <= COLLAPSE_PCT);
  if (collapsed.length >= COLLAPSE_MIN_PLATFORMS) {
    console.error(
      `\n✗ WEEKLY REPORT NOT WRITTEN — ${collapsed.length} platforms at ≤${COLLAPSE_PCT}% WoW activity.\n` +
        `  That reads as a pipeline failure, not a market move. The previous snapshot is untouched.\n`,
    );
    for (const m of collapsed) {
      console.error(
        `    ${m.name.padEnd(20)} ${m.pct.toFixed(1).padStart(8)}%   ` +
          `$${Math.round(m.previousUsd).toLocaleString()} → $${Math.round(m.currentUsd).toLocaleString()}`,
      );
    }
    console.error(
      `\n  Check: the spine's platform volume_usd streams (check-invariants INV-9 source-death),\n` +
        `  then whether warm-metric-snapshots actually ran for this week.\n`,
    );
    throw new Error(
      `weekly-report: ${collapsed.length} platforms at ≤${COLLAPSE_PCT}% WoW — refusing to publish a suspected pipeline failure`,
    );
  }

  await writeSnapshot(WEEKLY_REPORT_SNAPSHOT_KEY, report, report.generatedAt);
  console.log(
    `Weekly report ${report.weekStart.slice(0, 10)} → ${report.weekEnd.slice(0, 10)} ` +
      `(${((Date.now() - t0) / 1000).toFixed(1)}s)\n` +
      `  ${report.index.ticker} ${fmtPct(report.index.wowPct)} WoW · volume $${Math.round(report.volume.weekUsd).toLocaleString()} (${fmtPct(report.volume.wowPct)}) · ` +
      `mcap ${fmtPct(report.mcap.wowPct)}\n` +
      `  ${moverCount} movers · ${report.biggestSales.length} biggest sales · ${report.notablePulls.length} notable pulls`,
  );
  return { rowsWritten: 1 };
}

runWarmer("weekly-report", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
