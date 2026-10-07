/**
 * The platform page's table rules, pure — so the tests drive them without the
 * cached fetcher (fetchPlatform.ts) or a database.
 */
import { extractCategoryHints } from "./beezieTraits";
import { classifyIP, IP_CATALOG, OTHER_IP, type IPMeta } from "./ipCatalog";
import { SALES_TABLE_MIN } from "./coreVolumeCache";
import type { TokenMetadata } from "@/lib/onchain/tokenUri";

/** IP metadata by key — composition rows and stored keys carry only the key. */
export function ipMetaByKey(key: string): IPMeta {
  if (key === OTHER_IP.key) return OTHER_IP;
  return IP_CATALOG.find((i) => i.key === key) ?? OTHER_IP;
}

/**
 * A sale's IP: the stored key where the venue's `cards` row carries one set from
 * a feed field (Renaiss: the catalog image's game), else the keyword classifier
 * over its metadata. ⚠️ Not keywords first for Renaiss: they match inside words
 * and read "Sunflora" as football (the "nfl" in its name).
 */
export function ipOfSale(s: { meta: TokenMetadata; ipKey?: string }): IPMeta {
  return s.ipKey ? ipMetaByKey(s.ipKey) : classifyIP(extractCategoryHints(s.meta));
}

/**
 * Which window the tables read: the 24h, or the trailing 7 days when the 24h
 * holds fewer than SALES_TABLE_MIN sales and the week holds any. Never an empty
 * table while the week has sales.
 */
export function chooseSalesWindow<S>(sales24h: S[], sales7d: S[] | undefined): { window: "24h" | "7d"; sales: S[] } {
  if (sales24h.length < SALES_TABLE_MIN && sales7d && sales7d.length > 0) return { window: "7d", sales: sales7d };
  return { window: "24h", sales: sales24h };
}

/**
 * Why a venue has no holder count, from what the holders snapshot holds. The
 * venues warm-holders scans write an entry (an explicit 0 included); for the
 * rest the reason is which scan they lack.
 */
export function holdersReasonFor(key: string, platforms: Record<string, number> | null | undefined): string | null {
  if (platforms && key in platforms) return null;
  if (key === "renaiss") return "no holders run has counted Renaiss yet (counted on-chain on BNB Chain from its first run)";
  if (key === "courtyard") return "Courtyard's Polygon collection has no holder scan";
  if (key === "dyli") return "DYLI settles on Abstract and has no holder scan";
  return "no holder scan for this venue";
}
