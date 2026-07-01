import { unstable_cache } from "next/cache";
import type { NormalizedSale } from "@/lib/rarible/queries";
import { getPlatformBuckets, type PlatformBucket } from "./buckets";
import { getBeezieMetadataCachedOnly, extractCategoryHints } from "./beezieTraits";
import { getCCMetadataCachedOnly } from "./ccTraits";
import { classifyIP, IP_CATALOG, OTHER_IP, type IPMeta } from "./ipCatalog";
import { normalizeTraits, gradeLabel, type NormalizedTraits } from "./traits";
import { readIpHistory, sumLast, pctChange } from "./history";
import { readMetricSeries, type SeriesPoint } from "./metricSnapshots";
import type { TokenMetadata } from "@/lib/onchain/tokenUri";
import type { Trend } from "@/lib/types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export type EnrichedSale = NormalizedSale & {
  platform: "beezie" | "collector-crypt";
  meta: TokenMetadata;
  traits: NormalizedTraits;
};

export type SetRow = {
  rank: number;
  name: string;
  cards: number;
  trades: number;
  vol24Usd: number;
  avgTradeUsd: number;
  topCard: string | null;
};

export type GradeRow = {
  rank: number;
  label: string;
  grader: string | null;
  gradeNum: number | null;
  cards: number;
  trades: number;
  vol24Usd: number;
  avgTradeUsd: number;
};

export type CardRow = {
  rank: number;
  name: string;
  set: string | null;
  grade: string;
  platform: "beezie" | "collector-crypt";
  tokenId: string;
  trades: number;
  vol24Usd: number;
  topPriceUsd: number;
  image?: string;
};

export type IPRecentSale = {
  date: string;
  platform: "beezie" | "collector-crypt";
  cardName: string | null;
  priceUsd: number;
  buyer: string;
  seller: string;
  tokenId: string;
  image?: string;
};

/** Per-platform split of an IP's 24h trading — which marketplace drives it. */
export type IPPlatformSplit = {
  platform: "beezie" | "collector-crypt";
  vol24Usd: number;
  trades24h: number;
  buyers24h: number;
  /** Share of the IP's 24h volume on this platform (0–1). */
  share: number;
};

export type IPDetail = {
  ip: IPMeta;
  rank: number; // among all IPs by 24h volume
  // Hero stats
  vol24Usd: number;
  vol24Pct: number | null;
  /** 7d secondary volume (from history:by-ip); null until the per-IP history warmer has run. */
  vol7Usd: number | null;
  trades24h: number;
  uniqueCards: number;
  uniqueBuyers: number;
  uniqueSellers: number;
  uniqueWallets: number; // buyers ∪ sellers — the "Active" metric
  uniquePlatforms: number;
  /** Share of buy-side volume going to the dominant buyer (0-1).
   *  >0.7 → likely a buyback bot. */
  buybackConcentration: number;
  avgTradeUsd: number;
  highSaleUsd: number;
  lowSaleUsd: number;
  totalMcapUsd: number;
  spark24h: number[];
  trend: Trend;
  sets: SetRow[];
  grades: GradeRow[];
  topCards: CardRow[];
  hourlyVol: number[];
  /** Latest purchases for this IP across platforms, newest first. */
  recentSales: IPRecentSale[];
  /** Per-platform split of this IP's 24h trading (which platform drives it). */
  byPlatform: IPPlatformSplit[];
};

