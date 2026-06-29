/**
 * Gacha-page payload builder.
 *
 * Reads .cache/gacha-dune.json (populated by `npm run warm-gacha-dune` from
 * the Dune backend) and joins it with PLATFORM_SOURCES so the /gacha route
 * gets one ready-to-render object: per-platform totals + pack-price breakdown
 * + aggregate stats.
 *
 * Dune replaced the old RPC-derived primary-revenue numbers — the free RPC
 * tier severely undercounted (it hit pagination caps); Dune scans the full
 * chain in seconds.
 */
import { unstable_cache } from "next/cache";
import { PLATFORM_SOURCES, type PlatformSource } from "./sources";
import {
  readGachaDune,
  type GachaDunePlatform,
  type GachaDuneSnapshot,
  type GachaOddsTier,
  type GachaOddsMeta,
  type GachaBigHit,
} from "./gachaDuneCache";
import { readPhygitalsGacha, type PhygitalsGachaSnapshot } from "./phygitalsGachaCache";
import { readCCGacha } from "./ccGachaCache";
import { readGachaLive } from "./gachaLiveCache";
import {
  readGachaPacks,
  type GachaPack,
  type GachaPacksSnapshot,
  type GachaPrize,
} from "./gachaPacksCache";
import { leadMedian, THIN_N } from "./gachaPackView";
import type { Chain } from "@/lib/types";

/** Max price tiers surfaced per platform (Phygitals alone has 157). */
const MAX_TIERS_PER_PLATFORM = 12;

export type GachaAmountBucket = {
  /** Pack price in USD (integer; matches `validAmounts` for CC, rounded otherwise). */
  amount: number;
  count: number;
  vol: number;
  /** This bucket's share of platform 24h volume (0–1). */
  share: number;
};

export type GachaPlatformRow = {
  rank: number;
  key: string;
  name: string;
  short: string;
  chain: Chain;
  /** "gacha" = randomized pull mechanic; "tokenization" = pay-to-vault (Courtyard). */
  kind: "gacha" | "tokenization";
  /** Pack prices the platform supports (from sources.ts `validAmounts`).
   *  Empty if the platform doesn't constrain pack prices. */
  packPrices: number[];
  /** Total pulls + volume over 24h and 7d. */
  pulls24h: number;
  pulls7d: number | null;
  vol24Usd: number;
  vol7Usd: number | null;
  avgPullUsd: number;
  /** Per-pack-price breakdown for the 24h window, top tiers by volume. */
  byAmount24h: GachaAmountBucket[];
  /** Realized odds (best→commonest). CC: rarity tiers; Phygitals: prize-value bands. */
  odds: GachaOddsTier[] | null;
  /** Provenance for `odds` (window + basis), so the UI never mislabels the source. */
  oddsMeta: GachaOddsMeta | null;
  /** Realized EV = value retained per $1 (mean prize FMV / price). Phygitals only, from the CLAW feed. */
  realizedEvMultiple: number | null;
  // ── Buyback / house economics (7d). null where buyback isn't tracked on-chain. ──
  buybackPayout7d: number | null;
  netRevenue7d: number | null;
  houseTakePct: number | null;
  /** Share of pulls instantly cashed out (count/pulls). May exceed 1 if the
   *  wallet does non-buyback payouts — the UI hides it when implausible. */
  buybackRate7d: number | null;
  /** Whether the 7d figures are complete. Always true with Dune (full scan). */
  complete7d: boolean;
  /** When set, surfaced as a banner on the row. */
  warning?: string;
};

/**
 * One pull-PRICE BUCKET on one platform (Dune-volume derived). Distinct from the
 * rich `GachaPack` (the per-pack catalog with top-hits/odds/EV) — this is just
 * the 24h pull distribution by price, used by the platform deep-dive bars.
 */
export type GachaPackBucket = {
  /** Stable id for React keys: `<platformKey>:<amount>` */
  id: string;
  platformKey: string;
  platformName: string;
  platformShort: string;
  chain: Chain;
  /** Price tier in USD. */
  amount: number;
  /** Whether this is a canonical pack price (declared in sources.ts) or just an observed amount. */
  canonical: boolean;
  pulls24h: number;
  vol24Usd: number;
  /** Share of platform 24h pull volume (0–1). */
  share: number;
};

