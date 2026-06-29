/**
 * Platform-detail orchestrator. Mirrors fetchIP.ts but pivots aggregation
 * around a single platform key instead of an IP key.
 *
 * Drives /platform/[key] pages.
 */
import { unstable_cache } from "next/cache";
import type { NormalizedSale } from "@/lib/rarible/queries";
import { getPlatformBuckets, type PlatformBucket } from "./buckets";
import { getBeezieMetadataCachedOnly, extractCategoryHints } from "./beezieTraits";
import { getCCMetadataCachedOnly } from "./ccTraits";
import { classifyIP, IP_CATALOG, OTHER_IP, type IPMeta } from "./ipCatalog";
import { normalizeTraits, gradeLabel, type NormalizedTraits } from "./traits";
import { readHolders } from "./holders";
import { readMarketCap, type MarketCapPlatformIP } from "./marketcap";
import { readGachaDune } from "./gachaDuneCache";
import { readHistory, sumLast, pctChange } from "./history";
import { PLATFORM_SOURCES, type PlatformSource } from "./sources";
import type { Chain, Trend } from "@/lib/types";
import type { TokenMetadata } from "@/lib/onchain/tokenUri";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export type PlatformIPRow = {
  rank: number;
  key: string;
  name: string;
  short: string;
  color: string;
  logo?: string;
  iconBlendMode?: "normal" | "screen" | "lighten";
  emoji?: string;
  /** Total cards of this IP held on the platform (cards table). */
  cards: number;
  /** This IP's market cap on the platform (cards table). */
  mcapUsd: number;
  holders: number;
  vol24Usd: number;
  trades24h: number;
  buyers24h: number;
  avgTradeUsd: number;
  topCard: string | null;
};

export type PlatformCardRow = {
  rank: number;
  platform: string;
  name: string;
  ipName: string;
  ipKey: string;
  ipColor: string;
  ipLogo?: string;
  ipIconBlendMode?: "normal" | "screen" | "lighten";
  ipEmoji?: string;
  ipShort: string;
  set: string | null;
  grade: string;
  tokenId: string;
  trades: number;
  vol24Usd: number;
  topPriceUsd: number;
  image?: string;
  imageFallback?: string;
};

export type RecentSaleRow = {
  date: string;
  platform: string;
  cardName: string | null;
  ipName: string;
  ipKey: string;
  priceUsd: number;
  buyer: string;
  seller: string;
  tokenId: string;
  image?: string;
};

export type PlatformDetail = {
  source: PlatformSource;
  chain: Chain;
  rank: number;
  // Hero stats
  vol24Usd: number;
  vol7Usd: number;
  primaryUsd: number | null;
  /** Gacha-only volume (pack-pull spend); null for non-gacha platforms (Courtyard = tokenization). */
  gachaVol24Usd: number | null;
  gachaVol7Usd: number | null;
  /** Total 24h activity = marketplace resale + primary (gacha/tokenization). */
  total24Usd: number;
  trades24h: number;
  uniqueBuyers: number;
  uniqueSellers: number;
  uniqueWallets: number;
  avgTradeUsd: number;
  highSaleUsd: number;
  lowSaleUsd: number;
  cards: number;
  holders: number;
  mcapUsd: number;
  /** This platform's share of total 24h secondary volume across all platforms (0–1). */
  marketSharePct: number;
  vol24Pct: number | null;
  trend: Trend;
  spark24h: number[];
  hourlyVol: number[];
  // Tables
  ips: PlatformIPRow[];
  topCards: PlatformCardRow[];
  recentSales: RecentSaleRow[];
};

function spark24h(sales: NormalizedSale[], buckets = 24): number[] {
  const now = Date.now();
  const start = now - DAY;
  const bucketMs = DAY / buckets;
  const out = new Array<number>(buckets).fill(0);
  for (const s of sales) {
    const t = Date.parse(s.date);
    if (!Number.isFinite(t) || t < start || t > now) continue;
    const idx = Math.min(buckets - 1, Math.floor((t - start) / bucketMs));
    out[idx] += s.priceUsd;
  }
  return out;
}

function trendOf(values: number[]): Trend {
  if (values.length < 4) return "flat";
  const mid = Math.floor(values.length / 2);
  const first = values.slice(0, mid).reduce((a, b) => a + b, 0);
  const second = values.slice(mid).reduce((a, b) => a + b, 0);
  const denom = first + second;
  if (denom === 0) return "flat";
  if (Math.abs(second - first) < denom * 0.05) return "flat";
  return second > first ? "up" : "down";
}

type EnrichedSale = NormalizedSale & {
  meta: TokenMetadata;
  traits: NormalizedTraits;
};

