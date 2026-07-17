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
import {
  readMetricSeries,
  sumLastCompleteDays,
  dayOverDayPct,
  DELTA_MIN_BASE_USD,
  type SeriesPoint,
} from "./metricSnapshots";
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
  /** How many of the 24h sales the tables below could enrich with card metadata,
   *  out of the total that traded (M2). `salesEnriched < salesTotal` means a token
   *  traded before warm-traits fetched its metadata — label the tables
   *  "N of M sales enriched", never restate N as the 24h sale count. */
  salesEnriched: number;
  salesTotal: number;
};

function spark24h(sales: NormalizedSale[], buckets = 24): number[] {
  const out = new Array<number>(buckets).fill(0);
  // Anchor the 24h window to the NEWEST sale, not wall-clock now. sales come from a
  // cached snapshot that can lag real time (CC secondary is Dune-daily, ~1d behind),
  // so windowing against Date.now() drops every sale once the snapshot is >24h old
  // and the chart flatlines at $0 (QA-2). Bucketing over the data's own last-24h keeps
  // the intraday curve real and consistent with the headline 24h volume (same sales).
  let end = -Infinity;
  for (const s of sales) {
    const t = Date.parse(s.date);
    if (Number.isFinite(t) && t > end) end = t;
  }
  if (!Number.isFinite(end)) return out; // no dated sales → empty
  const start = end - DAY;
  const bucketMs = DAY / buckets;
  for (const s of sales) {
    const t = Date.parse(s.date);
    if (!Number.isFinite(t) || t < start || t > end) continue;
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
      // NaN (not 0) for untracked composition — 0 renders as "$0 / 0 cards" (looks
      // worthless), NaN renders as "—" (not tracked), matching every other reader (X5).
      cards: comp?.cards ?? NaN,
      mcapUsd: comp?.mcapUsd ?? NaN,
      holders: holdersByIp?.[key]?.perPlatform?.[platformKey] ?? 0,
      vol24Usd: vol,
      trades24h: trades,
      buyers24h: acc?.buyers.size ?? 0,
      avgTradeUsd: trades ? vol / trades : 0,
      topCard: acc?.topCard?.name ?? null,
    });
  }
  // NaN-safe sort: untracked-mcap IPs sink to the bottom instead of scrambling order.
  const mc = (v: number) => (Number.isFinite(v) ? v : -Infinity);
  rows.sort((a, b) => mc(b.mcapUsd) - mc(a.mcapUsd) || b.vol24Usd - a.vol24Usd);
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
  const [holders, mcap, gacha, volSeries] = await Promise.all([
    readHolders(),
    readMarketCap(),
    readGachaDune(),
    // Native daily marketplace volume — the SAME spine every other surface reads.
    // Replaces the Rarible-era readHistory() blobs (B3).
    readMetricSeries("platform", key, "volume_usd"),
  ]);

  const enriched = await enrichSales(bucket);

  const allSales = bucket.sales24h;
  // M2: enrichSales drops any sale whose token has no metadata yet, so the tables
  // (enriched) can under-count the rail (all sales) — the page then claimed "186
  // sales in last 24h" when 205 traded. It's a TIMING gap: warm-traits backfills
  // exactly the traded set, but a token that trades before the next daily warm has
  // no row yet. Surface BOTH counts so the label can say "186 of 205 enriched"
  // instead of quietly restating a smaller number as the truth.
  const salesEnriched = enriched.length;
  const salesTotal = allSales.length;
  // ⚠️ This page derives its secondary figures from `sales24h`, NOT `stats24h`,
  // so `unknownStats` alone doesn't reach it. For an untracked platform
  // `sales24h` is [] — and reducing [] gives a confident 0. `tracked` is the
  // only thing that separates "measured, no sales" from "never measured".
  const tracked = bucket.hasSecondarySource;
  const unknown = (n: number) => (tracked ? n : NaN);
  const volumeUsd = unknown(allSales.reduce((s, x) => s + x.priceUsd, 0));
  const buyers = new Set(allSales.map((s) => s.buyer));
  const sellers = new Set(allSales.map((s) => s.seller));
  const wallets = new Set<string>([...buyers, ...sellers]);
  const prices = allSales.map((s) => s.priceUsd);
  const hourly = spark24h(allSales, 24);

  // Real per-platform market cap from the cards table (CC = insured value, Beezie
  // = listing floor). Platforms whose cards we don't track yet (Courtyard/Phygitals)
  // have no entry → NaN, surfaced honestly as "—" (not a fabricated $0 = "worthless"; X5).
  const platformMcapEntry = mcap?.byPlatform?.[key];
  const platformMcap = platformMcapEntry?.mcapUsd ?? NaN;

  // 7d volume + the 24h change, both from the NATIVE spine (B3/M4). These used to
  // read the Rarible-era `readHistory()` blobs — the last legacy path on this page —
  // which inflated Beezie ~20-90× (its "7d" $2.87M exceeded its own 14d native total
  // $126K, arithmetically impossible) and left CC's 7d on a different provenance from
  // every other number. Now: Σ the last 7 COMPLETE days of `volume_usd`; fewer than
  // 7 recorded days → NaN → "—" (a missing number beats an impossible one).
  //   ⚠️ window note: 7d is 7 complete CALENDAR days (the spine excludes today) while
  //   vol24Usd above is a ROLLING 24h off `sales24h` — the two-tier rule in
  //   metricSnapshots.ts. A big day today can legitimately read 7d < 24h.
  const vol7Usd = unknown(sumLastCompleteDays(volSeries, 7));
  // Day-over-day, with the minBase floor the tiny-base platforms need: Courtyard
  // trades $4-393/day, so an unfloored % printed "+9,538.6%" (M4).
  const vol24Pct = tracked ? dayOverDayPct(volSeries, DELTA_MIN_BASE_USD) : null;

  // Rank by TOTAL 24h activity (resale + primary), consistent with the homepage.
  // An untracked platform's secondary volume is NaN — counted as 0 here so it
  // ranks on the primary volume we DO have, rather than NaN-ing the comparator
  // (which would make the sort order arbitrary for every platform).
  const totalOf = (pb: PlatformBucket) =>
    (Number.isFinite(pb.stats24h.volumeUsd) ? pb.stats24h.volumeUsd : 0) + (pb.primaryUsd ?? 0);
  const sortedByTotal = [...buckets].sort((a, b) => totalOf(b) - totalOf(a));
  const rank = sortedByTotal.findIndex((b) => b.source.key === key) + 1;

  // NaN, not 0, when this platform is absent from the snapshot — warm-holders
  // only scans beezie / collector-crypt / phygitals, so Courtyard was rendering
  // a confident "0 holders" for a platform we simply never counted. A scanned
  // platform with genuinely no holders still writes an explicit 0 and keeps it.
  // Same X5 convention as `cards` immediately below.
  const platformHolders = holders?.platforms?.[key] ?? NaN;
  // Total cards held on this platform (cards table). NaN for platforms we don't
  // crawl yet (Courtyard/Phygitals) → renders "—", not "0" (the old ~125K bug, X5).
  const cards = platformMcapEntry?.cards ?? NaN;

  // This platform's share of total 24h secondary volume across all platforms.
  // The denominator skips untracked platforms (Σ of what we measure — the same
  // total as before); the numerator does NOT, so an untracked platform's own
  // share stays NaN → "—". We don't know its secondary volume, so we can't know
  // its share; claiming 0% would be a fabrication.
  const totalSecVol = buckets.reduce(
    (s, b) => s + (Number.isFinite(b.stats24h.volumeUsd) ? b.stats24h.volumeUsd : 0),
    0,
  );
  const marketSharePct = totalSecVol > 0 ? bucket.stats24h.volumeUsd / totalSecVol : 0;

  const ips = buildPlatformIPs(enriched, platformMcapEntry?.byIp, holders?.byIp ?? null, key);
  const topCards = buildTopCards(enriched, key);
  const recentSales = buildRecentSales(enriched, key);

  // Gacha-only split. Courtyard is now classified gacha (R5), so its ~$1.5M/24h
  // surfaces here as gachaVol24Usd instead of hiding in the primary residual.
  const g = gacha?.platforms?.[key];

  return {
    source: bucket.source,
    chain: bucket.source.chain,
    rank,
    vol24Usd: volumeUsd,
    vol7Usd,
    salesEnriched,
    salesTotal,
    primaryUsd: bucket.primaryUsd,
    gachaVol24Usd: g && g.kind === "gacha" ? g.vol24h : null,
    gachaVol7Usd: g && g.kind === "gacha" ? g.vol7d : null,
    total24Usd: volumeUsd + (bucket.primaryUsd ?? 0),
    trades24h: unknown(allSales.length),
    uniqueBuyers: unknown(buyers.size),
    uniqueSellers: unknown(sellers.size),
    uniqueWallets: unknown(wallets.size),
    avgTradeUsd: allSales.length ? volumeUsd / allSales.length : unknown(0),
    highSaleUsd: prices.length ? Math.max(...prices) : unknown(0),
    lowSaleUsd: prices.length ? Math.min(...prices) : unknown(0),
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
  ["platform-detail:v7"], // v7: spark24h anchors to newest sale (QA-2)
  { revalidate: 3600, tags: ["platform-detail", "platform-buckets"] },
);