export type GachaPayload = {
  generatedAt: string | null;
  hero: {
    totalVol24Usd: number;
    totalPulls24h: number;
    avgPullUsd: number;
    platformsWithData: number;
    topPlatformName: string | null;
    topPlatformVolUsd: number;
    /** Will populate once NFT-matching warmer ships. */
    biggestHitUsd: number | null;
    /** Best measured TYPICAL return (median × buyback, non-thin sample) across
     *  the pack catalog — any platform with realized per-pack data. */
    bestEvPackId: string | null;
    bestEvMultiple: number | null;
    bestEvPlatform: string | null;
  };
  platforms: GachaPlatformRow[];
  /** 24h pull distribution by price tier (platform deep-dive bars). */
  packBuckets: GachaPackBucket[];
  /** The pack-centric catalog — every purchasable pack across sites with its OWN
   *  top-hit / odds / EV / floor / buyback. The heart of the comparison. */
  packs: GachaPack[];
  /** Honest window the realized side of `packs` rests on. */
  packsWindow: GachaPacksSnapshot["window"] | null;
  /** Every prize in an ADVERTISED pool (Phygitals chase + Beezie grail tiers) —
   *  the searchable "find your chase" index. CC publishes no pool. */
  prizes: GachaPrize[];
  /** Biggest hits (high-FMV prizes), ranked desc. */
  bigHits: GachaBigHit[];
};

function rowFor(source: PlatformSource, entry: GachaDunePlatform | undefined): GachaPlatformRow {
  const kind = entry?.kind ?? "gacha";
  const vol24Usd = entry?.vol24h ?? 0;
  const pulls24h = entry?.pulls24h ?? 0;
  const avgPullUsd = pulls24h > 0 ? vol24Usd / pulls24h : 0;

  // Top tiers by 24h volume (capped). Totals stay full — only the display
  // breakdown is trimmed. Share is against the FULL platform 24h volume.
  const byAmount24h: GachaAmountBucket[] = (entry?.byPrice ?? [])
    .slice()
    .sort((a, b) => b.vol24h - a.vol24h)
    .slice(0, MAX_TIERS_PER_PLATFORM)
    .map((b) => ({
      amount: b.price,
      count: b.pulls24h,
      vol: b.vol24h,
      share: vol24Usd > 0 ? b.vol24h / vol24Usd : 0,
    }));

  // Canonical pack ladder (CC only); variable-price platforms have none.
  const packPrices = source.primary?.validAmounts ?? [];

  let warning: string | undefined;
  if (!entry) {
    warning = "Not yet populated — run `npm run warm-gacha-dune`.";
  } else if (kind === "tokenization") {
    warning = "Tokenization, not a randomized pull.";
  }

  // Buyback / house economics (7d).
  const vol7d = entry?.vol7d ?? 0;
  const pulls7dVal = entry?.pulls7d ?? 0;
  const bb = entry?.buyback;
  const buybackPayout7d = bb ? bb.payout7d : null;
  const netRevenue7d = bb ? vol7d - bb.payout7d : null;
  const houseTakePct = bb && vol7d > 0 ? (vol7d - bb.payout7d) / vol7d : null;
  const buybackRate7d = bb && pulls7dVal > 0 ? bb.count7d / pulls7dVal : null;

  return {
    rank: 0,
    key: source.key,
    name: source.name,
    short: source.short,
    chain: source.chain,
    kind,
    packPrices,
    pulls24h,
    pulls7d: entry?.pulls7d ?? null,
    vol24Usd,
    vol7Usd: entry?.vol7d ?? null,
    avgPullUsd,
    byAmount24h,
    odds: entry?.odds ?? null,
    oddsMeta: entry?.oddsMeta ?? null,
    realizedEvMultiple: null, // patched in for Phygitals from its CLAW-feed snapshot
    buybackPayout7d,
    netRevenue7d,
    houseTakePct,
    buybackRate7d,
    complete7d: true,
    warning,
  };
}

