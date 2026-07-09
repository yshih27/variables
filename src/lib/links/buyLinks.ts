/**
 * Buy-links resolver (B2). Given a card, return an ORDERED list of outbound
 * marketplace links — **Rarible first** when the card's chain is Rarible-indexed,
 * then the **native platform**, then an on-chain explorer as a utility link.
 *
 * URL templates VERIFIED against the live sites (2026-07-01):
 *   • Rarible (EVM):    rarible.com/token/{chain}/{contract}:{tokenId}
 *       Beezie/Base confirmed (token 1009 → "2023 Japanese Scarlet ex Klawf");
 *       Courtyard/Polygon uses the same EVM pattern. Solana (CC/Phygitals) is NOT
 *       on Rarible (the mint URL 301s to rarible.com/404) → those get isRarible:false.
 *   • Collector Crypt:  collectorcrypt.com/assets/solana/{mint}          (confirmed)
 *   • Beezie:           beezie.com/marketplace/collectible/{tokenId}     (confirmed —
 *                        the SEO name-slug prefix is optional; the bare id routes)
 *   • Courtyard native item pages key on an internal asset hash, and Phygitals on a
 *     name-slug + internal id — neither derivable from {contract, tokenId} — so those
 *     fall back to the platform marketplace. Solana cards also get a Solscan link.
 *
 * v1 uses a by-CHAIN Rarible heuristic (no per-card live Rarible lookup).
 */
import { PLATFORM_SOURCES } from "@/lib/data/sources";

export type BuyLink = { platform: string; label: string; url: string; isRarible: boolean };

/** Card shape for the resolver. `chain`/`contract` are optional — when omitted they
 *  are derived from sources.ts by platform, so callers can pass just {platform, tokenId}. */
export type BuyLinkCard = {
  platform: string;
  tokenId: string;
  chain?: string;
  contract?: string;
};

/** Rarible's lowercase chain slug in the token URL path (EVM chains only). */
const RARIBLE_CHAIN_SLUG: Record<string, string> = {
  Base: "base",
  Polygon: "polygon",
  Ethereum: "ethereum",
};

const PLATFORM_LABEL: Record<string, string> = {
  "collector-crypt": "Collector Crypt",
  beezie: "Beezie",
  courtyard: "Courtyard",
  phygitals: "Phygitals",
};

/** Marketplace landing — the honest fallback when a native item URL isn't derivable. */
const MARKETPLACE_URL: Record<string, string> = {
  "collector-crypt": "https://collectorcrypt.com/marketplace/cards",
  beezie: "https://beezie.com/marketplace",
  courtyard: "https://courtyard.io/",
  phygitals: "https://www.phygitals.com/marketplace",
};

/** {contract, chain} from sources.ts — collectionId "BASE:0x.." → bare "0x..". */
function sourceContract(platform: string): { contract: string; chain: string } | null {
  const src = PLATFORM_SOURCES.find((p) => p.key === platform);
  if (!src) return null;
  const contract =
    src.kind === "rarible" ? src.collectionId.split(":")[1] ?? "" : src.collectionAddress;
  return { contract, chain: src.chain };
}

/** Native item-page URL from a mint/tokenId, or null when it needs data we lack (v1). */
function nativeItemUrl(platform: string, tokenId: string): string | null {
  const id = encodeURIComponent(tokenId);
  switch (platform) {
    case "collector-crypt":
      return `https://collectorcrypt.com/assets/solana/${id}`;
    case "beezie":
      return `https://beezie.com/marketplace/collectible/${id}`;
    default:
      return null; // courtyard (asset hash) + phygitals (name-slug) → marketplace fallback
  }
}

/**
 * Ordered outbound links for a card: Rarible-first (when indexed), then the native
 * platform, then Solscan for Solana mints. Always returns ≥1 link for a card on any
 * of the 4 tracked platforms.
 */
export function buyLinks(card: BuyLinkCard): BuyLink[] {
  const { platform, tokenId } = card;
  if (!platform || !tokenId) return [];

  const src = sourceContract(platform);
  const chain = card.chain || src?.chain || "";
  const contract = card.contract || src?.contract || "";
  const links: BuyLink[] = [];

  // 1. Rarible FIRST when the chain is Rarible-indexed (EVM: Base / Polygon / Ethereum).
  const raribleSlug = RARIBLE_CHAIN_SLUG[chain];
  if (raribleSlug && contract) {
    links.push({
      platform: "rarible",
      label: "Buy on Rarible",
      // Canonical item URL: rarible.com/{chain}/items/{contract}:{tokenId} —
      // the /token/ form resolves via og.rarible.com and isn't the storefront page.
      url: `https://rarible.com/${raribleSlug}/items/${contract}:${encodeURIComponent(tokenId)}`,
      isRarible: true,
    });
  }

  // 2. Native platform — the item page when we can build it, else its marketplace.
  const name = PLATFORM_LABEL[platform] ?? platform;
  const item = nativeItemUrl(platform, tokenId);
  const nativeUrl = item ?? MARKETPLACE_URL[platform];
  if (nativeUrl) {
    links.push({
      platform,
      label: `${item ? "Buy on" : "Find on"} ${name}`,
      url: nativeUrl,
      isRarible: false,
    });
  }

  // 3. On-chain explorer (utility) — Solana mints via Solscan.
  if (chain === "Solana") {
    links.push({
      platform: "solscan",
      label: "View on-chain",
      url: `https://solscan.io/token/${encodeURIComponent(tokenId)}`,
      isRarible: false,
    });
  }

  return links;
}
