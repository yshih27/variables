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

const UPSERT_CHUNK = 500;
const UPSERT_FLOOR = 25;

/** A big JSONB `attributes` payload can blow PostgREST's statement_timeout on a large
 *  batch — the recurring cc-traits (~131K rows) red. Retry only those. */
function isUpsertRetryable(error: { message?: string; code?: string }): boolean {
  const m = (error.message ?? "").toLowerCase();
  return (
    error.code === "57014" || // query_canceled (statement_timeout)
    m.includes("timeout") ||
    m.includes("canceling statement") ||
    m.includes("too large") ||
    m.includes("payload")
  );
}

/**
 * Upsert card rows (PK = id) with ADAPTIVE chunking: start at 500, and when a batch
 * times out / is too large, HALVE the chunk and retry just that batch — recursively —
 * down to a floor of 25. So a heavy `attributes` payload self-tunes under the timeout
 * instead of failing the whole cc-traits crawl. A non-retryable error (or a failure at
 * the floor) throws.
 */
export async function upsertCards(rows: CardRow[], chunk: number = UPSERT_CHUNK): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    const batch = rows.slice(i, i + chunk);
    const { error } = await db().from("cards").upsert(batch);
    if (!error) continue;
    if (isUpsertRetryable(error) && chunk > UPSERT_FLOOR) {
      const half = Math.max(UPSERT_FLOOR, Math.floor(chunk / 2));
      console.warn(`[cards] upsert ${chunk}-batch timed out → retrying at ${half} (${error.message.slice(0, 60)})`);
      await upsertCards(batch, half);
      continue;
    }
    throw new Error(`[cards] upsert failed (chunk ${chunk}): ${error.message}`);
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

export type CardValuation = { tokenId: string; ipKey: string; insuredValueUsd: number | null };
export type CardDims = { ip: string; set: string | null; grade: string };

// ── Full-table cards streaming (the shared path warm-marketcap / warm-metric-
//    snapshots / warm-sale-panel use to aggregate over EVERY card) ──
//
// ⚠️ These MUST NOT filter by platform in SQL. `id` is platform-PREFIXED
// (bz-/cc-/cy-/pg-), and there's no (platform,id) composite index — only a PK on
// `id` and a single-column index on `platform`. So a per-platform keyset query
// `WHERE platform=X AND id > lastId ORDER BY id LIMIT N` can't be index-served:
// for a lexicographically-LATE platform (phygitals `pg-*`) Postgres walks the id
// PK index and filter-scans through all ~131K `cc-*` rows to reach the first
// `pg-*` row — a single page then blows the statement_timeout (measured 8.4s ✗).
// It also made collector-crypt's full read ~96s of slow filtered pages.
//
// Instead we scan the WHOLE table by pure PK keyset (`id > lastId ORDER BY id
// LIMIT N`) — a clean O(PAGE) index range scan with no platform predicate to
// force a filter-scan or sort — and partition by platform in JS. One pass covers
// all platforms; memoized per-process (short TTL) so a warmer's cc + beezie calls
// share the single scan. Columns stay narrow (only what each aggregation needs).
const PAGE = 1000;
const MEMO_TTL_MS = 5 * 60 * 1000;
let valMemo: { at: number; map: Map<string, CardValuation[]> } | null = null;
let dimMemo: { at: number; map: Map<string, Map<string, CardDims>> } | null = null;

/** Valuation columns for EVERY card, partitioned by platform, in one full-table
 *  PK-keyset pass (see the note above on why there's no platform filter). */
export async function readAllCardValuations(): Promise<Map<string, CardValuation[]>> {
  if (valMemo && Date.now() - valMemo.at < MEMO_TTL_MS) return valMemo.map;
  const map = new Map<string, CardValuation[]>();
  let lastId: string | null = null;
  for (;;) {
    let q = db()
      .from("cards")
      .select("id,platform,token_id,ip_key,insured_value_usd")
      .order("id", { ascending: true })
      .limit(PAGE);
    if (lastId !== null) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) throw new Error(`[cards] valuation read failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      const p = r.platform as string;
      let arr = map.get(p);
      if (!arr) map.set(p, (arr = []));
      arr.push({
        tokenId: r.token_id as string,
        ipKey: (r.ip_key as string) ?? "other",
        insuredValueUsd: (r.insured_value_usd as number | null) ?? null,
      });
    }
    if (rows.length < PAGE) break;
    lastId = rows[rows.length - 1].id as string;
  }
  valMemo = { at: Date.now(), map };
  return map;
}

/** Per-card classification dims (ip / set / grade) for EVERY card, partitioned by
 *  platform → tokenId, in one full-table PK-keyset pass. */
export async function readAllCardDims(): Promise<Map<string, Map<string, CardDims>>> {
  if (dimMemo && Date.now() - dimMemo.at < MEMO_TTL_MS) return dimMemo.map;
  const map = new Map<string, Map<string, CardDims>>();
  let lastId: string | null = null;
  for (;;) {
    let q = db()
      .from("cards")
      .select("id,platform,token_id,ip_key,set_name,grade_label")
      .order("id", { ascending: true })
      .limit(PAGE);
    if (lastId !== null) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) throw new Error(`[cards] dims read failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      const p = r.platform as string;
      let m = map.get(p);
      if (!m) map.set(p, (m = new Map<string, CardDims>()));
      m.set(r.token_id as string, {
        ip: (r.ip_key as string) ?? "other",
        set: (r.set_name as string | null) ?? null,
        grade: (r.grade_label as string) ?? "Ungraded",
      });
    }
    if (rows.length < PAGE) break;
    lastId = rows[rows.length - 1].id as string;
  }
  dimMemo = { at: Date.now(), map };
  return map;
}

/** One platform's valuation rows (from the shared full-table scan). Used by
 *  warm-marketcap — `ip_key` + `insured_value_usd` are precomputed, so per-IP
 *  market cap is a pure aggregation with no disk reads / re-classification. */
export async function readCardValuations(platform: CardPlatform): Promise<CardValuation[]> {
  return (await readAllCardValuations()).get(platform) ?? [];
}

/** One platform's classification dims (from the shared full-table scan). Lets the
 *  metric-snapshots / sale-panel warmers classify each sale into set/grade/IP for
 *  daily dominance without per-sale metadata reconstruction. */
export async function readCardDims(platform: CardPlatform): Promise<Map<string, CardDims>> {
  return (await readAllCardDims()).get(platform) ?? new Map<string, CardDims>();
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