async function enrichSales(bucket: PlatformBucket): Promise<EnrichedSale[]> {
  if (bucket.sales24h.length === 0) return [];
  const tokenIds = bucket.sales24h.map((s) => s.tokenId);
  let metas: Map<string, TokenMetadata> = new Map();
  if (bucket.source.key === "beezie") {
    metas = await getBeezieMetadataCachedOnly(tokenIds);
  } else if (bucket.source.key === "collector-crypt") {
    metas = await getCCMetadataCachedOnly(tokenIds);
  }
  const out: EnrichedSale[] = [];
  for (const s of bucket.sales24h) {
    const meta = metas.get(s.tokenId);
    if (!meta) continue;
    out.push({ ...s, meta, traits: normalizeTraits(meta) });
  }
  return out;
}

/** IP metadata by key — composition rows come from the cards table, which only carries the key. */
function ipMetaByKey(key: string): IPMeta {
  if (key === OTHER_IP.key) return OTHER_IP;
  return IP_CATALOG.find((i) => i.key === key) ?? OTHER_IP;
}

/**
 * Per-IP breakdown of a platform: the FULL IP composition from the cards table
 * (total cards + market cap per IP) merged with 24h trading from sales. An IP
 * with cards but no 24h trades still appears (vol 0) — that's the point of a
 * breakdown vs. a 24h activity list. Sorted by market cap, then 24h volume.
 */
