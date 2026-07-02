/**
 * Pack-catalog warmer — CLI entry point.
 *
 *   npm run warm-gacha-packs
 *
 * Assembles the cross-platform GachaPack[] (Beezie /claw advertised, Phygitals
 * /vm/chase + realized join, CC Dune platform-grain) and writes the gacha:packs
 * snapshot + freshness. Logic in src/lib/data/warmers/gachaPacks.ts (shared with
 * the cron route). Cadence: a few times a day (advertised catalogs move slowly;
 * realized side accumulates from the phygitals-gacha warmer).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { runGachaPacksWarm } from "../src/lib/data/warmers/gachaPacks";
import { runWarmer } from "../src/lib/db/runWarmer";

// runWarmer records source_freshness on every outcome (ok / soft-fail throw /
// mid-run throw) and re-throws, so the Actions health gate sees a dead warmer.
runWarmer("gacha-packs", () => runGachaPacksWarm({ log: (m) => console.log(m) }))
  .then((r) => {
    console.log(
      `\nWrote gacha:packs — ${r.packs} packs ${JSON.stringify(r.byPlatform)} · top hit $${Math.round(r.topHitMax).toLocaleString()}`,
    );
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
