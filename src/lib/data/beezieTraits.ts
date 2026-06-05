/**
 * Beezie trait reader — backed by the Postgres `cards` table (migrated from
 * .cache/beezie-traits/*). getBeezieMetadata falls back to a live tokenURI read
 * for a tokenId not yet in the table and persists it.
 */
import { getTokenMetadata, type TokenMetadata } from "@/lib/onchain/tokenUri";
import { readCards, upsertCards, cardRowFromMeta } from "./cards";

const BEEZIE_CONTRACT = "0xbb5ec6fd4b61723bd45c399840f1d868840ca16f";

/**
 * Beezie's on-chain metadata stores image URLs as `…/0/original-N.jpg`
 * (resolution variants). Those variant paths return HTTP 403 from the CDN —
 * only the base `…/0/original.jpg` serves (200). Normalize so every consumer
 * gets a working URL. Idempotent.
 */
export function fixBeezieImage(meta: TokenMetadata): TokenMetadata {
  if (typeof meta.image === "string" && meta.image.includes("images.beezie.com")) {
    const fixed = meta.image.replace(
      /\/original-\d+\.(jpe?g|png|webp|avif)(\?|$)/i,
      "/original.$1$2",
    );
    if (fixed !== meta.image) return { ...meta, image: fixed };
  }
  return meta;
}

/**
 * Fetch metadata for a Beezie tokenId. Cache-first (Postgres); on a miss,
 * read tokenURI on-chain and persist. Beezie metadata is immutable per token.
 */
export async function getBeezieMetadata(tokenId: string): Promise<TokenMetadata | null> {
  const hit = (await readCards("beezie", [tokenId])).get(tokenId);
  if (hit) return fixBeezieImage(hit);
  const fresh = await getTokenMetadata("base", BEEZIE_CONTRACT, tokenId);
  if (fresh) {
    await writeBeezieMetadata(tokenId, fresh);
    return fixBeezieImage(fresh);
  }
  return null;
}

/**
 * Resolve metadata for many tokenIds with bounded parallelism (warmer path).
 * Low concurrency by default to stay under Beezie's CF rate limit on misses.
 */
export async function getBeezieMetadataBatch(
  tokenIds: string[],
  concurrency = 2,
  perRequestDelayMs = 100,
): Promise<Map<string, TokenMetadata>> {
  const result = new Map<string, TokenMetadata>();
  const queue = [...new Set(tokenIds)];
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      if (!id) return;
      const meta = await getBeezieMetadata(id);
      if (meta) result.set(id, meta);
      if (perRequestDelayMs > 0) {
        await new Promise((r) => setTimeout(r, perRequestDelayMs));
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return result;
}

/** Read-only batch: only return cached metadata, never network-fetch. */
export async function getBeezieMetadataCachedOnly(
  tokenIds: string[],
): Promise<Map<string, TokenMetadata>> {
  const map = await readCards("beezie", tokenIds);
  for (const [k, v] of map) map.set(k, fixBeezieImage(v));
  return map;
}

/**
 * Extract category-like hints (name + all attribute values) for classifyIP().
 */
export function extractCategoryHints(meta: TokenMetadata): string[] {
  const out: string[] = [];
  if (meta.name) out.push(meta.name);
  for (const a of meta.attributes ?? []) {
    if (a.value == null) continue;
    out.push(String(a.value));
  }
  return out;
}

/** Persist a Beezie metadata object (stores the CDN-safe image). */
export async function writeBeezieMetadata(tokenId: string, meta: TokenMetadata): Promise<void> {
  await upsertCards([cardRowFromMeta("beezie", tokenId, fixBeezieImage(meta))]);
}
