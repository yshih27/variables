/**
 * The /gacha payload, built locally — a DRY RUN that reads the snapshots
 * (SNAPSHOT_LOCAL_DIR serves locally built ones) and writes only `--out`.
 *
 *   npx tsx scripts/gacha-payload.ts --out=<dir>
 *   npx tsx scripts/gacha-payload.ts --at=+20m      # evaluate the hits as if read 20 minutes from now
 *       (shows the fallback once the listener's heartbeat passes 15 minutes)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildGacha, buildVenuePrizes, getGachaPayload, liveHeartbeatMs, LIVE_HEARTBEAT_MAX_MS } from "../src/lib/data/fetchGacha";
import { readGachaLive } from "../src/lib/data/gachaLiveCache";

const argv = process.argv.slice(2);
const val = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? null;
const OUT = val("out");
const AT = val("at");
const usd = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);

function offsetMs(s: string | null): number {
  const m = s ? /^\+(\d+)(m|h)$/.exec(s) : null;
  return m ? Number(m[1]) * (m[2] === "h" ? 3_600_000 : 60_000) : 0;
}

async function main(): Promise<number> {
  const now = Date.now() + offsetMs(AT);
  const live = await readGachaLive().catch(() => null);
  const beat = liveHeartbeatMs(live);
  const p = await getGachaPayload(now, buildGacha);
  console.log(
    `gacha payload — DRY RUN${AT ? ` · evaluated at now ${AT}` : ""} · listener heartbeat ${beat ? new Date(beat).toISOString() : "none"} ` +
      `(${beat ? ((now - beat) / 60_000).toFixed(1) : "—"} min old; live while ≤ ${LIVE_HEARTBEAT_MAX_MS / 60_000} min)`,
  );
  console.log(`  hits: source ${p.hitsSource} · as of ${p.hitsAsOf ?? "—"} · ${p.bigHits.length} hits in 7 days · biggest ${usd(p.hero.biggestHitUsd)} (${p.bigHits[0]?.at ?? "—"})`);
  console.log(`  hero: best typical return ${p.hero.bestEvMultiple == null ? "—" : `${p.hero.bestEvMultiple.toFixed(2)}×`} (${p.hero.bestEvPlatform ?? "—"} · ${p.hero.bestEvPackId ?? "—"})`);
  console.log(`  venues: ${p.venues.map((v) => `${v.name} (${v.kind}) ${v.covered ? "covered" : `NOT covered: ${v.reason}`}`).join(" · ")}`);
  console.log(`  packs ${p.packs.length} · medians withheld ${p.packs.filter((x) => x.medianWithheld).length} · mixed pools: ${p.packs.filter((x) => x.mixedPool).map((x) => `${x.platform}:${x.name}`).join(", ") || "none"}`);
  const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
  console.log(`  cached entries: payload ${size(p).toLocaleString()} bytes (limit 2,097,152)`);
  for (const [venue, n] of Object.entries(p.prizesByVenue)) {
    console.log(`    prizes:${venue.padEnd(16)} ${String(n).padStart(5)} prizes · ${size(await buildVenuePrizes(venue)).toLocaleString()} bytes`);
  }
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `gacha-payload${AT ? `.at${AT}` : ""}.json`), JSON.stringify(p));
    console.log(`  wrote LOCAL ${join(OUT, `gacha-payload${AT ? `.at${AT}` : ""}.json`)}`);
  }
  return 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