function spark24h(sales: NormalizedSale[], buckets = 24): number[] {
  const out = new Array<number>(buckets).fill(0);
  // Anchor the 24h window to the NEWEST sale, not wall-clock now — the sales come
  // from a cached snapshot that can lag real time, so windowing against Date.now()
  // flatlines the chart at $0 once the snapshot is >24h old (QA-2). Bucketing over
  // the data's own last-24h keeps the intraday curve real.
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

async function enrichSales(buckets: PlatformBucket[]): Promise<EnrichedSale[]> {
  const out: EnrichedSale[] = [];
  for (const b of buckets) {
    if (b.sales24h.length === 0) continue;
    let metas: Map<string, TokenMetadata> = new Map();
    if (b.source.key === "beezie") {
      metas = await getBeezieMetadataCachedOnly(b.sales24h.map((s) => s.tokenId));
    } else if (b.source.key === "collector-crypt") {
      metas = await getCCMetadataCachedOnly(b.sales24h.map((s) => s.tokenId));
    }
    for (const sale of b.sales24h) {
      const meta = metas.get(sale.tokenId);
      if (!meta) continue;
      out.push({
        ...sale,
        platform: b.source.key as "beezie" | "collector-crypt",
        meta,
        traits: normalizeTraits(meta),
      });
    }
  }
  return out;
}

export async function fetchIP(ipKey: string): Promise<IPDetail | null> {
  // "other" is the catch-all classification bucket. Surfaces on the homepage
  // and IP list but isn't a member of IP_CATALOG, so accept it explicitly.
  const ip =
    ipKey === OTHER_IP.key
      ? OTHER_IP
      : IP_CATALOG.find((i) => i.key === ipKey) ?? null;
  if (!ip) return null;

  const buckets = await getPlatformBuckets();
  const enriched = await enrichSales(buckets);

  // Filter to this IP using the same classification logic as homepage.
  const mine: EnrichedSale[] = [];
  for (const e of enriched) {
    const cls = classifyIP(extractCategoryHints(e.meta));
    if (cls.key === ipKey) mine.push(e);
  }

  // Determine rank among IPs (from homepage's cross-IP order)
  const allIpVols = new Map<string, number>();
  for (const e of enriched) {
    const cls = classifyIP(extractCategoryHints(e.meta));
    allIpVols.set(cls.key, (allIpVols.get(cls.key) ?? 0) + e.priceUsd);
  }
  const sortedIps = [...allIpVols.entries()].sort((a, b) => b[1] - a[1]);
  const rank = sortedIps.findIndex(([k]) => k === ipKey) + 1;

  if (mine.length === 0) {
    return {
      ip,
      rank: rank || sortedIps.length + 1,
      vol24Usd: 0,
      vol24Pct: null,
      vol7Usd: null,
      trades24h: 0,
      uniqueCards: 0,
      uniqueBuyers: 0,
      uniqueSellers: 0,
      uniqueWallets: 0,
      uniquePlatforms: 0,
      buybackConcentration: 0,
      avgTradeUsd: 0,
      highSaleUsd: 0,
      lowSaleUsd: 0,
      totalMcapUsd: 0,
      spark24h: new Array(24).fill(0),
      trend: "flat",
      sets: [],
      grades: [],
      topCards: [],
      hourlyVol: new Array(24).fill(0),
      recentSales: [],
      byPlatform: [],
    };
  }

  const vol24Usd = mine.reduce((s, e) => s + e.priceUsd, 0);
  const trades24h = mine.length;
  const uniqueCards = new Set(mine.map((e) => e.tokenId)).size;
  const buyersSet = new Set(mine.map((e) => e.buyer));
  const sellersSet = new Set(mine.map((e) => e.seller));
  const walletsSet = new Set([...buyersSet, ...sellersSet]);
  const uniqueBuyers = buyersSet.size;
  const uniqueSellers = sellersSet.size;
  const uniqueWallets = walletsSet.size;
  const uniquePlatforms = new Set(mine.map((e) => e.platform)).size;

  // Concentration of buy-side volume on the top buyer.
  const buyerVol = new Map<string, number>();
  for (const e of mine) buyerVol.set(e.buyer, (buyerVol.get(e.buyer) ?? 0) + e.priceUsd);
  const topBuyerVol = [...buyerVol.values()].sort((a, b) => b - a)[0] ?? 0;
  const buybackConcentration = vol24Usd > 0 ? topBuyerVol / vol24Usd : 0;

  const prices = mine.map((e) => e.priceUsd);
  const highSaleUsd = Math.max(...prices);
  const lowSaleUsd = Math.min(...prices);

  // Mcap proxy: sum of insured values for cards seen (not strictly accurate
  // — it's restricted to cards traded in the window — but a useful signal).
  const totalMcapUsd = mine.reduce(
    (s, e) => s + (e.traits.insuredValueUsd ?? 0),
    0,
  );

  const sparkBuckets = spark24h(mine, 24);

  // ─── Group: Sets ───────────────────────────────────────────────
  type SetAcc = {
    name: string;
    sales: EnrichedSale[];
    cards: Set<string>;
    topCard: { name: string; price: number } | null;
  };
  const setMap = new Map<string, SetAcc>();
  for (const e of mine) {
    const setName = e.traits.set ?? "Unknown set";
    let acc = setMap.get(setName);
    if (!acc) {
      acc = { name: setName, sales: [], cards: new Set(), topCard: null };
      setMap.set(setName, acc);
    }
    acc.sales.push(e);
    acc.cards.add(e.tokenId);
    const display = e.traits.cardName ?? e.meta.name ?? "";
    if (display && (!acc.topCard || e.priceUsd > acc.topCard.price)) {
      acc.topCard = { name: display, price: e.priceUsd };
    }
  }
  const sets: SetRow[] = [...setMap.values()]
    .map((acc) => {
      const v = acc.sales.reduce((s, e) => s + e.priceUsd, 0);
      return {
        rank: 0,
        name: acc.name,
        cards: acc.cards.size,
        trades: acc.sales.length,
        vol24Usd: v,
        avgTradeUsd: v / acc.sales.length,
        topCard: acc.topCard?.name ?? null,
      };
    })
    .sort((a, b) => b.vol24Usd - a.vol24Usd)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  // ─── Group: Grades ─────────────────────────────────────────────
  type GradeAcc = {
    label: string;
    grader: string | null;
    gradeNum: number | null;
    sales: EnrichedSale[];
    cards: Set<string>;
  };
  const gradeMap = new Map<string, GradeAcc>();
  for (const e of mine) {
    const label = gradeLabel(e.traits);
    let acc = gradeMap.get(label);
    if (!acc) {
      acc = {
        label,
        grader: e.traits.grader,
        gradeNum: e.traits.gradeNum,
        sales: [],
        cards: new Set(),
      };
      gradeMap.set(label, acc);
    }
    acc.sales.push(e);
    acc.cards.add(e.tokenId);
  }
  const grades: GradeRow[] = [...gradeMap.values()]
    .map((acc) => {
      const v = acc.sales.reduce((s, e) => s + e.priceUsd, 0);
      return {
        rank: 0,
        label: acc.label,
        grader: acc.grader,
        gradeNum: acc.gradeNum,
        cards: acc.cards.size,
        trades: acc.sales.length,
        vol24Usd: v,
        avgTradeUsd: v / acc.sales.length,
      };
    })
    .sort((a, b) => b.vol24Usd - a.vol24Usd)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  // ─── Group: Top Cards (by display name) ────────────────────────
  type CardAcc = {
    name: string;
    set: string | null;
    grade: string;
    platform: "beezie" | "collector-crypt";
    tokenId: string;
    sales: EnrichedSale[];
    image?: string;
  };
  const cardMap = new Map<string, CardAcc>();
  for (const e of mine) {
    const display = e.meta.name ?? e.traits.cardName ?? `${e.tokenId.slice(0, 10)}…`;
    const key = `${e.platform}:${e.tokenId}`;
    let acc = cardMap.get(key);
    if (!acc) {
      acc = {
        name: display,
        set: e.traits.set,
        grade: gradeLabel(e.traits),
        platform: e.platform,
        tokenId: e.tokenId,
        sales: [],
        image: e.meta.image,
      };
      cardMap.set(key, acc);
    }
    acc.sales.push(e);
  }
  const topCards: CardRow[] = [...cardMap.values()]
    .map((acc) => {
      const v = acc.sales.reduce((s, e) => s + e.priceUsd, 0);
      const top = acc.sales.reduce((m, e) => (e.priceUsd > m ? e.priceUsd : m), 0);
      return {
        rank: 0,
        name: acc.name,
        set: acc.set,
        grade: acc.grade,
        platform: acc.platform,
        tokenId: acc.tokenId,
        trades: acc.sales.length,
        vol24Usd: v,
        topPriceUsd: top,
        image: acc.image,
      };
    })
    .sort((a, b) => b.vol24Usd - a.vol24Usd)
    .slice(0, 50)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  // ─── Latest purchases (newest first) ───────────────────────────
  const recentSales: IPRecentSale[] = [...mine]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 50)
    .map((e) => ({
      date: e.date,
      platform: e.platform,
      cardName: e.meta.name ?? e.traits.cardName ?? null,
      priceUsd: e.priceUsd,
      buyer: e.buyer,
      seller: e.seller,
      tokenId: e.tokenId,
      image: e.meta.image,
    }));

  // ─── Per-platform split of this IP's 24h volume ────────────────
  type PlatAcc = { vol: number; trades: number; buyers: Set<string> };
  const platMap = new Map<"beezie" | "collector-crypt", PlatAcc>();
  for (const e of mine) {
    let acc = platMap.get(e.platform);
    if (!acc) {
      acc = { vol: 0, trades: 0, buyers: new Set() };
      platMap.set(e.platform, acc);
    }
    acc.vol += e.priceUsd;
    acc.trades += 1;
    acc.buyers.add(e.buyer);
  }
  const byPlatform: IPPlatformSplit[] = [...platMap.entries()]
    .map(([platform, acc]) => ({
      platform,
      vol24Usd: acc.vol,
      trades24h: acc.trades,
      buyers24h: acc.buyers.size,
      share: vol24Usd > 0 ? acc.vol / vol24Usd : 0,
    }))
    .sort((a, b) => b.vol24Usd - a.vol24Usd);

  // 7d volume + 24h-over-prior-24h change from the per-IP history blob.
  const ipHist = await readIpHistory();
  const histBuckets = ipHist?.byIp?.[ipKey] ?? null;
  const vol7Usd = histBuckets ? sumLast(histBuckets, 168).volumeUsd : null;
  const vol24Pct = histBuckets ? pctChange(histBuckets, 24) : null;

  return {
    ip,
    rank: rank || sortedIps.length + 1,
    vol24Usd,
    vol24Pct,
    vol7Usd,
    trades24h,
    uniqueCards,
    uniqueBuyers,
    uniqueSellers,
    uniqueWallets,
    uniquePlatforms,
    buybackConcentration,
    avgTradeUsd: vol24Usd / trades24h,
    highSaleUsd,
    lowSaleUsd,
    totalMcapUsd,
    spark24h: sparkBuckets,
    trend: trendOf(sparkBuckets),
    sets,
    grades,
    topCards,
    hourlyVol: sparkBuckets,
    recentSales,
    byPlatform,
  };
}

