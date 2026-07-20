import type { NormalizedSale } from "@/lib/rarible/queries";
import type { HomepagePayload, HotIP, IPRow, PlatformRow, TopSale, Trend } from "@/lib/types";
import {
  getBeezieMetadataCachedOnly,
  extractCategoryHints,
} from "./beezieTraits";
import { getCCMetadataCachedOnly } from "./ccTraits";
import { classifyIP, IP_CATALOG, OTHER_IP, type IPMeta } from "./ipCatalog";
import { type HourBucket } from "./history";
import { getPlatformBuckets, DAY, type PlatformBucket } from "./buckets";
import { PLATFORM_SOURCES } from "./sources";
import { readHolders, holdersForIp, holdersForPlatform } from "./holders";
import { readMarketCap, readMarketCapHistory, pctChangeOverHours } from "./marketcap";
import { readGachaDune } from "./gachaDuneCache";
import {
  readMetricSeriesBulk,
  sumLastCompleteDays,
  dayOverDayPct,
  DELTA_MIN_BASE_USD,
  pctChange as spinePctChange,
  type SeriesPoint,
} from "./metricSnapshots";
import { readSnapshot } from "../db/snapshots";
import { cardHref, cardSupported } from "@/lib/card/ids";

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

function spark24hFromSales(sales: NormalizedSale[], buckets = 24): number[] {
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

/** 7-day change (%) from a daily series: trailing-7-day sum vs the prior 7-day
 *  sum. null until ~2 weeks of daily data exist (so the teaser shows "—" honestly). */
function pct7dTrailing(daily: number[]): number | null {
  const vals = daily.filter((v) => Number.isFinite(v));
  if (vals.length < 14) return null;
  const last7 = vals.slice(-7).reduce((a, b) => a + b, 0);
  const prev7 = vals.slice(-14, -7).reduce((a, b) => a + b, 0);
  if (prev7 <= 0) return null;
  return ((last7 - prev7) / prev7) * 100;
}

function spark7dFromHistory(buckets: HourBucket[]): number[] {
  if (buckets.length === 0) return [];
  const macroSize = 6;
  const macroCount = Math.floor(buckets.length / macroSize);
  const out: number[] = [];
  for (let i = 0; i < macroCount; i++) {
    let v = 0;
    for (let j = 0; j < macroSize; j++) {
      v += buckets[i * macroSize + j]?.volumeUsd ?? 0;
    }
    out.push(v);
  }
  return out;
}

type AssetMeta = {
  name?: string;
  attributes?: Array<{ trait_type: string; value: string | number }>;
  image?: string;
};

/**
 * Top 5 single sales by USD across all platforms in the last 24h.
 * Looks up each top tokenId's cached metadata to resolve card name,
 * image, and canonical IP.
 */
async function buildTopSales(buckets: PlatformBucket[]): Promise<TopSale[]> {
  type Candidate = {
    platformKey: string;
    tokenId: string;
    priceUsd: number;
    date: string;
  };
  const allSales: Candidate[] = [];
  for (const b of buckets) {
    for (const s of b.sales24h) {
      allSales.push({
        platformKey: b.source.key,
        tokenId: s.tokenId,
        priceUsd: s.priceUsd,
        date: s.date,
      });
    }
  }
  // Sort by priceUsd desc, then dedupe by token so the same card can't appear
  // twice (a card that sold 2× would otherwise show as two identical cards).
  // First occurrence per token = its highest sale, since the list is sorted.
  allSales.sort((a, b) => b.priceUsd - a.priceUsd);
  const seenToken = new Set<string>();
  const candidates: Candidate[] = [];
  for (const s of allSales) {
    const key = `${s.platformKey}:${s.tokenId}`;
    if (seenToken.has(key)) continue;
    seenToken.add(key);
    candidates.push(s);
    if (candidates.length >= 30) break;
  }

  // Resolve metadata per platform
  const beezieIds = candidates.filter((c) => c.platformKey === "beezie").map((c) => c.tokenId);
  const ccIds = candidates.filter((c) => c.platformKey === "collector-crypt").map((c) => c.tokenId);
  const beezieMetas = await getBeezieMetadataCachedOnly(beezieIds);
  const ccMetas = await getCCMetadataCachedOnly(ccIds);

  const out: TopSale[] = [];
  for (const c of candidates) {
    let meta: AssetMeta | undefined;
    if (c.platformKey === "beezie") meta = beezieMetas.get(c.tokenId);
    else if (c.platformKey === "collector-crypt") meta = ccMetas.get(c.tokenId);
    if (!meta || !meta.name) continue;
    const ip = classifyIP(extractCategoryHints(meta));
    out.push({
      cardName: meta.name,
      ipName: ip.name,
      ipKey: ip.key,
      ipShort: ip.short,
      ipColor: ip.color,
      ipLogo: ip.logo,
      ipIconBlendMode: ip.iconBlendMode,
      ipEmoji: ip.emoji,
      priceUsd: c.priceUsd,
      image: meta.image ?? null,
      imageFallback:
        (meta as { imageFallback?: string }).imageFallback ?? null,
      platform: c.platformKey,
      tokenId: c.tokenId,
      date: c.date,
    });
    if (out.length >= 5) break;
  }
  return out;
}

async function buildAggregateIPRows(buckets: PlatformBucket[]): Promise<IPRow[]> {
  type Acc = {
    ip: IPMeta;
    sales: NormalizedSale[];
    holders: Set<string>;
    cardIds: Set<string>;
    platforms: Set<string>;
    topCard: { name: string; price: number; platform: string; tokenId: string } | null;
    trades: number;
  };
  const accByIp = new Map<string, Acc>();

  for (const b of buckets) {
    if (b.sales24h.length === 0) continue;
    let metas: Map<string, AssetMeta> = new Map();
    if (b.source.key === "beezie") {
      metas = await getBeezieMetadataCachedOnly(b.sales24h.map((s) => s.tokenId));
    } else if (b.source.key === "collector-crypt") {
      metas = await getCCMetadataCachedOnly(b.sales24h.map((s) => s.tokenId));
    }
    for (const sale of b.sales24h) {
      const meta = metas.get(sale.tokenId);
      const ip = meta ? classifyIP(extractCategoryHints(meta)) : classifyIP(["other"]);
      let acc = accByIp.get(ip.key);
      if (!acc) {
        acc = {
          ip,
          sales: [],
          holders: new Set(),
          cardIds: new Set(),
          platforms: new Set(),
          topCard: null,
          trades: 0,
        };
        accByIp.set(ip.key, acc);
      }
      acc.sales.push(sale);
      acc.holders.add(sale.buyer);
      acc.cardIds.add(sale.tokenId);
      acc.platforms.add(b.source.key);
      acc.trades += 1;
      if (meta?.name && (!acc.topCard || sale.priceUsd > acc.topCard.price)) {
        acc.topCard = {
          name: meta.name,
          price: sale.priceUsd,
          platform: b.source.key,
          tokenId: sale.tokenId,
        };
      }
    }
  }

  const rows: IPRow[] = [];
  for (const acc of accByIp.values()) {
    const vol24Usd = acc.sales.reduce((s, x) => s + x.priceUsd, 0);
    const spark = spark24hFromSales(acc.sales, 24);
    rows.push({
      rank: 0,
      key: acc.ip.key,
      name: acc.ip.name,
      short: acc.ip.short,
      color: acc.ip.color,
      logo: acc.ip.logo,
      iconBlendMode: acc.ip.iconBlendMode,
      emoji: acc.ip.emoji,
      cards: acc.cardIds.size,
      cardsTracked: NaN, // filled from the mcap rollup in the merge below
      platforms: acc.platforms.size,
      holders: NaN, // filled in below from .cache/holders.json
      buyers24h: acc.holders.size,
      trades24h: acc.trades,
      vol24Usd,
      vol7Usd: NaN,
      volTotalUsd: NaN,
      mcapUsd: NaN,
      pct7d: null,
      trend: trendOf(spark),
      spark,
      topCard: acc.topCard?.name ?? null,
      topCardHref:
        acc.topCard && cardSupported(acc.topCard.platform)
          ? cardHref(acc.topCard.platform, acc.topCard.tokenId)
          : null,
      floorUsd: NaN,
      insuredUsd: 0,
    });
  }

  rows.sort((a, b) => b.vol24Usd - a.vol24Usd);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** A zero-activity IP row seeded from the market-cap rollup (identity from the
 *  catalog; mcap/floor/holders filled by the caller). Lets an IP with a market
 *  cap but NO 24h trades (e.g. sports on a quiet day) still appear on the
 *  leaderboard, so the table reflects the whole byIp rollup, not just 24h sales.
 *  `cards` (24h-traded) is 0 — nothing traded; the collection size goes in
 *  `cardsTracked`, its own metric, so the two are never conflated (D10-2). */
function mcapOnlyIpRow(ip: IPMeta, cardsTracked: number): IPRow {
  return {
    rank: 0,
    key: ip.key,
    name: ip.name,
    short: ip.short,
    color: ip.color,
    logo: ip.logo,
    iconBlendMode: ip.iconBlendMode,
    emoji: ip.emoji,
    cards: 0,
    cardsTracked,
    platforms: 0,
    holders: NaN,
    buyers24h: 0,
    trades24h: 0,
    vol24Usd: 0,
    vol7Usd: NaN,
    volTotalUsd: NaN,
    mcapUsd: NaN,
    pct7d: null,
    trend: "flat",
    spark: [],
    topCard: null,
    topCardHref: null,
    floorUsd: NaN,
    insuredUsd: 0,
  };
}

/**
 * Σ-based 24h % change from a daily spine bulk (one metric across all platforms):
 * sum every platform's value per UTC day, then compare the latest COMPLETE day to
 * the prior one. Unlike a mean-of-per-platform-ratios (the old vol24Pct), this is a
 * true market-wide Σ change. The spine excludes today, so "24h" here = the most
 * recent complete-day-over-complete-day move — the best real prior period we have
 * (gacha has no hourly feed for a rolling prior-24h). null until 2 days exist / base ≤ 0.
 */
function bulkDayOverDayPct(bulk: Map<string, SeriesPoint[]>): number | null {
  const perDay = new Map<string, number>();
  for (const series of bulk.values()) {
    for (const p of series) {
      if (Number.isFinite(p.value)) perDay.set(p.ts, (perDay.get(p.ts) ?? 0) + p.value);
    }
  }
  const merged = [...perDay.entries()].map(([ts, value]) => ({ ts, value }));
  // Shared guarded comparator — floors the denominator so a near-zero prior day
  // can't print an absurd % (M4).
  return dayOverDayPct(merged, DELTA_MIN_BASE_USD);
}

/** Snapshot key for the precomputed homepage blob (written by scripts/warm-homepage.ts). */
export const HOMEPAGE_SNAPSHOT_KEY = "homepage-payload";

/**
 * Build the full homepage payload from the underlying snapshots + spine. This is
 * the EXPENSIVE aggregation (~15-20s cold: bulk spine reads + per-sale metadata
 * lookups) — it runs in the warmers (B9-1), not per request. `getBuckets` is
 * injectable so the warmer script can pass the uncached buildPlatformBuckets
 * (unstable_cache throws outside the Next server).
 */
export async function buildHomepagePayload(
  getBuckets: () => Promise<PlatformBucket[]> = getPlatformBuckets,
): Promise<HomepagePayload> {
  const [buckets, holders, mcap, mcapHist, gacha, platVolHist, platGachaHist] = await Promise.all([
    getBuckets(),
    readHolders(),
    readMarketCap(),
    readMarketCapHistory(),
    readGachaDune(),
    // Daily spine series for the platform teaser's Δ7d momentum — ~30d of history,
    // far deeper than the hourly buckets (which don't reach a full week).
    readMetricSeriesBulk("platform", "volume_usd"),
    readMetricSeriesBulk("platform", "gacha_volume_usd"),
  ]);

  // Δ7d = this platform's trailing-7d TOTAL activity (marketplace + gacha) vs the
  // prior 7 days, from the daily spine. Smooths the day-to-day spikiness a
  // point-vs-point change would show; null until ~2 weeks of history exist.
  const pct7dByPlatform = new Map<string, number | null>();
  for (const key of PLATFORM_SOURCES.map((s) => s.key)) {
    const merged = new Map<string, number>();
    for (const p of platVolHist.get(key) ?? []) merged.set(p.ts, (merged.get(p.ts) ?? 0) + p.value);
    for (const p of platGachaHist.get(key) ?? []) merged.set(p.ts, (merged.get(p.ts) ?? 0) + p.value);
    const daily = [...merged.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, v]) => v);
    pct7dByPlatform.set(key, pct7dTrailing(daily));
  }

  const platformRows: PlatformRow[] = buckets
    .map<PlatformRow>((b) => {
      // 7d = Σ the last 7 COMPLETE days of native `volume_usd` from the spine (B3).
      // Was `sumLast(b.history, 24*7)` — the Rarible-era blobs, which inflated Beezie
      // ~20-90× ("7d" $2.87M > its own 14d native total $126K). <7 recorded days → NaN → "—".
      const histVol7 = sumLastCompleteDays(platVolHist.get(b.source.key) ?? [], 7);
      const spark = b.history
        ? spark7dFromHistory(b.history)
        : spark24hFromSales(b.sales24h, 24);
      // Unique wallets (union of buyers + sellers) and cards traded in 24h.
      // Source: bucket.sales24h is the canonical 24h sale list.
      const wallets = new Set<string>();
      const cards = new Set<string>();
      for (const s of b.sales24h) {
        wallets.add(s.buyer);
        wallets.add(s.seller);
        cards.add(s.tokenId);
      }
      // ⚠️ These two are derived from sales24h, which is [] BOTH for a tracked
      // platform with a quiet 24h (a real 0) and for one we have no secondary
      // source for (unknown). Only `hasSecondarySource` separates them.
      const secondary = <T,>(v: T) => (b.hasSecondarySource ? v : NaN);
      // Gacha-only volume (excludes Courtyard's tokenization), for the
      // marketplace-vs-gacha split.
      const g = gacha?.platforms?.[b.source.key];
      const isGacha = !!g && g.kind === "gacha";
      return {
        rank: 0,
        key: b.source.key,
        name: b.source.name,
        short: b.source.short,
        chain: b.source.chain,
        vault: b.source.vault,
        vol24Usd: b.stats24h.volumeUsd,
        vol7Usd: histVol7,
        primaryUsd: b.primaryUsd ?? null,
        gachaVol24Usd: isGacha ? g!.vol24h : null,
        gachaVol7Usd: isGacha ? g!.vol7d : null,
        // Σ of the components we actually measure — unknown secondary counts as
        // 0 here, exactly as it did when it WAS 0, so this total is unchanged by
        // the honest-absence pass and keeps ranking a live platform on the
        // primary volume we do have. (Rendering "—" would sink Phygitals to the
        // bottom of the default sort and hide its very real gacha volume; the
        // Marketplace column is where its absence is stated.)
        total24Usd:
          (Number.isFinite(b.stats24h.volumeUsd) ? b.stats24h.volumeUsd : 0) + (b.primaryUsd ?? 0),
        active24h: secondary(wallets.size),
        cards: secondary(cards.size),
        holders: holdersForPlatform(holders, b.source.key),
        avgTradeUsd: b.stats24h.avgTradeUsd,
        pct7d: pct7dByPlatform.get(b.source.key) ?? null,
        spark,
        trend: trendOf(spark),
      };
    })
    // Rank by TOTAL 24h activity (resale + primary), not resale alone — otherwise
    // a gacha giant like Collector Crypt ($25K resale, $4.9M gacha) ranks below a
    // resale-churn platform. The split columns still show each lane separately.
    .sort((a, b) => b.total24Usd - a.total24Usd)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  const baseIpRows = await buildAggregateIPRows(buckets);
  // Union the 24h-traded IPs with EVERY IP that has a market cap in the rollup, so
  // an IP with mcap + holders but no trades today (e.g. baseball on a quiet day)
  // still appears with its real market cap — the leaderboard reflects the whole
  // readMarketCap byIp rollup, not just what changed hands in the last 24h.
  const tradedKeys = new Set(baseIpRows.map((r) => r.key));
  const rollupOnlyRows: IPRow[] = [];
  for (const [key, entry] of Object.entries(mcap?.byIp ?? {})) {
    if (tradedKeys.has(key) || !(entry.mcapUsd > 0)) continue;
    const ip = key === OTHER_IP.key ? OTHER_IP : IP_CATALOG.find((i) => i.key === key);
    if (ip) rollupOnlyRows.push(mcapOnlyIpRow(ip, entry.cards));
  }
  const ipRows = [...baseIpRows, ...rollupOnlyRows]
    .map((r) => {
      const entry = mcap?.byIp?.[r.key];
      return {
        ...r,
        holders: holdersForIp(holders, r.key),
        mcapUsd: entry?.mcapUsd ?? NaN,
        floorUsd: entry?.floorUsd ?? NaN,
        insuredUsd: entry?.insuredUsd ?? 0,
        // Total collection size from the rollup — its own column (D10-2). Traded
        // rows get it here; mcap-only rows already carry it. NaN when unknown.
        cardsTracked: entry?.cards ?? r.cardsTracked ?? NaN,
      };
    })
    // Sort by Market Cap desc. NaN (no mcap data yet) sinks to the bottom.
    .sort((a, b) => {
      const av = Number.isFinite(a.mcapUsd) ? a.mcapUsd : -Infinity;
      const bv = Number.isFinite(b.mcapUsd) ? b.mcapUsd : -Infinity;
      return bv - av;
    })
    .map((r, i) => ({ ...r, rank: i + 1 }));

  // Per-IP market-cap change (1d/7d/30d) from the spine, for the leaderboard Δ
  // columns. One bulk query; null where the spine lacks that much history.
  const ipMcapHist = await readMetricSeriesBulk("ip", "mcap_usd");
  const ips: IPRow[] = ipRows.map((r) => {
    const s = ipMcapHist.get(r.key) ?? [];
    return { ...r, pct1d: spinePctChange(s, 1), pct7d: spinePctChange(s, 7), pct30d: spinePctChange(s, 30) };
  });

  // Hottest IPs: top 3 by 24h volume.
  const hotIPs: HotIP[] = [...baseIpRows]
    .sort((a, b) => b.vol24Usd - a.vol24Usd)
    .slice(0, 3)
    .map((r, i) => ({
      rank: i + 1,
      key: r.key,
      name: r.name,
      short: r.short,
      color: r.color,
      logo: r.logo,
      iconBlendMode: r.iconBlendMode,
      emoji: r.emoji,
      vol24Usd: r.vol24Usd,
      buyers24h: r.buyers24h,
      spark: r.spark,
      trend: r.trend,
    }));

  const topSales = await buildTopSales(buckets);

  // Σ SKIPS untracked platforms rather than being poisoned by them. An untracked
  // platform's stats are NaN (unknownStats) — without this guard a single one
  // turns the whole market's headline volume into NaN → "—". Skipping keeps
  // these totals byte-identical to when they were 0s: Σ over the platforms we
  // actually measure, which is what they always were.
  const fin = (n: number) => (Number.isFinite(n) ? n : 0);
  const sumVol24 = buckets.reduce((s, b) => s + fin(b.stats24h.volumeUsd), 0);
  const sumTrades24 = buckets.reduce((s, b) => s + fin(b.stats24h.salesCount), 0);
  // Hero 7d = Σ each TRACKED platform's last-7-complete-day native total (B3; was the
  // Rarible `readHistory` blobs). A platform with NO secondary source (Phygitals)
  // contributes nothing and doesn't block — its marketplace volume is definitionally
  // absent, not missing. If a TRACKED platform lacks 7 recorded days the market total
  // is unknowable → NaN → "—" rather than a silently-short sum.
  const trackedVol7 = buckets
    .filter((b) => b.hasSecondarySource)
    .map((b) => sumLastCompleteDays(platVolHist.get(b.source.key) ?? [], 7));
  const has7dForAll = trackedVol7.length > 0 && trackedVol7.every((v) => Number.isFinite(v));
  const sumVol7 = has7dForAll ? trackedVol7.reduce((s, v) => s + v, 0) : NaN;

  // Marketplace + gacha 24h %Δ — real Σ-based day-over-day from the daily spine
  // (replaces the old mean-of-per-platform-ratios, which was statistically wrong and
  // null unless every platform had 7d of hourly history). platVolHist/platGachaHist
  // are the per-platform daily series already read above.
  const vol24Pct = bulkDayOverDayPct(platVolHist);
  const gachaVol24Pct = bulkDayOverDayPct(platGachaHist);
  // Gacha 24h volume LEVEL = Σ each platform's gacha-only vol24h (mirrors the
  // homepage volume-split; pairs with gachaVol24Pct so the /ips metric cell is
  // self-contained). Marketplace level is already `vol24Usd` (= sumVol24).
  const gachaVol24Usd = platformRows.reduce((s, p) => s + (p.gachaVol24Usd ?? 0), 0);

  // Hero aggregates from the disk caches we already populated.
  // A stale/empty marketcap snapshot can report totals of 0 — which must NEVER
  // surface as a "$0.00" headline. Fall back to the most recent non-zero hourly
  // history snapshot (last-known good); the freshness chip already discloses the
  // "as of" age. Only drops to "—" if we have never recorded a value.
  const currentMcap = mcap?.totals?.mcapUsd ?? NaN;
  // Last-known-good hourly mcap + its timestamp, so we can disclose the age when we
  // fall back to it (X4) rather than showing a stale value unlabeled.
  const lastKnown = (() => {
    for (let i = mcapHist.hourly.length - 1; i >= 0; i--) {
      const h = mcapHist.hourly[i];
      if (h && Number.isFinite(h.totalMcapUsd) && h.totalMcapUsd > 0) return h;
    }
    return null;
  })();
  const usingFallback = !(currentMcap > 0);
  const totalMcapUsd = usingFallback ? (lastKnown?.totalMcapUsd ?? NaN) : currentMcap;
  // Age (hours) of the mcap figure when it's the stale fallback; null when live.
  const mcapAgeHours =
    usingFallback && lastKnown?.at
      ? Math.max(0, Math.round((Date.now() - Date.parse(lastKnown.at)) / 3_600_000))
      : null;
  // As-of timestamp of the DISPLAYED market cap value (fallback-aware): the live
  // snapshot's generatedAt, or the last-known hourly point's `at` when we fell
  // back to it. This — not `updatedAt` — is what the overview stale-guard reads,
  // because in the AF-1 degrade the snapshot regenerates fresh (recent
  // generatedAt) but empty, and the number on screen is actually the older
  // last-known value; its true age is `lastKnown.at`.
  const mcapAsOf = usingFallback ? (lastKnown?.at ?? null) : (mcap?.generatedAt ?? null);
  const rawTotalCards = mcap
    ? Object.values(mcap.byIp).reduce((s, e) => s + e.cards, 0)
    : NaN;
  // Never headline "0 cards" — treat an empty snapshot as unknown ("—").
  const totalCards = rawTotalCards > 0 ? rawTotalCards : NaN;
  // TRUE cross-platform unique holders (X2) — the warmer unions CC+Phygitals (both
  // Solana) instead of summing, so a wallet on both isn't double-counted. Older
  // snapshots without `totalHolders` fall back to the per-platform sum.
  const totalHolders = holders
    ? holders.totalHolders ?? Object.values(holders.platforms).reduce((s, n) => s + n, 0)
    : NaN;

  // Mcap 24h change: diff vs ~24h-old snapshot in .cache/marketcap-history.json.
  // Returns null if history is too thin or oldest snapshot is malformed.
  const mcapPct24h = pctChangeOverHours(mcapHist, 24);

  // Use the latest snapshot's timestamp for the "Live · Xs ago" indicator,
  // not render time. Falls back to render time if no snapshot yet.
  const dataUpdatedAt =
    mcap?.generatedAt ?? holders?.generatedAt ?? new Date().toISOString();

  // ── Homepage stat-card sparklines ───────────────────────────────────
  // Market cap: recent non-zero hourly totals (oldest→newest).
  const mcapSpark = mcapHist.hourly
    .map((h) => h.totalMcapUsd)
    .filter((v) => Number.isFinite(v) && v > 0)
    .slice(-40);
  // Total volume: sum every platform's hourly buckets by hourStart, last 24h.
  const volByHour = new Map<string, number>();
  for (const b of buckets) {
    for (const h of b.history ?? []) {
      volByHour.set(h.hourStart, (volByHour.get(h.hourStart) ?? 0) + h.volumeUsd);
    }
  }
  const volSpark = [...volByHour.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-24)
    .map(([, v]) => v);

  return {
    hero: {
      mcapSpark,
      volSpark,
      vol24Usd: sumVol24,
      trades24h: sumTrades24,
      platformsTracked: PLATFORM_SOURCES.length,
      ipsTracked: ipRows.length,
      updatedAt: dataUpdatedAt,
      totalMcapUsd,
      /** Non-null only when totalMcapUsd is the stale last-known fallback — the UI
       *  appends "(~Xh old)" so a stale market cap isn't shown as if it were live (X4). */
      mcapAgeHours,
      /** As-of timestamp of the displayed market cap; the overview stale-guard
       *  (>36h) on / and /ips reads this to show "as of <Mon DD>". */
      mcapAsOf,
      vol7Usd: has7dForAll ? sumVol7 : NaN,
      totalCards,
      holders: totalHolders,
      mcapPct24h,
      vol24Pct,
      /** 24h gacha-pull volume (Σ each platform's gacha vol24h) + its Σ-based day-over-day %Δ. */
      gachaVol24Usd,
      gachaVol24Pct,
      vol7Pct: null,
      holdersPct7d: null,
      trades24hPct: null,
    },
    hotIPs,
    topSales,
    ips,
    platforms: platformRows,
  };
}

