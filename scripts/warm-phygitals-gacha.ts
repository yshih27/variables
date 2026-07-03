/**
 * Phygitals GACHA warmer — CLI entry point.
 *
 *   npm run warm-phygitals-gacha                 # harvest recent pulls, 7d window
 *   npm run warm-phygitals-gacha -- --pages 500  # scan deeper (feed permitting)
 *   npm run warm-phygitals-gacha -- --days 14    # wider accumulation window
 *   npm run warm-phygitals-gacha -- --max 1000   # stop after N unique pulls
 *
 * Ingests this run's unique CLAW pulls into the durable gacha_pulls spine, then
 * derives realized value-odds + per-pack EV + biggest hits from the ACCUMULATED
 * window — writing the snapshot (key='gacha:phygitals') + spine + freshness.
 * Logic lives in src/lib/data/warmers/phygitalsGacha.ts so the cron route
 * (app/api/cron/phygitals-gacha) shares it.
 *
 * Cadence: a few times a day — the feed only exposes a shallow recent window per
 * scan, so frequent runs accumulate a fuller picture. Dune carries volume.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { runPhygitalsGachaWarm } from "../src/lib/data/warmers/phygitalsGacha";
import { runWarmer } from "../src/lib/db/runWarmer";

function intArg(flag: string): number | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) {
    const n = parseInt(process.argv[i + 1], 10);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

// runWarmer records source_freshness on every outcome (ok / soft-fail throw /
// mid-run throw) and re-throws, so the Actions health gate sees a dead warmer.
runWarmer("phygitals-gacha", () =>
  runPhygitalsGachaWarm({
    maxPages: intArg("--pages"),
    maxPulls: intArg("--max"),
    windowDays: intArg("--days"),
    log: (m) => console.log(m),
  }),
)
  .then((r) => {
    console.log(
      `\nWrote Phygitals gacha snapshot — ${r.scannedPulls} new pulls → ${r.windowPulls} in window · ${r.products} packs · realized EV ${r.realizedEv != null ? r.realizedEv.toFixed(2) + "×" : "—"} · ${r.bigHits} hits (top $${Math.round(r.topHitUsd).toLocaleString()}) · window ~${r.windowHours != null ? r.windowHours.toFixed(1) : "?"}h`,
    );
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
