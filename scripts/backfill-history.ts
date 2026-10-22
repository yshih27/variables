/**
 * Backfill 7d hourly history per platform (history:<platform>) and per IP
 * (history:by-ip). The IP rail's 24h change, the homepage volume sparkline and
 * each platform's 7d sparkline read these.
 *
 * Sources: the same feeds as each platform's 24h figures —
 *   • Collector Crypt: the Dune secondary-sales query (cached result);
 *   • Beezie: its own /activity feed (fetchBeezieSales), as the core warmer and the
 *     daily spine read it. NOT Rarible: Rarible's index of the collection also
 *     carries Claw purchases and buybacks, so its "sales" ran ~70× Beezie's resale
 *     ($575,109 over the 7 days to Oct 21 2026 vs $8,024 on /activity, Oct 14–20)
 *     and the IP rail's 24h change measured those instead of the 24h level beside it;
 *   • Courtyard: Rarible's activity index (OpenSea trades; its exchange is not here).
 *
 * One venue's feed failing does not stop the others. Beezie's and Courtyard's are
 * third-party feeds that can close (Oct 22 2026: Beezie's API began answering
 * automated reads with a Cloudflare challenge, and the whole step — Collector
 * Crypt's blob and the per-IP history with it — stopped refreshing). A failed
 * venue's blob is emptied, not left stale: a stale blob keeps drawing last week's
 * shape as if it were current. The per-IP history is built from the venues read,
 * as core-volume is (it drops a failed venue too). Collector Crypt failing is
 * still fatal: without it the per-IP history would mean nothing.
 *
 *   npx tsx scripts/backfill-history.ts
 *   npx tsx scripts/backfill-history.ts --dry-run [--only=beezie]   # prints, writes nothing
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { PLATFORM_SOURCES } from "../src/lib/data/sources";
import { collectSales, type NormalizedSale } from "../src/lib/rarible/queries";
import { fetchCCSecondarySales } from "../src/lib/data/warmers/core";
import { fetchBeezieSales } from "../src/lib/beezie/market";
import { bucketsFromSales, pctChange, sumLast, writeHistory, writeIpHistory, type HourBucket } from "../src/lib/data/history";
import { getBeezieMetadataCachedOnly, extractCategoryHints } from "../src/lib/data/beezieTraits";
import { getCCMetadataCachedOnly } from "../src/lib/data/ccTraits";
import { classifyIP } from "../src/lib/data/ipClassify";
import type { TokenMetadata } from "../src/lib/onchain/tokenUri";
import { runWarmer } from "../src/lib/db/runWarmer";

const HOUR_MS = 60 * 60 * 1000;
const dryRun = process.argv.includes("--dry-run");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length).split(",").filter(Boolean) : null;

async function main() {
  // A partial run must not overwrite history:by-ip with some platforms missing.
  if (only && !dryRun) throw new Error("--only needs --dry-run: it would write a partial history:by-ip");
  let platforms = 0;
  const failed: string[] = [];
  // Per-IP sales accumulated across platforms (Beezie + CC, which have metadata
  // readers — the same scope fetchIP enriches). Bucketed into history:by-ip below.
  const ipSales = new Map<string, NormalizedSale[]>();
  for (const p of PLATFORM_SOURCES) {
    if (only && !only.includes(p.key)) continue;
    const t0 = Date.now();
    let read: () => Promise<NormalizedSale[]>;
    if (p.key === "collector-crypt") {
      // Dune cached results (no Helius 429 — the old collectCCSales path that
      // left history:collector-crypt 32 days stale).
      read = () => fetchCCSecondarySales({ cachedOnly: true });
    } else if (p.key === "beezie") {
      read = () => fetchBeezieSales(168 * HOUR_MS);
    } else if (p.kind === "rarible") {
      const collectionId = p.collectionId;
      read = () => collectSales(collectionId, 168 * HOUR_MS);
    } else {
      continue; // no secondary-sales source yet (e.g. Phygitals)
    }
    let sales: NormalizedSale[];
    try {
      sales = await read();
    } catch (e) {
      failed.push(p.key);
      console.warn(`→ ${p.name}: FAILED (${(e as Error).message}) — history:${p.key} ${dryRun ? "would be " : ""}emptied; per-IP history from the other venues`);
      if (!dryRun) await writeHistory(p.key, { generatedAt: new Date().toISOString(), buckets: [] });
      continue;
    }
    const buckets = bucketsFromSales(sales, 168);
    if (!dryRun) await writeHistory(p.key, { generatedAt: new Date().toISOString(), buckets });
    platforms += 1;
    const totalVol = buckets.reduce((s, b) => s + b.volumeUsd, 0);
    const inWindow = buckets.reduce((s, b) => s + b.sales, 0);
    console.log(
      `→ ${p.name}: ${inWindow} 7d sales · $${totalVol.toFixed(0)} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
    );

    // Per-IP rollup — classify each sale by IP via its cached metadata. Only
    // Beezie + CC have a reader; Courtyard/Phygitals are skipped (as in fetchIP).
    let metas: Map<string, TokenMetadata> | null = null;
    if (p.key === "collector-crypt") {
      metas = await getCCMetadataCachedOnly(sales.map((s) => s.tokenId));
    } else if (p.key === "beezie") {
      metas = await getBeezieMetadataCachedOnly(sales.map((s) => s.tokenId));
    }
    if (metas) {
      for (const s of sales) {
        const meta = metas.get(s.tokenId);
        if (!meta) continue;
        const ipKey = classifyIP(extractCategoryHints(meta)).key;
        let arr = ipSales.get(ipKey);
        if (!arr) {
          arr = [];
          ipSales.set(ipKey, arr);
        }
        arr.push(s);
      }
    }
  }

  if (failed.includes("collector-crypt")) {
    throw new Error(`Collector Crypt history failed — history:by-ip left as stored${failed.length > 1 ? ` (also failed: ${failed.filter((k) => k !== "collector-crypt").join(", ")})` : ""}`);
  }

  // Per-IP 7d hourly history (history:by-ip) → IP pages get 7d vol + 24h change.
  const byIp: Record<string, HourBucket[]> = {};
  for (const [ipKey, ipSaleRows] of ipSales) byIp[ipKey] = bucketsFromSales(ipSaleRows, 168);
  if (dryRun) {
    const fmtPct = (p: number | null) => (p == null ? "—" : `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`);
    for (const [ipKey, b] of Object.entries(byIp).sort((x, y) => sumLast(y[1], 168).volumeUsd - sumLast(x[1], 168).volumeUsd).slice(0, 10)) {
      console.log(`   ${ipKey.padEnd(16)} 7d $${sumLast(b, 168).volumeUsd.toFixed(0).padStart(8)} · 24h $${sumLast(b, 24).volumeUsd.toFixed(0).padStart(7)} · 24h change ${fmtPct(pctChange(b, 24))}`);
    }
    console.log(`dry run: ${Object.keys(byIp).length} IPs bucketed, nothing written`);
    return { rowsWritten: 0 };
  }
  await writeIpHistory({ generatedAt: new Date().toISOString(), byIp });
  console.log(`→ per-IP history: ${Object.keys(byIp).length} IPs bucketed${failed.length ? ` (without ${failed.join(", ")})` : ""}`);

  return { rowsWritten: platforms };
}

// A dry run records nothing: runWarmer writes a freshness row on every outcome.
(dryRun ? main() : runWarmer("history", main)).catch((e) => {
  console.error(e);
  process.exit(1);
});