function buildPlatformIPs(
  enriched: EnrichedSale[],
  mcapByIp: Record<string, MarketCapPlatformIP> | undefined,
  holdersByIp: Record<string, { perPlatform: Record<string, number> }> | null,
  platformKey: string,
): PlatformIPRow[] {
  type SalesAcc = {
    vol: number;
    trades: number;
    buyers: Set<string>;
    topCard: { name: string; price: number } | null;
  };
  const sales = new Map<string, SalesAcc>();
  for (const s of enriched) {
    const ip = classifyIP(extractCategoryHints(s.meta));
    let acc = sales.get(ip.key);
    if (!acc) {
      acc = { vol: 0, trades: 0, buyers: new Set(), topCard: null };
      sales.set(ip.key, acc);
    }
    acc.vol += s.priceUsd;
    acc.trades += 1;
    acc.buyers.add(s.buyer);
    if (s.meta.name && (!acc.topCard || s.priceUsd > acc.topCard.price)) {
      acc.topCard = { name: s.meta.name, price: s.priceUsd };
    }
  }

  const keys = new Set<string>([...Object.keys(mcapByIp ?? {}), ...sales.keys()]);
  const rows: PlatformIPRow[] = [];
  for (const key of keys) {
    const ip = ipMetaByKey(key);
    const comp = mcapByIp?.[key];
    const acc = sales.get(key);
    const vol = acc?.vol ?? 0;
    const trades = acc?.trades ?? 0;
    rows.push({
      rank: 0,
      key: ip.key,
      name: ip.name,
      short: ip.short,
      color: ip.color,
      logo: ip.logo,
      iconBlendMode: ip.iconBlendMode,
      emoji: ip.emoji,
      cards: comp?.cards ?? 0,
      mcapUsd: comp?.mcapUsd ?? 0,
      holders: holdersByIp?.[key]?.perPlatform?.[platformKey] ?? 0,
      vol24Usd: vol,
      trades24h: trades,
      buyers24h: acc?.buyers.size ?? 0,
      avgTradeUsd: trades ? vol / trades : 0,
      topCard: acc?.topCard?.name ?? null,
    });
  }
  rows.sort((a, b) => b.mcapUsd - a.mcapUsd || b.vol24Usd - a.vol24Usd);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

function buildTopCards(enriched: EnrichedSale[], platform: string): PlatformCardRow[] {
  type Acc = {
    sale: EnrichedSale;
    trades: number;
    vol: number;
    top: number;
  };
  const byToken = new Map<string, Acc>();
  for (const s of enriched) {
    let acc = byToken.get(s.tokenId);
    if (!acc) {
      acc = { sale: s, trades: 0, vol: 0, top: 0 };
      byToken.set(s.tokenId, acc);
    }
    acc.trades += 1;
    acc.vol += s.priceUsd;
    if (s.priceUsd > acc.top) {
      acc.top = s.priceUsd;
      acc.sale = s;
    }
  }
  const rows: PlatformCardRow[] = [];
  for (const acc of byToken.values()) {
    const ip = classifyIP(extractCategoryHints(acc.sale.meta));
    const traits = acc.sale.traits;
    rows.push({
      rank: 0,
      platform,
      name: acc.sale.meta.name ?? acc.sale.tokenId,
      ipName: ip.name,
      ipKey: ip.key,
      ipColor: ip.color,
      ipLogo: ip.logo,
      ipIconBlendMode: ip.iconBlendMode,
      ipEmoji: ip.emoji,
      ipShort: ip.short,
      set: traits.set ?? null,
      grade: gradeLabel(traits),
      tokenId: acc.sale.tokenId,
      trades: acc.trades,
      vol24Usd: acc.vol,
      topPriceUsd: acc.top,
      image: acc.sale.meta.image,
      imageFallback: (acc.sale.meta as { imageFallback?: string }).imageFallback,
    });
  }
  rows.sort((a, b) => b.vol24Usd - a.vol24Usd);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

function buildRecentSales(enriched: EnrichedSale[], platform: string): RecentSaleRow[] {
  const sorted = [...enriched].sort((a, b) => (a.date < b.date ? 1 : -1));
  return sorted.map((s) => {
    const ip = classifyIP(extractCategoryHints(s.meta));
    return {
      date: s.date,
      platform,
      cardName: s.meta.name ?? null,
      ipName: ip.name,
      ipKey: ip.key,
      priceUsd: s.priceUsd,
      buyer: s.buyer,
      seller: s.seller,
      tokenId: s.tokenId,
      image: s.meta.image,
    };
  });
}

async function buildPlatformDetail(key: string): Promise<PlatformDetail | null> {
  const buckets = await getPlatformBuckets();
  const bucket = buckets.find((b) => b.source.key === key);
  if (!bucket) return null;

  // Cross-cache reads
  const [holders, mcap, gacha] = await Promise.all([
    readHolders(),
    readMarketCap(),
    readGachaDune(),
  ]);

  const enriched = await enrichSales(bucket);

  const allSales = bucket.sales24h;
  const volumeUsd = allSales.reduce((s, x) => s + x.priceUsd, 0);
  const buyers = new Set(allSales.map((s) => s.buyer));
  const sellers = new Set(allSales.map((s) => s.seller));
  const wallets = new Set<string>([...buyers, ...sellers]);
  const prices = allSales.map((s) => s.priceUsd);
  const hourly = spark24h(allSales, 24);

  // Real per-platform market cap from the cards table (CC = insured value, Beezie
  // = listing floor). Platforms whose cards we don't track yet (Courtyard/Phygitals)
  // have no entry → 0, surfaced honestly as "—" rather than a fabricated estimate.
  const platformMcapEntry = mcap?.byPlatform?.[key];
  const platformMcap = platformMcapEntry?.mcapUsd ?? 0;

  // History → 7d (we only retain 7d of hourly buckets today)
  const history = await readHistory(key);
  const histBuckets = history?.buckets ?? null;
  const vol7Usd = histBuckets ? sumLast(histBuckets, 24 * 7).volumeUsd : NaN;
  const vol24Pct = histBuckets ? pctChange(histBuckets, 24) : null;

  // Rank by TOTAL 24h activity (resale + primary), consistent with the homepage.
  const totalOf = (pb: PlatformBucket) => pb.stats24h.volumeUsd + (pb.primaryUsd ?? 0);
  const sortedByTotal = [...buckets].sort((a, b) => totalOf(b) - totalOf(a));
  const rank = sortedByTotal.findIndex((b) => b.source.key === key) + 1;

  const platformHolders = holders?.platforms?.[key] ?? 0;
  // Total cards held on this platform (cards table). 0 for platforms we don't
  // crawl yet (Courtyard/Phygitals) — honest "—", not the old ~125K-everywhere bug.
  const cards = platformMcapEntry?.cards ?? 0;

  // This platform's share of total 24h secondary volume across all platforms.
  const totalSecVol = buckets.reduce((s, b) => s + b.stats24h.volumeUsd, 0);
  const marketSharePct = totalSecVol > 0 ? bucket.stats24h.volumeUsd / totalSecVol : 0;

  const ips = buildPlatformIPs(enriched, platformMcapEntry?.byIp, holders?.byIp ?? null, key);
  const topCards = buildTopCards(enriched, key);
  const recentSales = buildRecentSales(enriched, key);

  // Gacha-only split (excludes Courtyard's tokenization, which stays in primaryUsd).
  const g = gacha?.platforms?.[key];

  return {
    source: bucket.source,
    chain: bucket.source.chain,
    rank,
    vol24Usd: volumeUsd,
    vol7Usd,
    primaryUsd: bucket.primaryUsd,
    gachaVol24Usd: g && g.kind === "gacha" ? g.vol24h : null,
    gachaVol7Usd: g && g.kind === "gacha" ? g.vol7d : null,
    total24Usd: volumeUsd + (bucket.primaryUsd ?? 0),
    trades24h: allSales.length,
    uniqueBuyers: buyers.size,
    uniqueSellers: sellers.size,
    uniqueWallets: wallets.size,
    avgTradeUsd: allSales.length ? volumeUsd / allSales.length : 0,
    highSaleUsd: prices.length ? Math.max(...prices) : 0,
    lowSaleUsd: prices.length ? Math.min(...prices) : 0,
    cards,
    holders: platformHolders,
    mcapUsd: platformMcap,
    marketSharePct,
    vol24Pct,
    trend: trendOf(hourly),
    spark24h: hourly,
    hourlyVol: hourly,
    ips,
    topCards,
    recentSales,
  };
}

export const getPlatformDetail = unstable_cache(
  async (key: string) => buildPlatformDetail(key),
  ["platform-detail:v6"],
  { revalidate: 3600, tags: ["platform-detail", "platform-buckets"] },
);

export { PLATFORM_SOURCES };