function packsFromRows(rows: GachaPlatformRow[]): GachaPackBucket[] {
  const out: GachaPackBucket[] = [];
  for (const row of rows) {
    const canonicalSet = new Set(row.packPrices);
    for (const b of row.byAmount24h) {
      out.push({
        id: `${row.key}:${b.amount}`,
        platformKey: row.key,
        platformName: row.name,
        platformShort: row.short,
        chain: row.chain,
        amount: b.amount,
        canonical: canonicalSet.has(b.amount),
        pulls24h: b.count,
        vol24Usd: b.vol,
        share: b.share,
      });
    }
    // For canonical packs that have ZERO pulls in 24h, still surface them
    // (so the grid shows the full menu, not just hot tiers).
    if (canonicalSet.size > 0) {
      const seen = new Set(row.byAmount24h.map((b) => b.amount));
      for (const amt of row.packPrices) {
        if (seen.has(amt)) continue;
        out.push({
          id: `${row.key}:${amt}`,
          platformKey: row.key,
          platformName: row.name,
          platformShort: row.short,
          chain: row.chain,
          amount: amt,
          canonical: true,
          pulls24h: 0,
          vol24Usd: 0,
          share: 0,
        });
      }
    }
  }
  return out.sort((a, b) => b.vol24Usd - a.vol24Usd);
}

/**
 * Fold the Phygitals CLAW-feed snapshot into the Dune gacha snapshot: inject
 * realized prize-value odds (+ provenance) onto the Phygitals platform entry,
 * and merge its biggest hits into the cross-platform list. Returns a shallow
 * clone — the cached Dune object is never mutated. Dune still owns Phygitals'
 * volume/buyback; this only adds what Dune can't see (pull→prize linkage).
 */
function mergePhygitals(
  base: GachaDuneSnapshot | null,
  pg: PhygitalsGachaSnapshot | null,
): GachaDuneSnapshot | null {
  if (!base || !pg) return base;
  const platforms = { ...base.platforms };
  const existing = platforms["phygitals"];
  if (existing && pg.odds.some((o) => o.pct > 0)) {
    platforms["phygitals"] = {
      ...existing,
      odds: pg.odds,
      oddsMeta: {
        window: "realized",
        basis: `prize value vs price · ${pg.window.pulls.toLocaleString()} pulls`,
      },
    };
  }
  const bigHits = [...(base.bigHits ?? []), ...pg.bigHits].sort((a, b) => b.valueUsd - a.valueUsd);
  return { ...base, platforms, bigHits };
}

/** Highest-value-per-mint dedupe — CC hits arrive from BOTH Dune and the native
 *  winners feed; the same prize NFT must appear once in the coverflow. */
function dedupeHits(hits: GachaBigHit[]): GachaBigHit[] {
  const byMint = new Map<string, GachaBigHit>();
  for (const h of hits) {
    const key = h.mint || `${h.platform}:${h.name}:${h.at}`;
    const cur = byMint.get(key);
    if (!cur || h.valueUsd > cur.valueUsd) byMint.set(key, h);
  }
  return [...byMint.values()].sort((a, b) => b.valueUsd - a.valueUsd);
}

/**
 * The pack to headline as "best value": highest TYPICAL return (median × buyback,
 * the same number the explorer's value column leads with — never the
 * jackpot-skewed mean) among packs whose realized sample clears THIN_N.
 */
function bestTypicalPack(
  packs: GachaPack[],
): { pack: GachaPack; typicalNet: number } | null {
  let best: { pack: GachaPack; typicalNet: number } | null = null;
  for (const p of packs) {
    const med = leadMedian(p);
    if (med == null || med.n == null || med.n < THIN_N) continue;
    const typicalNet = med.value * (p.buybackPct ?? 1);
    if (!best || typicalNet > best.typicalNet) best = { pack: p, typicalNet };
  }
  return best;
}

