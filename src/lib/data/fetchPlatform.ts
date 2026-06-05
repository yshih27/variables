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
import { classifyIP, type IPMeta } from "./ipCatalog";
import { normalizeTraits, gradeLabel, type NormalizedTraits } from "./traits";
import { readHolders } from "./holders";
import { readMarketCap } from "./marketcap";
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
  cards: number;
  holders: number;
  buyers24h: number;
  vol24Usd: number;
  avgTradeUsd: number;
  topCard: string | null;
};

export type PlatformCardRow = {
  rank: number;
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

async function buildPlatformIPs(
  enriched: EnrichedSale[],
  holdersByIp: Record<string, { perPlatform: Record<string, number> }> | null,
  platformKey: string,
): Promise<PlatformIPRow[]> {
  type Acc = {
    ip: IPMeta;
    sales: EnrichedSale[];
    cards: Set<string>;
    buyers: Set<string>;
    topCard: { name: string; price: number } | null;
  };
  const accs = new Map<string, Acc>();
  for (const s of enriched) {
    const ip = classifyIP(extractCategoryHints(s.meta));
    let acc = accs.get(ip.key);
    if (!acc) {
      acc = { ip, sales: [], cards: new Set(), buyers: new Set(), topCard: null };
      accs.set(ip.key, acc);
    }
    acc.sales.push(s);
    acc.cards.add(s.tokenId);
    acc.buyers.add(s.buyer);
    if (s.meta.name && (!acc.topCard || s.priceUsd > acc.topCard.price)) {
      acc.topCard = { name: s.meta.name, price: s.priceUsd };
    }
  }
  const rows: PlatformIPRow[] = [];
  for (const acc of accs.values()) {
    const vol24 = acc.sales.reduce((s, x) => s + x.priceUsd, 0);
    const holders = holdersByIp?.[acc.ip.key]?.perPlatform?.[platformKey] ?? 0;
    rows.push({
      rank: 0,
      key: acc.ip.key,
      name: acc.ip.name,
      short: acc.ip.short,
      color: acc.ip.color,
      logo: acc.ip.logo,
      iconBlendMode: acc.ip.iconBlendMode,
      emoji: acc.ip.emoji,
      cards: acc.cards.size,
      holders,
      buyers24h: acc.buyers.size,
      vol24Usd: vol24,
      avgTradeUsd: acc.sales.length ? vol24 / acc.sales.length : 0,
      topCard: acc.topCard?.name ?? null,
    });
  }
  rows.sort((a, b) => b.vol24Usd - a.vol24Usd);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

function buildTopCards(enriched: EnrichedSale[]): PlatformCardRow[] {
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

function buildRecentSales(enriched: EnrichedSale[]): RecentSaleRow[] {
  const sorted = [...enriched].sort((a, b) => (a.date < b.date ? 1 : -1));
  return sorted.map((s) => {
    const ip = classifyIP(extractCategoryHints(s.meta));
    return {
      date: s.date,
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
  const [holders, mcap] = await Promise.all([readHolders(), readMarketCap()]);

  const enriched = await enrichSales(bucket);

  const allSales = bucket.sales24h;
  const volumeUsd = allSales.reduce((s, x) => s + x.priceUsd, 0);
  const buyers = new Set(allSales.map((s) => s.buyer));
  const sellers = new Set(allSales.map((s) => s.seller));
  const wallets = new Set<string>([...buyers, ...sellers]);
  const prices = allSales.map((s) => s.priceUsd);
  const hourly = spark24h(allSales, 24);

  // Per-platform mcap contribution: sum of mcap entries × per-platform share
  let platformMcap = 0;
  if (mcap) {
    for (const [ipKey, entry] of Object.entries(mcap.byIp)) {
      const platformHolders = holders?.byIp?.[ipKey]?.perPlatform?.[key] ?? 0;
      const totalHolders = holders?.byIp?.[ipKey]?.total ?? 0;
      // Crude weight by holder share; for a stricter version we'd track
      // per-token valuation per platform.
      if (totalHolders > 0) {
        platformMcap += entry.mcapUsd * (platformHolders / totalHolders);
      }
    }
  }

  // History → 7d (we only retain 7d of hourly buckets today)
  const history = await readHistory(key);
  const histBuckets = history?.buckets ?? null;
  const vol7Usd = histBuckets ? sumLast(histBuckets, 24 * 7).volumeUsd : NaN;
  const vol24Pct = histBuckets ? pctChange(histBuckets, 24) : null;

  // Rank by 24h vol across platforms
  const sortedByVol = [...buckets].sort(
    (a, b) => b.stats24h.volumeUsd - a.stats24h.volumeUsd,
  );
  const rank = sortedByVol.findIndex((b) => b.source.key === key) + 1;

  const platformHolders = holders?.platforms?.[key] ?? 0;
  // Per-platform card count = unique tokens traded on this platform in 24h.
  // Previously we summed mcap.byIp.cards which counts EVERY tracked card on
  // EVERY platform — surfaced as ~125K on every platform page, which was wrong.
  const cards = new Set(allSales.map((s) => s.tokenId)).size;

  const ips = await buildPlatformIPs(enriched, holders?.byIp ?? null, key);
  const topCards = buildTopCards(enriched);
  const recentSales = buildRecentSales(enriched);

  return {
    source: bucket.source,
    chain: bucket.source.chain,
    rank,
    vol24Usd: volumeUsd,
    vol7Usd,
    primaryUsd: bucket.primaryUsd,
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
  ["platform-detail:v1"],
  { revalidate: 3600, tags: ["platform-detail", "platform-buckets"] },
);

export { PLATFORM_SOURCES };
