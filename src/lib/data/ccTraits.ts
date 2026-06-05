/**
 * CC trait reader — backed by the Postgres `cards` table (migrated from
 * .cache/cc-traits/*). Source of truth is Helius DAS; getCCMetadata falls back
 * to a live DAS fetch for a mint not yet in the table and persists it.
 */
import { dasCall, type DasAsset } from "@/lib/helius/client";
import type { TokenMetadata } from "@/lib/onchain/tokenUri";
import { readCards, upsertCards, cardRowFromMeta } from "./cards";

export function dasAssetToTokenMetadata(asset: DasAsset): TokenMetadata {
  const m = asset.content?.metadata;
  const file = asset.content?.files?.[0];
  // Prefer the raw Arweave gateway URL (source of truth) and fall back to
  // Helius's CDN proxy, which we've seen 502/503 transiently for some assets.
  const primary = file?.uri ?? file?.cdn_uri;
  const fallback = file?.cdn_uri && file.cdn_uri !== primary ? file.cdn_uri : undefined;
  return {
    name: m?.name,
    attributes: m?.attributes,
    image: primary,
    imageFallback: fallback,
  };
}

export async function getCCMetadata(mint: string): Promise<TokenMetadata | null> {
  const hit = (await readCards("collector-crypt", [mint])).get(mint);
  if (hit) return hit;
  try {
    const asset = await dasCall<DasAsset>("getAsset", { id: mint });
    const meta = dasAssetToTokenMetadata(asset);
    await writeCCMetadata(mint, meta);
    return meta;
  } catch {
    return null;
  }
}

export async function getCCMetadataCachedOnly(
  mints: string[],
): Promise<Map<string, TokenMetadata>> {
  return readCards("collector-crypt", mints);
}

/** Persist a CC metadata object (e.g. during the collection warm). */
export async function writeCCMetadata(mint: string, meta: TokenMetadata): Promise<void> {
  await upsertCards([cardRowFromMeta("collector-crypt", mint, meta)]);
}
