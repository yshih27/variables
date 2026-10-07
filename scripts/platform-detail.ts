/**
 * The platform page's payload for one venue, built locally — a DRY RUN that
 * reads production snapshots and stores and writes only `--out`.
 *
 *   npx tsx scripts/platform-detail.ts --platform=renaiss --out=<dir>
 *   npx tsx scripts/platform-detail.ts --platform=renaiss --rebuild-core-entry
 *       rebuilds the venue's core-volume entry from its store with THIS branch's
 *       code (the 7-day table list included) instead of the stored one — Renaiss
 *       only, no Dune read — so the tables' window can be seen before a core run
 *       has written it.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPlatformDetail } from "../src/lib/data/fetchPlatform";
import { buildPlatformBuckets } from "../src/lib/data/buckets";
import { buildPlatform } from "../src/lib/data/warmers/core";
import { readRenaissSales } from "../src/lib/renaiss/sales";

const argv = process.argv.slice(2);
const val = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? null;
const KEY = val("platform") ?? "renaiss";
const OUT = val("out");
const REBUILD = argv.includes("--rebuild-core-entry");
const DAY = 86_400_000;
const usd = (n: number) => (Number.isFinite(n) ? `$${Math.round(n).toLocaleString("en-US")}` : "—");

async function main(): Promise<number> {
  const t0 = Date.now();
  const load = async () => {
    const buckets = await buildPlatformBuckets();
    if (!REBUILD || KEY !== "renaiss") return buckets;
    const { sales } = await readRenaissSales({ sinceMs: Date.now() - 30 * DAY });
    const entry = buildPlatform("renaiss", "renaiss", sales, 30);
    return buckets.map((b) =>
      b.source.key === "renaiss"
        ? { ...b, stats24h: entry.stats24h, sales24h: entry.sales24h, ...(entry.sales7d ? { sales7d: entry.sales7d } : {}), hasSecondarySource: true }
        : b,
    );
  };
  const d = await buildPlatformDetail(KEY, load);
  if (!d) {
    console.log(`no bucket for ${KEY}`);
    return 1;
  }
  console.log(`${KEY} platform detail — DRY RUN${REBUILD ? " · core entry rebuilt from the store with this branch's code" : " · core-volume as stored"} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  24h: ${usd(d.vol24Usd)} on ${d.trades24h} trades · tables window ${d.salesWindow} · enriched ${d.salesEnriched} of ${d.salesTotal} sales`);
  console.log(`  By IP: ${d.ips.map((r) => `${r.key} ${r.trades24h} trades ${usd(r.vol24Usd)}`).join(" · ") || "none"}`);
  console.log(`  Top cards: ${d.topCards.length} · Recent sales: ${d.recentSales.length}`);
  for (const r of d.recentSales.slice(0, 5)) console.log(`    ${r.date.slice(0, 16)} ${usd(r.priceUsd).padStart(7)} ${r.ipKey.padEnd(10)} ${r.cardName ?? "(no name)"}`);
  console.log(`  holders ${Number.isFinite(d.holders) ? d.holders : "—"}${d.holdersReason ? ` (${d.holdersReason})` : ""} · market cap ${usd(d.mcapUsd)}${d.mcapReason ? ` (${d.mcapReason})` : ""}`);
  console.log(`  biggest pulls (30d): ${d.biggestPulls == null ? "none (no named pull feed)" : `${d.biggestPulls.length}, top ${d.biggestPulls[0] ? `${d.biggestPulls[0].cardName} · ${d.biggestPulls[0].grade ?? "—"} · ${usd(d.biggestPulls[0].valueUsd)} (${d.biggestPulls[0].valueBasis})` : "—"}`}`);
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `platform-detail.${KEY}.json`), JSON.stringify(d, null, 2));
    console.log(`  wrote LOCAL ${join(OUT, `platform-detail.${KEY}.json`)}`);
  }
  return 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
