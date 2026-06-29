/**
 * Compute real holder counts per IP per platform.
 *   • Beezie:    Rarible /ownerships/byCollection (paginated) + cached metadata
 *   • CC:        Helius DAS searchAssets (paginated, metadata + owner inline)
 *   • Courtyard: skipped (no metadata cache + ~millions of tokens — separate effort)
 *
 * Writes the `holders` Postgres snapshot (see src/lib/data/holders.ts for shape).
 *
 *   npx tsx scripts/warm-holders.ts
 *
 * Run daily.
 *
 * RESILIENCE: the snapshot is written once, after both scans settle. A slow /
 * rate-limited scan (Beezie's Rarible ownerships can crawl 20+ min) used to block
 * the write entirely → the daily job hit the 45-min Actions timeout, was cancelled,
 * and wrote NOTHING every run (why holders stayed stale and CC showed 0). Each scan
 * is now BOUNDED by SCAN_BUDGET_MS: it returns whatever it collected when the budget
 * elapses (flagged partial), so the write always happens. Scans run in parallel +
 * have a hard backstop, so total runtime can't exceed ~budget+1min.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import {
  getBeezieMetadataCachedOnly,
  extractCategoryHints,
} from "../src/lib/data/beezieTraits";
import { classifyIP } from "../src/lib/data/ipCatalog";
import { writeHolders, type HoldersIPEntry } from "../src/lib/data/holders";
import { raribleGet } from "../src/lib/rarible/client";
import type { RaribleOwnershipsResponse } from "../src/lib/rarible/types";
import { dasCall } from "../src/lib/helius/client";
import type { DasGroupResponse } from "../src/lib/helius/client";
import { PLATFORM_SOURCES } from "../src/lib/data/sources";
import { dasAssetToTokenMetadata } from "../src/lib/data/ccTraits";
import { runWarmer } from "../src/lib/db/runWarmer";

const SCAN_BUDGET_MS = 10 * 60 * 1000; // per-scan; parallel → total ≤ budget

type ScanResult = { total: number; byIp: PerIPMap; complete: boolean };
type PerIPMap = Map<string, Set<string>>; // ipKey → ownerSet

function recordOwner(map: PerIPMap, ipKey: string, owner: string) {
  let s = map.get(ipKey);
  if (!s) {
    s = new Set();
    map.set(ipKey, s);
  }
  s.add(owner);
}

/** Race a scan against a hard backstop so a single hung request can't block the write. */
function guard(p: Promise<ScanResult>, label: string): Promise<ScanResult> {
  let timer: ReturnType<typeof setTimeout>;
  const backstop = new Promise<ScanResult>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`  ⏱ ${label} hard-timeout backstop — skipping`);
      resolve({ total: 0, byIp: new Map(), complete: false });
    }, SCAN_BUDGET_MS + 60_000);
  });
  // clearTimeout when the scan wins, so the process exits promptly + no orphan log.
  return Promise.race([p, backstop]).finally(() => clearTimeout(timer));
}

