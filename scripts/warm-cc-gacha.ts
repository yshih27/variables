/**
 * Collector Crypt gacha warmer — CLI entry point.
 *
 *   npm run warm-cc-gacha
 *
 * Pulls the native gacha app's machine catalog + winners feed, ingests pulls
 * into the gacha_pulls spine, and writes the gacha:cc snapshot (per-pack stated
 * odds/EV/buyback + realized stats). Logic in src/lib/data/warmers/ccGacha.ts
 * (shared with the cron route). Run BEFORE warm-gacha-packs, which reads it.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { runCCGachaWarm } from "../src/lib/data/warmers/ccGacha";

runCCGachaWarm({ log: (m) => console.log(m) })
  .then((r) => {
    console.log(
      `\nWrote gacha:cc — ${r.publicPacks} public packs (${r.machines} machines) · ${r.sampledPulls} pulls sampled · top hit $${Math.round(r.topHitUsd).toLocaleString()}`,
    );
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
