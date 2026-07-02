/**
 * Compute real holder counts per IP per platform.
 *   • Beezie:    Rarible /ownerships/byCollection (paginated) + cached metadata
 *   • CC:        Helius DAS searchAssets (paginated, metadata + owner inline)
 *   • Phygitals: Helius DAS searchAssets over its two cNFT collections
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
import { readHolders, writeHolders, type HoldersIPEntry } from "../src/lib/data/holders";
import { readMetricSeries } from "../src/lib/data/metricSnapshots";
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

async function warmPhygitals(deadline: number): Promise<ScanResult> {
  const ph = PLATFORM_SOURCES.find((p) => p.key === "phygitals");
  if (!ph || ph.kind !== "helius") throw new Error("Phygitals source missing");
  const collections = [ph.collectionAddress, ...(ph.extraCollections ?? [])].filter(Boolean);
  if (collections.length === 0) throw new Error("Phygitals collections missing");

  console.log(`→ Phygitals DAS assets (${collections.length} cNFT collections)`);
  const byIp: PerIPMap = new Map();
  const totalOwners = new Set<string>();
  let tokens = 0;
  let complete = true;
  const t0 = Date.now();

  outer: for (const collection of collections) {
    let page = 1;
    while (true) {
      const r = await dasCall<DasGroupResponse>("searchAssets", {
        grouping: ["collection", collection],
        page,
        limit: 1000,
      });
      for (const asset of r.items) {
        tokens += 1;
        const owner = asset.ownership?.owner;
        if (!owner) continue;
        totalOwners.add(owner);
        // Same classification path as CC. Phygitals cNFT metadata may not always
        // carry category hints (rarity is null feed-wide), so some owners land in
        // "other" — the platform total stays exact; per-IP is best-effort v1.
        const meta = dasAssetToTokenMetadata(asset);
        const ip = classifyIP(extractCategoryHints(meta));
        recordOwner(byIp, ip.key, owner);
      }
      if (r.items.length < 1000) break;
      if (Date.now() > deadline) {
        complete = false;
        console.log(
          `  ⏱ Phygitals budget elapsed — writing partial (${tokens} tokens, ${totalOwners.size} owners)`,
        );
        break outer;
      }
      page += 1;
    }
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
  const [beezieR, ccR, phR] = await Promise.allSettled([
    guard(warmBeezie(deadline), "Beezie"),
    guard(warmCC(deadline), "CC"),
    guard(warmPhygitals(deadline), "Phygitals"),
  ]);
  const beezie = beezieR.status === "fulfilled" ? beezieR.value : empty;
  const cc = ccR.status === "fulfilled" ? ccR.value : empty;
  const ph = phR.status === "fulfilled" ? phR.value : empty;
  if (beezieR.status === "rejected")
    console.warn(`  Beezie holders FAILED: ${(beezieR.reason as Error).message}`);
  if (ccR.status === "rejected")
    console.warn(`  CC holders FAILED: ${(ccR.reason as Error).message}`);
  if (phR.status === "rejected")
    console.warn(`  Phygitals holders FAILED: ${(phR.reason as Error).message}`);
  if (
    beezieR.status === "rejected" &&
    ccR.status === "rejected" &&
    phR.status === "rejected"
  )
    throw new Error("holders: all sources failed");

  // ── Carry-forward: don't let a failed scan zero out a platform ──────────────
  // A Helius outage (quota/429) makes the CC & Phygitals scans return 0. Writing
  // that 0 regressed "Collector Crypt: 12,709 holders" → "0" — a false, alarming
  // drop. A scan is trustworthy only if it FULFILLED with a positive total; else we
  // carry the last-known-good total forward (freshness still flags it stale).
  //
  // Last-known-good comes from the metric SPINE (platform/holders history), which
  // survives even after the blob was already clobbered to 0 — the blob alone can't
  // self-heal. Platform total is then exact; per-IP counts come from the prev blob
  // (may be understated if the blob was clobbered) and self-correct on the next real
  // scan, so total ≈ union of fresh platforms + carried counts (cross-chain owners
  // don't overlap).
  const prev = await readHolders();
  const PLATS = [
    ["beezie", beezie],
    ["collector-crypt", cc],
    ["phygitals", ph],
  ] as const;
  const lastGood: Record<string, number> = {};
  for (const [key] of PLATS) {
    const spine = await readMetricSeries("platform", key, "holders").catch(() => []);
    let spineGood = 0;
    for (let i = spine.length - 1; i >= 0; i--) {
      if (spine[i].value > 0) { spineGood = spine[i].value; break; }
    }
    lastGood[key] = Math.max(prev?.platforms?.[key] ?? 0, spineGood);
  }
  const carried = new Set<string>();
  for (const [key, res] of PLATS) {
    const ok = res.total > 0; // empty(rejected) or soft-fail(0) → not ok
    if (!ok && lastGood[key] > 0) carried.add(key);
  }

  // Combine per-IP across platforms (fresh owner-sets for OK platforms; prev counts
  // for carried ones).
  const byIp: Record<string, HoldersIPEntry> = {};
  const ipKeys = new Set<string>();
  for (const [key, res] of PLATS) if (!carried.has(key)) for (const k of res.byIp.keys()) ipKeys.add(k);
  if (prev) for (const key of carried) for (const [ip, e] of Object.entries(prev.byIp)) {
    if ((e.perPlatform?.[key] ?? 0) > 0) ipKeys.add(ip);
  }
  for (const ip of ipKeys) {
    const perPlatform: Record<string, number> = {};
    const union = new Set<string>();
    let carriedSum = 0;
    for (const [key, res] of PLATS) {
      if (carried.has(key)) {
        const n = prev?.byIp[ip]?.perPlatform?.[key] ?? 0;
        perPlatform[key] = n;
        carriedSum += n;
      } else {
        const owners = res.byIp.get(ip) ?? new Set<string>();
        perPlatform[key] = owners.size;
        for (const o of owners) union.add(o);
      }
    }
    byIp[ip] = { total: union.size + carriedSum, perPlatform };
  }

  const platTotal = (key: "beezie" | "collector-crypt" | "phygitals", res: ScanResult) =>
    carried.has(key) ? lastGood[key] : res.total;
  const tag = (key: "beezie" | "collector-crypt" | "phygitals", res: ScanResult) =>
    carried.has(key) ? " (carried)" : res.total === 0 ? " (no data)" : res.complete ? "" : " (partial)";

  // True cross-platform holder count (X2). beezie is on Base (0x… addresses) so it
  // can't overlap the Solana platforms — it always adds separately. CC + Phygitals
  // are BOTH Solana (same base58 address space) and DO share wallets, so union their
  // owner sets instead of summing (a plain sum double-counts, the 1,074→41,318 bug).
  // When a Solana scan is carried (no owner set to union), reconstruct the previous
  // Solana union from the last snapshot rather than an inflated sum.
  const beezieN = platTotal("beezie", beezie);
  let solanaUnion: number;
  if (!carried.has("collector-crypt") && !carried.has("phygitals")) {
    const sol = new Set<string>();
    for (const s of cc.byIp.values()) for (const o of s) sol.add(o);
    for (const s of ph.byIp.values()) for (const o of s) sol.add(o);
    solanaUnion = sol.size;
  } else if (prev?.totalHolders != null) {
    solanaUnion = Math.max(0, prev.totalHolders - (prev.platforms?.beezie ?? 0));
  } else {
    solanaUnion = platTotal("collector-crypt", cc) + platTotal("phygitals", ph);
  }
  const totalHolders = beezieN + solanaUnion;

  await writeHolders({
    generatedAt: new Date().toISOString(),
    platforms: {
      beezie: beezieN,
      "collector-crypt": platTotal("collector-crypt", cc),
      phygitals: platTotal("phygitals", ph),
    },
    byIp,
    totalHolders,
  });
  console.log(
    `\nWrote holders snapshot in ${((Date.now() - t0) / 1000).toFixed(0)}s · ` +
      `${Object.keys(byIp).length} IPs · ` +
      `beezie=${platTotal("beezie", beezie)}${tag("beezie", beezie)} ` +
      `cc=${platTotal("collector-crypt", cc)}${tag("collector-crypt", cc)} ` +
      `phygitals=${platTotal("phygitals", ph)}${tag("phygitals", ph)} ` +
      `· unique=${totalHolders} (sum ${beezieN + platTotal("collector-crypt", cc) + platTotal("phygitals", ph)})`,
  );
  if (carried.size) console.log(`  carried-forward (scan failed): ${[...carried].join(", ")}`);
  return { rowsWritten: Object.keys(byIp).length };
}

runWarmer("holders", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
