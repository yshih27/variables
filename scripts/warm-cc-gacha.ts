/**
 * Collector Crypt gacha warmer — CLI entry point.
 *
 *   npx tsx scripts/warm-cc-gacha.ts                 # the core batch's run: ingests pulls, writes gacha:cc
 *   npx tsx scripts/warm-cc-gacha.ts --out=<dir>     # LOCAL: builds gacha:cc into <dir>, writes nothing to
 *       Postgres (no gacha_pulls ingest, no snapshot, no freshness row), and prints every
 *       pack's realized stats before (the stored snapshot) and after (this build).
 *
 * Logic in src/lib/data/warmers/ccGacha.ts.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCCGachaWarm } from "../src/lib/data/warmers/ccGacha";
import { readCCGacha, CC_GACHA_KEY } from "../src/lib/data/ccGachaCache";
import { runWarmer } from "../src/lib/db/runWarmer";

const OUT = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1] ?? null;
const x = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)}×`);

async function local(dir: string): Promise<void> {
  const before = await readCCGacha();
  const r = await runCCGachaWarm({ log: (m) => console.log(m), out: true });
  const after = r.snapshot!;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${CC_GACHA_KEY}.json`), JSON.stringify(after));
  const prev = new Map((before?.packs ?? []).map((p) => [p.code, p]));
  console.log(`\nCC realized, before (stored ${before?.generatedAt ?? "—"}, winners sample) → after (this build, spine over listener coverage)`);
  console.log(`  ${"pack".padEnd(14)} ${"price".padStart(6)} ${"stated EV".padStart(9)} │ ${"n".padStart(5)} ${"median".padStart(7)} ${"mean".padStart(7)} │ ${"n".padStart(6)} ${"median".padStart(7)} ${"mean".padStart(7)}`);
  for (const p of after.packs) {
    const b = prev.get(p.code)?.realized;
    const a = p.realized;
    console.log(
      `  ${p.name.slice(0, 14).padEnd(14)} ${`$${p.priceUsd}`.padStart(6)} ${x(p.evStatedMultiple).padStart(9)} │ ${String(b?.n ?? "—").padStart(5)} ${x(b?.medianReturn).padStart(7)} ${x(b?.evMultiple).padStart(7)} │ ` +
        `${String(a?.n ?? "—").padStart(6)} ${x(a?.medianReturn).padStart(7)} ${x(a?.evMultiple).padStart(7)}`,
    );
  }
  console.log(`  wrote LOCAL ${join(dir, `${CC_GACHA_KEY}.json`)} (production untouched)`);
}

(OUT
  ? local(OUT)
  : runWarmer("cc-gacha", () => runCCGachaWarm({ log: (m) => console.log(m) })).then((r) => {
      console.log(
        `\nWrote gacha:cc — ${r.publicPacks} public packs (${r.machines} machines) · ${r.sampledPulls} pulls sampled · top hit $${Math.round(r.topHitUsd).toLocaleString()}`,
      );
    })
).then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