export const getIPDetail = unstable_cache(
  async (ipKey: string) => fetchIP(ipKey),
  ["ip-detail:v7"], // v7: spark24h anchors to newest sale (QA-2)
  { revalidate: 3600, tags: ["ip-detail"] },
);

/**
 * Activity-chart daily series for an IP (metric_snapshots spine) + the market mcap
 * baseline for the "IP vs market" index. Cached so the IP page reads them through
 * ONE memoized call instead of 6 uncached `readMetricSeries` round-trips per request
 * (R2-B1 perf). 1h revalidate + "ip-detail" tag, matching getIPDetail.
 */
export const getIPActivitySeries = unstable_cache(
  async (
    key: string,
  ): Promise<{
    volume: SeriesPoint[];
    mcap: SeriesPoint[];
    wallets: SeriesPoint[];
    trades: SeriesPoint[];
    cards: SeriesPoint[];
    marketMcap: SeriesPoint[];
  }> => {
    const [volume, mcap, wallets, trades, cards, marketMcap] = await Promise.all([
      readMetricSeries("ip", key, "volume_usd").catch(() => [] as SeriesPoint[]),
      readMetricSeries("ip", key, "mcap_usd").catch(() => [] as SeriesPoint[]),
      readMetricSeries("ip", key, "active_wallets").catch(() => [] as SeriesPoint[]),
      readMetricSeries("ip", key, "trades").catch(() => [] as SeriesPoint[]),
      readMetricSeries("ip", key, "cards_traded").catch(() => [] as SeriesPoint[]),
      readMetricSeries("market", "total", "mcap_usd").catch(() => [] as SeriesPoint[]),
    ]);
    return { volume, mcap, wallets, trades, cards, marketMcap };
  },
  ["ip-activity-series:v1"],
  { revalidate: 3600, tags: ["ip-detail"] },
);
