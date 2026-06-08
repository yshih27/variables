/**
 * Compute real holder counts per IP per platform.
 *   • Beezie:    Rarible /ownerships/byCollection (paginated) + cached metadata
 *   • CC:        Helius DAS searchAssets (paginated, metadata + owner inline)
 *   • Courtyard: skipped (no metadata cache + ~millions of tokens — separate effort)
 *
 * Output: .cache/holders.json (see src/lib/data/holders.ts for shape).
 *
 *   npx tsx scripts/warm-holders.ts
 *
 * Run daily.
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
import { dasAssetToTokenMetadata, writeCCMetadata } from "../src/lib/data/ccTraits";
import { runWarmer } from "../src/lib/db/runWarmer";

type PerIPMap = Map<string, Set<string>>; // ipKey → ownerSet

function recordOwner(map: PerIPMap, ipKey: string, owner: string) {
  let s = map.get(ipKey);
  if (!s) {
    s = new Set();
    map.set(ipKey, s);
  }
  s.add(owner);
}

async function warmBeezie(): Promise<{ total: number; byIp: PerIPMap }> {
  const beezie = PLATFORM_SOURCES.find((p) => p.key === "beezie");
  if (!beezie || beezie.kind !== "rarible") throw new Error("Beezie source missing");

  console.log(`→ Beezie ownerships (${beezie.collectionId})`);
  const byIp: PerIPMap = new Map();
  const totalOwners = new Set<string>();
  let continuation: string | undefined;
  let pages = 0;
  let tokens = 0;
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
    continuation = r.continuation;
  }
  console.log(
    `  done. ${tokens} tokens · ${totalOwners.size} unique owners · ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
  return { total: totalOwners.size, byIp };
}

async function warmCC(): Promise<{ total: number; byIp: PerIPMap }> {
  const cc = PLATFORM_SOURCES.find((p) => p.key === "collector-crypt");
  if (!cc || cc.kind !== "helius") throw new Error("CC source missing");

  console.log(`→ Collector Crypt DAS assets (${cc.collectionAddress})`);
  const byIp: PerIPMap = new Map();
  const totalOwners = new Set<string>();
  let page = 1;
  let tokens = 0;
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
      const meta = dasAssetToTokenMetadata(asset);
      // Opportunistic cache refresh (cheap — we already have the data)
      await writeCCMetadata(asset.id, meta);
      const ip = classifyIP(extractCategoryHints(meta));
      recordOwner(byIp, ip.key, owner);
    }
    if (page % 10 === 0) {
      console.log(
        `  page ${page}: ${tokens} tokens, ${totalOwners.size} owners (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
      );
    }
    if (r.items.length < 1000) break;
    page += 1;
  }
  console.log(
    `  done. ${tokens} tokens · ${totalOwners.size} unique owners · ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
  return { total: totalOwners.size, byIp };
}

async function main() {
  const t0 = Date.now();
  const [beezie, cc] = await Promise.all([warmBeezie(), warmCC()]);

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
      `beezie=${beezie.total} cc=${cc.total}`,
  );
  return { rowsWritten: Object.keys(byIp).length };
}

runWarmer("holders", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
