/**
 * Seed the dimension tables (platforms, categories) from the typed code config
 * (sources.ts / ipCatalog.ts). Code stays the source of truth; the DB gets the
 * rows so SQL can join/sort/display. Idempotent (upsert).
 *
 *   npx tsx scripts/seed-dimensions.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../src/lib/db/client";
import { PLATFORM_SOURCES, type PlatformSource } from "../src/lib/data/sources";
import { IP_CATALOG, OTHER_IP } from "../src/lib/data/ipCatalog";

// Phygitals collection mints discovered from api.phygitals.com (sources.ts has them empty).
const PHYGITALS_COLLECTIONS = [
  "BSG6DyEihFFtfvxtL9mKYsvTwiZXB1rq5gARMTJC2xAM",
  "phygZDQZJZVHvJGYPGoKPYUtXw7mstSYtTtcuh8LJcC",
];
const GACHA_PLATFORMS = new Set(["collector-crypt", "beezie", "phygitals"]);

function collectionsFor(s: PlatformSource): string[] {
  if (s.kind === "rarible") {
    const id = s.collectionId;
    return [id.includes(":") ? id.split(":")[1] : id];
  }
  if (s.key === "phygitals") return PHYGITALS_COLLECTIONS;
  return s.collectionAddress ? [s.collectionAddress] : [];
}

const platformRows = PLATFORM_SOURCES.map((s) => ({
  platform_id: s.key,
  name: s.name,
  chain: s.chain,
  vault_provider: s.vault,
  native_currency: s.primary?.currencyAddress ?? null,
  has_marketplace: true,
  has_gacha: GACHA_PLATFORMS.has(s.key),
  collections: collectionsFor(s),
  config: {
    short: s.short,
    marketplace:
      (s as { marketplace?: string }).marketplace ??
      (s as { marketplaceProgram?: string }).marketplaceProgram ??
      null,
    primaryReceivers: s.primary?.receivers ?? [],
    validAmounts: s.primary?.validAmounts ?? [],
    kind: s.kind,
  },
  status: "active",
}));

function kindOf(key: string): string {
  if (["basketball", "baseball", "football", "soccer", "hockey", "f1"].includes(key)) return "sport";
  if (key === "wax") return "sealed";
  if (["sneakers", "comics", "veefriends", "other"].includes(key)) return "other";
  return "tcg";
}

const categoryRows = [...IP_CATALOG, OTHER_IP].map((ip) => ({
  category_id: ip.key,
  name: ip.name,
  short: ip.short,
  kind: kindOf(ip.key),
  color: ip.color,
  logo: ip.logo ?? null,
  display: {
    emoji: ip.emoji ?? null,
    iconBlendMode: ip.iconBlendMode ?? null,
    patterns: ip.patterns,
  },
}));

(async () => {
  const p = await db().from("platforms").upsert(platformRows);
  if (p.error) throw new Error(`platforms: ${p.error.message}`);
  const c = await db().from("categories").upsert(categoryRows);
  if (c.error) throw new Error(`categories: ${c.error.message}`);
  console.log(`Seeded ${platformRows.length} platforms, ${categoryRows.length} categories.`);
  console.log("platforms:", platformRows.map((r) => `${r.platform_id}(gacha=${r.has_gacha})`).join(", "));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