async function warmBeezie(deadline: number): Promise<ScanResult> {
  const beezie = PLATFORM_SOURCES.find((p) => p.key === "beezie");
  if (!beezie || beezie.kind !== "rarible") throw new Error("Beezie source missing");

  console.log(`→ Beezie ownerships (${beezie.collectionId})`);
  const byIp: PerIPMap = new Map();
  const totalOwners = new Set<string>();
  let continuation: string | undefined;
  let pages = 0;
  let tokens = 0;
  let complete = true;
  const t0 = Date.now();

  while (true) {
    const r = await raribleGet<RaribleOwnershipsResponse>("/ownerships/byCollection", {
      collection: beezie.collectionId,
      continuation,
      size: 1000,
    });
    const tokenIds = r.ownerships.map((o) => o.tokenId);
    const metas = await getBeezieMetadataCachedOnly(tokenIds);

    for (const o of r.ownerships) {
      tokens += 1;
      totalOwners.add(o.owner);
      const meta = metas.get(o.tokenId);
      const ip = meta ? classifyIP(extractCategoryHints(meta)) : classifyIP(["other"]);
      recordOwner(byIp, ip.key, o.owner);
    }
    pages += 1;
    if (pages % 5 === 0) {
      console.log(
        `  page ${pages}: ${tokens} tokens, ${totalOwners.size} owners (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
      );
    }
    if (!r.continuation || r.ownerships.length === 0) break;
    if (Date.now() > deadline) {
      complete = false;
      console.log(`  ⏱ Beezie budget elapsed — writing partial (${tokens} tokens, ${totalOwners.size} owners)`);
      break;
    }
    continuation = r.continuation;
  }
  console.log(
    `  done. ${tokens} tokens · ${totalOwners.size} unique owners · ${((Date.now() - t0) / 1000).toFixed(0)}s${complete ? "" : " (PARTIAL)"}`,
  );
  return { total: totalOwners.size, byIp, complete };
}

async function warmCC(deadline: number): Promise<ScanResult> {
  const cc = PLATFORM_SOURCES.find((p) => p.key === "collector-crypt");
  if (!cc || cc.kind !== "helius") throw new Error("CC source missing");

  console.log(`→ Collector Crypt DAS assets (${cc.collectionAddress})`);
  const byIp: PerIPMap = new Map();
  const totalOwners = new Set<string>();
  let page = 1;
  let tokens = 0;
  let complete = true;
  const t0 = Date.now();

  while (true) {
    const r = await dasCall<DasGroupResponse>("searchAssets", {
      grouping: ["collection", cc.collectionAddress],
      page,
      limit: 1000,
    });
    for (const asset of r.items) {
      tokens += 1;
      const owner = asset.ownership?.owner;
      if (!owner) continue;
      totalOwners.add(owner);
      // Holder counting only needs the IP classification — NOT a per-asset DB
      // write. (The old opportunistic writeCCMetadata here did ~1000 sequential
      // upserts PER PAGE, ~122s/page, which is what made CC blow the budget.
      // CC metadata is maintained by warm-cc-traits.)
      const meta = dasAssetToTokenMetadata(asset);
      const ip = classifyIP(extractCategoryHints(meta));
      recordOwner(byIp, ip.key, owner);
    }
    if (page % 10 === 0) {
      console.log(
        `  page ${page}: ${tokens} tokens, ${totalOwners.size} owners (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
      );
    }
    if (r.items.length < 1000) break;
    if (Date.now() > deadline) {
      complete = false;
      console.log(`  ⏱ CC budget elapsed — writing partial (${tokens} tokens, ${totalOwners.size} owners)`);
      break;
    }
    page += 1;
  }
  console.log(
    `  done. ${tokens} tokens · ${totalOwners.size} unique owners · ${((Date.now() - t0) / 1000).toFixed(0)}s${complete ? "" : " (PARTIAL)"}`,
  );
  return { total: totalOwners.size, byIp, complete };
}

async function main() {
  const t0 = Date.now();
  // Resilient: a hang/failure in one source must not sink the other or leave the
  // snapshot unwritten. Each scan is budget-bounded + backstopped; we write whatever
  // we got. Only fail (so runWarmer records an error) when BOTH sources fail outright.
  const empty: ScanResult = { total: 0, byIp: new Map(), complete: false };
  const deadline = Date.now() + SCAN_BUDGET_MS;
  const [beezieR, ccR] = await Promise.allSettled([
    guard(warmBeezie(deadline), "Beezie"),
    guard(warmCC(deadline), "CC"),
  ]);
  const beezie = beezieR.status === "fulfilled" ? beezieR.value : empty;
  const cc = ccR.status === "fulfilled" ? ccR.value : empty;
  if (beezieR.status === "rejected")
    console.warn(`  Beezie holders FAILED: ${(beezieR.reason as Error).message}`);
  if (ccR.status === "rejected")
    console.warn(`  CC holders FAILED: ${(ccR.reason as Error).message}`);
  if (beezieR.status === "rejected" && ccR.status === "rejected")
    throw new Error("holders: both Beezie and CC sources failed");

  // Combine per-IP across platforms
  const byIp: Record<string, HoldersIPEntry> = {};
  const allKeys = new Set([...beezie.byIp.keys(), ...cc.byIp.keys()]);
  for (const key of allKeys) {
    const beezieOwners = beezie.byIp.get(key) ?? new Set<string>();
    const ccOwners = cc.byIp.get(key) ?? new Set<string>();
    const union = new Set([...beezieOwners, ...ccOwners]);
    byIp[key] = {
      total: union.size,
      perPlatform: {
        beezie: beezieOwners.size,
        "collector-crypt": ccOwners.size,
      },
    };
  }

  await writeHolders({
    generatedAt: new Date().toISOString(),
    platforms: {
      beezie: beezie.total,
      "collector-crypt": cc.total,
    },
    byIp,
  });
  console.log(
    `\nWrote holders snapshot in ${((Date.now() - t0) / 1000).toFixed(0)}s · ` +
      `${Object.keys(byIp).length} IPs · ` +
      `beezie=${beezie.total}${beezie.complete ? "" : " (partial)"} ` +
      `cc=${cc.total}${cc.complete ? "" : " (partial)"}`,
  );
  return { rowsWritten: Object.keys(byIp).length };
}

runWarmer("holders", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
