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

export type CardSearchHit = {
  platform: string;
  token_id: string;
  name: string;
  ip_key: string;
  set_name: string | null;
  grade_label: string | null;
  insured_value_usd: number | null;
};

/** Escape LIKE/ILIKE wildcards so user input matches literally (a `%` typed by the
 *  user shouldn't become "match anything"). */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Card-name search across the FULL cards table (~137K rows) via `name ILIKE`, so
 * "charizard" returns the notable Charizards instead of the single last-24h sale
 * the homepage payload carried (QA-3). Ranked by insured value (most valuable match
 * first) and de-duplicated by name. Returns [] for queries under 2 chars.
 *
 * A full-table `ILIKE '%q%'` is a sequential scan — fine at this size (tens of ms);
 * add a `pg_trgm` GIN index on `lower(name)` if card search ever gets hot.
 */
export async function searchCardsByName(query: string, limit = 12): Promise<CardSearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await db()
    .from("cards")
    .select("platform,token_id,name,ip_key,set_name,grade_label,insured_value_usd")
    .ilike("name", `%${escapeLike(q)}%`)
    .order("insured_value_usd", { ascending: false, nullsFirst: false })
    .limit(limit * 6); // over-fetch so de-duping by name still fills `limit`
  if (error) {
    console.warn(`[cards] searchCardsByName("${q}") failed: ${error.message}`);
    return [];
  }
  const seen = new Set<string>();
  const out: CardSearchHit[] = [];
  for (const r of data ?? []) {
    const name = (r.name as string | null)?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      platform: r.platform as string,
      token_id: r.token_id as string,
      name,
      ip_key: r.ip_key as string,
      set_name: (r.set_name as string | null) ?? null,
      grade_label: (r.grade_label as string | null) ?? null,
      insured_value_usd: (r.insured_value_usd as number | null) ?? null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Stream the minimal valuation columns for EVERY card of a platform (paged).
 * Used by warm-marketcap — `ip_key` + `insured_value_usd` are precomputed at
 * write time, so per-IP market cap is a pure aggregation with no disk reads and
 * no re-classification.
 */
export async function readCardValuations(
  platform: CardPlatform,
): Promise<Array<{ tokenId: string; ipKey: string; insuredValueUsd: number | null }>> {
  const out: Array<{ tokenId: string; ipKey: string; insuredValueUsd: number | null }> = [];
  const PAGE = 1000;
  // Keyset pagination on the primary key (id). OFFSET pagination over 122K rows
  // hits the Postgres statement_timeout at high offsets; an id-range scan stays
  // O(PAGE) per page and uses the PK index.
  let lastId: string | null = null;
  for (;;) {
    let q = db()
      .from("cards")
      .select("id,token_id,ip_key,insured_value_usd")
      .eq("platform", platform)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (lastId !== null) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) throw new Error(`[cards] valuation read failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      out.push({
        tokenId: r.token_id as string,
        ipKey: (r.ip_key as string) ?? "other",
        insuredValueUsd: (r.insured_value_usd as number | null) ?? null,
      });
    }
    if (rows.length < PAGE) break;
    lastId = rows[rows.length - 1].id as string;
  }
  return out;
}

/**
 * Stream per-card classification dims (ip / set / grade) for EVERY card of a
 * platform — precomputed columns, keyset-paged like readCardValuations. Lets the
 * metric-snapshots warmer classify each sale into set/grade/IP for daily
 * dominance without per-sale metadata reconstruction.
 */
export async function readCardDims(
  platform: CardPlatform,
): Promise<Map<string, { ip: string; set: string | null; grade: string }>> {
  const out = new Map<string, { ip: string; set: string | null; grade: string }>();
  const PAGE = 1000;
  let lastId: string | null = null;
  for (;;) {
    let q = db()
      .from("cards")
      .select("id,token_id,ip_key,set_name,grade_label")
      .eq("platform", platform)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (lastId !== null) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) throw new Error(`[cards] dims read failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      out.set(r.token_id as string, {
        ip: (r.ip_key as string) ?? "other",
        set: (r.set_name as string | null) ?? null,
        grade: (r.grade_label as string) ?? "Ungraded",
      });
    }
    if (rows.length < PAGE) break;
    lastId = rows[rows.length - 1].id as string;
  }
  return out;
}

export type CardMeta = {
  name: string | null;
  cardName: string | null;
  ip: string;
  set: string | null;
  grade: string;
  image: string | null;
};

/**
 * Read display+grouping metadata for many tokenIds of one platform in one pass
 * (name / ip / set / grade / image). Used by trending (fetchTrending) to group
 * sales by card-TYPE and to attribute listings to types — cheaper than merging
 * readCards + readCardDims. Chunked IN() so a big tokenId list stays under URL limits.
 */
export async function readCardMeta(
  platform: CardPlatform,
  tokenIds: string[],
): Promise<Map<string, CardMeta>> {
  const out = new Map<string, CardMeta>();
  const ids = [...new Set(tokenIds)].filter(Boolean);
  const CHUNK = 300;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db()
      .from("cards")
      .select("token_id,name,card_name,ip_key,set_name,grade_label,image")
      .eq("platform", platform)
      .in("token_id", ids.slice(i, i + CHUNK));
    if (error) {
      console.warn(`[cards] meta read failed: ${error.message}`);
      continue;
    }
    for (const r of data ?? []) {
      out.set(r.token_id as string, {
        name: (r.name as string | null) ?? null,
        cardName: (r.card_name as string | null) ?? null,
        ip: (r.ip_key as string) ?? "other",
        set: (r.set_name as string | null) ?? null,
        grade: (r.grade_label as string) ?? "Ungraded",
        image: (r.image as string | null) ?? null,
      });
    }
  }
  return out;
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