async function buildGacha(): Promise<GachaPayload> {
  const [baseSnap, pg, packsSnap, ccSnap] = await Promise.all([
    readGachaDune(),
    readPhygitalsGacha(),
    readGachaPacks(),
    readCCGacha(),
  ]);
  const snap = mergePhygitals(baseSnap, pg);
  const rows = PLATFORM_SOURCES.map((source) => {
    const row = rowFor(source, snap?.platforms?.[source.key]);
    if (source.key === "phygitals" && pg) row.realizedEvMultiple = pg.realizedEvMultiple;
    return row;
  })
    .sort((a, b) => b.vol24Usd - a.vol24Usd)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  // Hero counts only true gacha pulls — Courtyard tokenization is shown for
  // comparison but excluded from "pull volume" so the headline isn't inflated.
  const gacha = rows.filter((r) => r.kind === "gacha" && r.pulls24h > 0);
  const totalVol24Usd = gacha.reduce((s, r) => s + r.vol24Usd, 0);
  const totalPulls24h = gacha.reduce((s, r) => s + r.pulls24h, 0);
  const top = [...gacha].sort((a, b) => b.vol24Usd - a.vol24Usd)[0] ?? null;
  const packBuckets = packsFromRows(rows.filter((r) => r.kind === "gacha"));
  // CC's native winners feed overlaps Dune's big-hits query → dedupe by mint.
  const bigHits = dedupeHits([...(snap?.bigHits ?? []), ...(ccSnap?.bigHits ?? [])]);
  const bestTypical = bestTypicalPack(packsSnap?.packs ?? []);

  return {
    generatedAt: snap?.generatedAt ?? null,
    hero: {
      totalVol24Usd,
      totalPulls24h,
      avgPullUsd: totalPulls24h > 0 ? totalVol24Usd / totalPulls24h : 0,
      platformsWithData: gacha.length,
      topPlatformName: top?.name ?? null,
      topPlatformVolUsd: top?.vol24Usd ?? 0,
      biggestHitUsd: bigHits[0]?.valueUsd ?? null,
      // Best TYPICAL return we can actually measure (median × buyback over a
      // non-thin realized sample) — the mean is jackpot-skewed, so it never leads.
      bestEvPackId: bestTypical?.pack.name ?? null,
      bestEvMultiple: bestTypical?.typicalNet ?? null,
      bestEvPlatform: bestTypical?.pack.platformName ?? null,
    },
    platforms: rows,
    packBuckets,
    packs: packsSnap?.packs ?? [],
    packsWindow: packsSnap?.window ?? null,
    prizes: packsSnap?.prizes ?? [],
    bigHits,
  };
}

export const getGachaData = unstable_cache(
  async () => buildGacha(),
  ["gacha:v18"],
  { revalidate: 3600, tags: ["gacha", "platform-buckets"] },
);

/**
 * Page-facing payload: the cached aggregate ({@link getGachaData}) with the
 * always-on listener's live hits overlaid on top. The listener (scripts/
 * listen-gacha.ts) writes the `gacha:live` snapshot every poll cycle (~minutes
 * fresh); we read it UNCACHED so the hits band reflects the latest pulls on
 * every request, while the heavy per-pack / per-platform aggregation stays on
 * the 1h cache (it only moves when the 6h warmers run). Without this overlay the
 * listener's real-time data never reached the page — the page read only the
 * warmer snapshots. dedupeHits keeps the highest-value row per mint, so the live
 * feed and the warmer's big-hits list reconcile cleanly.
 */
export async function getGachaPayload(): Promise<GachaPayload> {
  const [data, live] = await Promise.all([getGachaData(), readGachaLive()]);
  if (!live?.hits?.length) return data;
  const bigHits = dedupeHits([...live.hits, ...data.bigHits]);
  return {
    ...data,
    bigHits,
    // "As of" should reflect the freshest input — usually the live snapshot.
    generatedAt:
      data.generatedAt && data.generatedAt > live.generatedAt
        ? data.generatedAt
        : live.generatedAt,
    hero: { ...data.hero, biggestHitUsd: bigHits[0]?.valueUsd ?? data.hero.biggestHitUsd },
  };
}
