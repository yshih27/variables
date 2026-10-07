/**
 * Pack-catalog warmer — CLI entry point.
 *
 *   npx tsx scripts/warm-gacha-packs.ts               # the core batch's run: writes gacha:packs
 *   npx tsx scripts/warm-gacha-packs.ts --out=<dir>   # LOCAL: builds gacha:packs into <dir>, writes
 *       nothing to Postgres, and prints per-venue counts and which stated fields are null.
 *       Pair with SNAPSHOT_LOCAL_DIR=<dir> to read a locally built gacha:cc / dyli:box-prizes.
 *
 * Assembles every venue's packs, machines, claw and boxes (Beezie, Phygitals,
 * Collector Crypt, DYLI, Renaiss) into the gacha:packs snapshot. Logic in
 * src/lib/data/warmers/gachaPacks.ts and gachaPacksVenues.ts.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGachaPacksWarm } from "../src/lib/data/warmers/gachaPacks";
import { GACHA_PACKS_KEY, type GachaPack } from "../src/lib/data/gachaPacksCache";
import { gatePack } from "../src/lib/data/gachaPackView";
import { runWarmer } from "../src/lib/db/runWarmer";

const OUT = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1] ?? null;

const NULLABLE: (keyof GachaPack)[] = ["oddsStated", "hitOddsStated", "evStated", "evStatedUsd", "buybackPct", "topHitAvailableUsd", "medianReturn", "evRealized", "hitOddsRealized"];

async function local(dir: string): Promise<void> {
  const r = await runGachaPacksWarm({ log: (m) => console.log(m), out: true });
  const snap = r.snapshot!;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${GACHA_PACKS_KEY}.json`), JSON.stringify(snap));
  console.log(`\n── packs as built (${snap.packs.length}) · ${snap.prizes?.length ?? 0} prizes ──`);
  for (const platform of [...new Set(snap.packs.map((p) => p.platform))]) {
    const ps = snap.packs.filter((p) => p.platform === platform);
    const nulls = NULLABLE.map((k) => `${String(k)} ${ps.filter((p) => p[k] == null).length}/${ps.length}`).join(" · ");
    const gated = ps.map(gatePack).filter((p) => p.medianWithheld).length;
    console.log(`  ${platform.padEnd(16)} ${String(ps.length).padStart(3)} packs · null: ${nulls} · medians withheld by the gate: ${gated}`);
  }
  console.log(`  wrote LOCAL ${join(dir, `${GACHA_PACKS_KEY}.json`)} (production untouched)`);
}

(OUT
  ? local(OUT)
  : runWarmer("gacha-packs", () => runGachaPacksWarm({ log: (m) => console.log(m) })).then((r) => {
      console.log(`\nWrote gacha:packs — ${r.packs} packs ${JSON.stringify(r.byPlatform)} · top hit $${Math.round(r.topHitMax).toLocaleString()}`);
    })
).then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
