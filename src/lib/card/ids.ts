/**
 * Card identity helpers for the /card/[id] route.
 *
 * A card is referenced everywhere by (platform, tokenId): the Solana mint for
 * Collector Crypt / Phygitals, the ERC-721 tokenId for Beezie, etc. We encode
 * both into a single URL segment so `/card/[id]` stays one clean segment and is
 * unambiguous about which chain/reader to use.
 *
 *   collector-crypt mint  → /card/cc-<mint>
 *   beezie tokenId        → /card/bz-<tokenId>
 *
 * Platform codes contain no "-", and mint addresses (base58) / Beezie tokenIds
 * (numeric) contain no "-", so splitting on the first "-" is unambiguous.
 *
 * NOTE: this is a per-token id today. Once the data pipeline reconciles the
 * same physical card across platforms, `[id]` can become a canonical card id
 * and these composite ids redirect to it.
 */
import type { Chain } from "@/lib/types";

export type CardPlatform = "collector-crypt" | "beezie" | "phygitals" | "courtyard";

const CODE_BY_PLATFORM: Record<CardPlatform, string> = {
  "collector-crypt": "cc",
  beezie: "bz",
  phygitals: "pg",
  courtyard: "cy",
};

const PLATFORM_BY_CODE: Record<string, CardPlatform> = {
  cc: "collector-crypt",
  bz: "beezie",
  pg: "phygitals",
  cy: "courtyard",
};

export const PLATFORM_META: Record<CardPlatform, { label: string; chain: Chain }> = {
  "collector-crypt": { label: "Collector Crypt", chain: "Solana" },
  beezie: { label: "Beezie", chain: "Base" },
  phygitals: { label: "Phygitals", chain: "Solana" },
  courtyard: { label: "Courtyard", chain: "Polygon" },
};

/** Build the URL for a card detail page from a platform key + tokenId. */
export function cardHref(platform: string, tokenId: string): string {
  const code = CODE_BY_PLATFORM[platform as CardPlatform];
  if (!code) return "#";
  return `/card/${code}-${encodeURIComponent(tokenId)}`;
}

/**
 * Whether we can render a card-detail page for this platform today (i.e. we
 * have a per-card metadata reader). Used to avoid linking to a 404. Phygitals /
 * Courtyard don't have readers yet.
 */
export function cardSupported(platform: string): boolean {
  return (
    platform === "collector-crypt" || platform === "beezie" || platform === "phygitals"
  );
}

/** Parse a `/card/[id]` segment back into { platform, tokenId }, or null. */
export function parseCardId(
  id: string,
): { platform: CardPlatform; tokenId: string } | null {
  const dash = id.indexOf("-");
  if (dash <= 0) return null;
  const platform = PLATFORM_BY_CODE[id.slice(0, dash)];
  if (!platform) return null;
  let tokenId: string;
  try {
    tokenId = decodeURIComponent(id.slice(dash + 1));
  } catch {
    return null; // malformed percent-encoding → not-found, never throw (would 500 the route)
  }
  if (!tokenId) return null;
  return { platform, tokenId };
}
