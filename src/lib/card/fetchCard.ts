/**
 * Card-detail view model for /card/[id].
 *
 * Reads ONLY through the existing public metadata readers (getCCMetadata /
 * getBeezieMetadata) plus pure trait normalization, so this stays decoupled
 * from where the underlying data physically lives. When the data pipeline moves
 * those readers from disk cache to Postgres, this file is unaffected.
 *
 * Today it surfaces what we actually have per card (identity, traits, insured
 * value, image, on-chain link). Time-series / cross-platform / sales depth are
 * deferred to the data-reliability backend and shown as honest "soon" states in
 * the UI rather than faked here.
 */
import { getCCMetadata } from "@/lib/data/ccTraits";
import { getBeezieMetadata } from "@/lib/data/beezieTraits";
import { normalizeTraits, gradeLabel, type NormalizedTraits } from "@/lib/data/traits";
import { proxyImg } from "@/lib/img";
import type { TokenMetadata } from "@/lib/onchain/tokenUri";
import type { Chain } from "@/lib/types";
import { parseCardId, PLATFORM_META, type CardPlatform } from "./ids";

const BEEZIE_CONTRACT = "0xbb5ec6fd4b61723bd45c399840f1d868840ca16f";

export type CardAttribute = { label: string; value: string };

export type CardDetail = {
  id: string;
  platform: CardPlatform;
  platformLabel: string;
  chain: Chain;
  tokenId: string;
  name: string;
  image: string | undefined;
  imageFallback: string | undefined;
  traits: NormalizedTraits;
  gradeLabel: string;
  attributes: CardAttribute[];
  explorerUrl: string | null;
};

function explorerUrlFor(platform: CardPlatform, tokenId: string): string | null {
  switch (platform) {
    case "collector-crypt":
    case "phygitals":
      return `https://solscan.io/token/${tokenId}`;
    case "beezie":
      return `https://basescan.org/nft/${BEEZIE_CONTRACT}/${tokenId}`;
    case "courtyard":
      return null;
    default:
      return null;
  }
}

async function metaFor(
  platform: CardPlatform,
  tokenId: string,
): Promise<TokenMetadata | null> {
  if (platform === "collector-crypt") return getCCMetadata(tokenId);
  if (platform === "beezie") return getBeezieMetadata(tokenId);
  // phygitals / courtyard have no per-card metadata reader yet.
  return null;
}

/** Dedupe + clean the raw on-chain attributes into label/value pairs. */
function cleanAttributes(meta: TokenMetadata): CardAttribute[] {
  const seen = new Set<string>();
  const out: CardAttribute[] = [];
  for (const a of meta.attributes ?? []) {
    const label = (a.trait_type ?? "").trim();
    const value = a.value == null ? "" : String(a.value).trim();
    if (!label || !value) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, value });
  }
  return out;
}

export async function getCardDetail(id: string): Promise<CardDetail | null> {
  const parsed = parseCardId(id);
  if (!parsed) return null;
  const { platform, tokenId } = parsed;

  const meta = await metaFor(platform, tokenId);
  if (!meta) return null;

  const traits = normalizeTraits(meta);
  const pm = PLATFORM_META[platform];

  return {
    id,
    platform,
    platformLabel: pm.label,
    chain: pm.chain,
    tokenId,
    name: traits.cardName ?? meta.name ?? "Untitled card",
    image: proxyImg(meta.image),
    imageFallback: proxyImg(meta.imageFallback),
    traits,
    gradeLabel: gradeLabel(traits),
    attributes: cleanAttributes(meta),
    explorerUrl: explorerUrlFor(platform, tokenId),
  };
}
