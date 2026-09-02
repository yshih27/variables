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
import { readCards } from "@/lib/data/cards";
import { normalizeTraits, gradeLabel, type NormalizedTraits } from "@/lib/data/traits";
import { classifyIPFromMeta } from "@/lib/data/ipCatalog";
import { identityFromCardRow, printingKey } from "@/lib/ripfun/identity";
import { proxyImg } from "@/lib/img";
import type { TokenMetadata } from "@/lib/onchain/tokenUri";
import type { Chain } from "@/lib/types";
import { parseCardId, PLATFORM_META, type CardPlatform } from "./ids";
import { unstable_cache } from "next/cache";
import { readListings, type ListingEntry } from "@/lib/data/listings";
import { readCoreVolume } from "@/lib/data/coreVolumeCache";

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
  /**
   * Grade-FREE key for this printing (src/lib/ripfun/identity.ts), or null when
   * the metadata lacks a card number or name to key on.
   *
   * Computed here because it needs the RAW token metadata — the identity builder
   * reads `attributes` for the card number and language, and `cleanAttributes`
   * has already reshaped those for display by the time a caller sees CardDetail.
   * It is an identity, not a price: it says WHICH printing this is, so a comp can
   * be looked up. Nothing about the value of this token rides on it.
   */
  printingKey: string | null;
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
  if (platform === "phygitals") return (await readCards("phygitals", [tokenId])).get(tokenId) ?? null;
  // courtyard has no per-card metadata reader yet.
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

  // The printing identity, for the CardOS comp lookup. Grade-free by construction
  // — the grade is passed separately at lookup time, because a PSA 10 and a loose
  // copy of the same printing are the same PRINTING and different cards.
  const identity = identityFromCardRow({
    card_name: traits.cardName,
    set_name: traits.set,
    grade_label: gradeLabel(traits),
    ip_key: classifyIPFromMeta(meta).key,
    attributes: meta.attributes ?? null,
  });

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
    printingKey: printingKey(identity),
  };
}

// ── Per-card marketplace data ───────────────────────────────────────────────
// Kept SEPARATE from getCardDetail (identity/traits) so the detail view can
// render instantly and hydrate market data independently. Sourced entirely from
// the cache-only snapshots (`listings`, `core-volume`) — no request-time fetches.

export type CardSale = {
  date: string;
  priceUsd: number;
  buyer: string;
  seller: string;
};

export type CardListing = {
  priceUsd: number;
  /** Marketplace the listing sits on (OPEN_SEA, RARIBLE, COLLECTOR_CRYPT, …). */
  source: string;
};

export type CardMarket = {
  /** Cheapest active listing for this exact token, if any. */
  listing: CardListing | null;
  /** This token's sales in the last 24h, newest first (often 0–1 — most cards
   *  don't trade daily). The honest window the sales side rests on. */
  recentSales: CardSale[];
  salesWindow: "24h";
  lastSaleUsd: number | null;
  lastSaleAt: string | null;
  salesCount24h: number;
  vol24Usd: number;
};

/** Match a token to its listing entry. Solana tokens key directly as
 *  `SOLANA:<mint>`; EVM tokens (Beezie/Courtyard) key as `CHAIN:contract:tokenId`
 *  so we match by platform + tokenId suffix. */
function findCardListing(
  byItem: Record<string, ListingEntry>,
  platform: CardPlatform,
  tokenId: string,
): ListingEntry | null {
  if (platform === "collector-crypt" || platform === "phygitals") {
    const direct = byItem[`SOLANA:${tokenId}`];
    if (direct) return direct;
  }
  const suffix = `:${tokenId}`;
  for (const entry of Object.values(byItem)) {
    if (entry.platform !== platform) continue;
    if (entry.itemId === tokenId || entry.itemId.endsWith(suffix)) return entry;
  }
  return null;
}

async function buildCardMarket(id: string): Promise<CardMarket | null> {
  const parsed = parseCardId(id);
  if (!parsed) return null;
  const { platform, tokenId } = parsed;

  const [listings, core] = await Promise.all([readListings(), readCoreVolume()]);

  const entry = listings ? findCardListing(listings.byItem, platform, tokenId) : null;
  const listing: CardListing | null = entry
    ? { priceUsd: entry.priceUsd, source: entry.source }
    : null;

  // 24h sale rows for this exact token (core-volume only retains a 24h window).
  const recentSales: CardSale[] = (core?.platforms?.[platform]?.sales24h ?? [])
    .filter((s) => s.tokenId === tokenId)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((s) => ({ date: s.date, priceUsd: s.priceUsd, buyer: s.buyer, seller: s.seller }));

  return {
    listing,
    recentSales,
    salesWindow: "24h",
    lastSaleUsd: recentSales[0]?.priceUsd ?? null,
    lastSaleAt: recentSales[0]?.date ?? null,
    salesCount24h: recentSales.length,
    vol24Usd: recentSales.reduce((s, x) => s + x.priceUsd, 0),
  };
}

export const getCardMarket = unstable_cache(
  async (id: string) => buildCardMarket(id),
  ["card-market:v1"],
  { revalidate: 3600, tags: ["card-market", "platform-buckets"] },
);
