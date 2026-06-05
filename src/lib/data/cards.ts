/**
 * `cards` table helpers — the atomic-unit store that replaces the 122K+ trait
 * JSON files under .cache/cc-traits + .cache/beezie-traits. See MIGRATION_PLAN §3.1.
 *
 * Readers (ccTraits / beezieTraits) reconstruct a TokenMetadata from a row. The
 * derived columns (ip_key, card_name, grade, set_name, insured_value_usd, …) are
 * computed once at write time so they're queryable in SQL — for /search, the
 * top-cards lists, and the Phase-3 precompute. Nothing reads disk anymore.
 */
import { db } from "../db/client";
import type { TokenMetadata } from "../onchain/tokenUri";
import { normalizeTraits, gradeLabel } from "./traits";
import { classifyIP } from "./ipCatalog";

export type CardPlatform = "collector-crypt" | "beezie" | "phygitals" | "courtyard";

const CHAIN_BY_PLATFORM: Record<CardPlatform, string> = {
  "collector-crypt": "Solana",
  beezie: "Base",
  phygitals: "Solana",
  courtyard: "Polygon",
};
const CODE_BY_PLATFORM: Record<CardPlatform, string> = {
  "collector-crypt": "cc",
  beezie: "bz",
  phygitals: "pg",
  courtyard: "cy",
};
const SOURCE_BY_PLATFORM: Record<CardPlatform, string> = {
  "collector-crypt": "helius-das",
  beezie: "beezie-tokenuri",
  phygitals: "helius-das",
  courtyard: "rarible",
};

export type CardRow = {
  id: string;
  platform: string;
  token_id: string;
  chain: string;
  name: string | null;
  card_name: string | null;
  ip_key: string;
  set_name: string | null;
  grade: string | null;
  grade_label: string;
  category: string | null;
  image: string | null;
  image_fallback: string | null;
  insured_value_usd: number | null;
  attributes: TokenMetadata["attributes"] | null;
  source: string;
};

/** Build a cards-table row (raw + derived columns) from token metadata. */
export function cardRowFromMeta(
  platform: CardPlatform,
  tokenId: string,
  meta: TokenMetadata,
): CardRow {
  const t = normalizeTraits(meta);
  const hints = [
    meta.name,
    ...(meta.attributes ?? []).map((a) => (a.value == null ? "" : String(a.value))),
  ].filter((v): v is string => Boolean(v));
  const ip = classifyIP(hints);
  return {
    id: `${CODE_BY_PLATFORM[platform]}-${tokenId}`,
    platform,
    token_id: tokenId,
    chain: CHAIN_BY_PLATFORM[platform],
    name: meta.name ?? null,
    card_name: t.cardName,
    ip_key: ip.key,
    set_name: t.set,
    grade: t.gradeRaw,
    grade_label: gradeLabel(t),
    category: t.category,
    image: meta.image ?? null,
    image_fallback: meta.imageFallback ?? null,
    insured_value_usd: t.insuredValueUsd,
    attributes: meta.attributes ?? null,
    source: SOURCE_BY_PLATFORM[platform],
  };
}

/** Reconstruct the TokenMetadata a consumer expects from a stored row. */
function metaFromRow(row: {
  name: string | null;
  image: string | null;
  image_fallback: string | null;
  attributes: unknown;
}): TokenMetadata {
  return {
    name: row.name ?? undefined,
    image: row.image ?? undefined,
    imageFallback: row.image_fallback ?? undefined,
    attributes: (row.attributes as TokenMetadata["attributes"]) ?? undefined,
  };
}

/** Upsert card rows in chunks (PK = id). */
export async function upsertCards(rows: CardRow[]): Promise<void> {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db().from("cards").upsert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(`[cards] upsert failed: ${error.message}`);
  }
}

/** Read metadata for many tokenIds of one platform (cache-only). */
export async function readCards(
  platform: CardPlatform,
  tokenIds: string[],
): Promise<Map<string, TokenMetadata>> {
  const out = new Map<string, TokenMetadata>();
  const ids = [...new Set(tokenIds)].filter(Boolean);
  if (ids.length === 0) return out;
  const CHUNK = 300; // keep the IN(...) list / URL length reasonable
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await db()
      .from("cards")
      .select("token_id,name,image,image_fallback,attributes")
      .eq("platform", platform)
      .in("token_id", slice);
    if (error) {
      console.warn(`[cards] read failed: ${error.message}`);
      continue;
    }
    for (const row of data ?? []) out.set(row.token_id as string, metaFromRow(row));
  }
  return out;
}