// The payload uses NaN as the "no data yet" sentinel (holders, mcap, vol7…), but
// JSONB can't hold NaN — the snapshot round-trip turns it into null. Revive the
// known NaN-able numeric fields so consumers see the exact shape the live builder
// returns (sort comparators coerce null to 0, which would mis-rank missing data).
const nn = (v: unknown): number => (typeof v === "number" ? v : NaN);

function reviveHomepagePayload(p: HomepagePayload): HomepagePayload {
  return {
    ...p,
    hero: {
      ...p.hero,
      totalMcapUsd: nn(p.hero.totalMcapUsd),
      vol7Usd: nn(p.hero.vol7Usd),
      totalCards: nn(p.hero.totalCards),
      holders: nn(p.hero.holders),
    },
    ips: p.ips.map((r) => ({
      ...r,
      holders: nn(r.holders),
      cardsTracked: nn(r.cardsTracked),
      vol7Usd: nn(r.vol7Usd),
      volTotalUsd: nn(r.volTotalUsd),
      mcapUsd: nn(r.mcapUsd),
      floorUsd: nn(r.floorUsd),
    })),
    platforms: p.platforms.map((r) => ({
      ...r,
      vol7Usd: nn(r.vol7Usd),
      holders: nn(r.holders),
      avgTradeUsd: nn(r.avgTradeUsd),
      // Untracked-secondary fields (Phygitals) are NaN at build time and come
      // back from JSONB as null. They MUST be revived: null is not NaN, and
      // `null + x` silently evaluates to x — which is the exact 0-coercion this
      // whole honest-absence pass exists to remove.
      vol24Usd: nn(r.vol24Usd),
      active24h: nn(r.active24h),
      cards: nn(r.cards),
    })),
  };
}

/**
 * Homepage payload — ONE snapshot-row read (B9-1). The warmers precompute the
 * whole payload every cycle (scripts/warm-homepage.ts, core + daily batches);
 * this fixes the 14–22s cold render the live aggregation caused. Falls back to
 * building live only when the blob has never been written (fresh DB / dev),
 * so the page keeps working before the first warm.
 */
export async function fetchHomepage(): Promise<HomepagePayload> {
  const snap = await readSnapshot<HomepagePayload>(HOMEPAGE_SNAPSHOT_KEY);
  if (snap?.hero && Array.isArray(snap.ips) && Array.isArray(snap.platforms)) {
    return reviveHomepagePayload(snap);
  }
  return buildHomepagePayload();
}