/**
 * Activity-chart daily series for a platform (metric_snapshots spine). Cached so
 * the platform page reads them through ONE memoized call instead of 4 uncached
 * `readMetricSeries` round-trips per request (R2-B1 perf). Same 1h revalidate +
 * "platform-detail" tag as the detail, so both refresh together.
 */
export const getPlatformActivitySeries = unstable_cache(
  async (
    key: string,
  ): Promise<{
    volume: SeriesPoint[];
    wallets: SeriesPoint[];
    trades: SeriesPoint[];
    mcap: SeriesPoint[];
    gacha: SeriesPoint[];
    holders: SeriesPoint[];
  }> => {
    const [volume, wallets, trades, mcap, gacha, holders] = await Promise.all([
      readMetricSeries("platform", key, "volume_usd").catch(() => [] as SeriesPoint[]),
      readMetricSeries("platform", key, "active_wallets").catch(() => [] as SeriesPoint[]),
      readMetricSeries("platform", key, "trades").catch(() => [] as SeriesPoint[]),
      readMetricSeries("platform", key, "mcap_usd").catch(() => [] as SeriesPoint[]),
      readMetricSeries("platform", key, "gacha_volume_usd").catch(() => [] as SeriesPoint[]),
      readMetricSeries("platform", key, "holders").catch(() => [] as SeriesPoint[]),
    ]);
    return { volume, wallets, trades, mcap, gacha, holders };
  },
  // v2 (R5-1): v1 cached an empty mcap series from before the spine carried
  // per-platform mcap_usd; bumping the key forces a fresh read so the Market Cap
  // tab populates for Beezie + Collector Crypt.
  // v3: + gacha_volume_usd and holders — the Overview rail derives its gacha and
  // holders %Δ from these (no such delta field exists on PlatformDetail), and the
  // holders bar card plots them. BUMP THE KEY on any shape change here: v2 rows
  // have no `gacha`/`holders` and would deserialize as undefined.
  ["platform-activity-series:v3"],
  { revalidate: 3600, tags: ["platform-detail", "platform-buckets"] },
);

export { PLATFORM_SOURCES };
