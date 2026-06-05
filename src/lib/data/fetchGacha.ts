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
  type GachaBigHit,
} from "./gachaDuneCache";
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
  /** Realized rarity odds (rarest→commonest). null where tier wallets don't exist. */
  odds: GachaOddsTier[] | null;
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
 * One "pack" = one price tier on one platform.
 * (For platforms without fixed pack prices we still emit one entry per
 *  rounded amount that has at least 1 pull in the 24h window.)
 */
export type GachaPack = {
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

/**
 * One platform's activity within a spend tier (budget band). The core unit of
 * the "I have $X, where do I spend it?" comparison.
 */
export type SpendTierPlatform = {
  key: string;
  name: string;
  short: string;
  chain: Chain;
  /** Spins (pulls) in each window — the "what are others doing" popularity signal. */
  spins24h: number;
  spins7d: number;
  spins30d: number;
  vol24h: number;
  vol30d: number;
  /** Average price actually paid within this band (vol30d / spins30d). */
  avgSpend: number;
  // ── Pending until the odds + hits queries ship ──
  /** Best-tier hit probability (0–1), or null until odds query lands. */
  bestOdds: number | null;
  /** Highest possible prize FMV at this tier, or null. */
  topPrizeUsd: number | null;
  /** Biggest actual hit FMV pulled at this tier in 24h, or null. */
  biggestHitUsd: number | null;
};

/** A budget band ($25/$50/$100/$250/$500/$1K+) with each platform's activity. */
export type SpendTier = {
  key: string;
  label: string;
  rangeLabel: string;
  min: number;
  max: number;
  /** Platforms active in this band, sorted by 24h popularity desc. */
  platforms: SpendTierPlatform[];
  totalSpins24h: number;
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
    bestEvPackId: string | null;
  };
  platforms: GachaPlatformRow[];
  /** Budget-band comparison — the primary "compare by spend" view. */
  spendTiers: SpendTier[];
  /** Flat list of every pack tier across every platform. Sorted by 24h volume desc. */
  packs: GachaPack[];
  /** Biggest hits (high-FMV prizes), ranked desc. */
  bigHits: GachaBigHit[];
};

/**
 * Budget bands. Boundaries sit at the geometric midpoints between labels so a
 * $60 Beezie pull lands in "$50" and a $90 in "$100".
 */
const SPEND_BANDS: Array<{ key: string; label: string; min: number; max: number }> = [
  { key: "25", label: "$25", min: 1, max: 37 },
  { key: "50", label: "$50", min: 37, max: 75 },
  { key: "100", label: "$100", min: 75, max: 175 },
  { key: "250", label: "$250", min: 175, max: 375 },
  { key: "500", label: "$500", min: 375, max: 750 },
  { key: "1000", label: "$1K+", min: 750, max: Infinity },
];

function rangeLabel(min: number, max: number): string {
  if (max === Infinity) return `$${min}+`;
  return `$${min}–${max - 1}`;
}

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
    buybackPayout7d,
    netRevenue7d,
    houseTakePct,
    buybackRate7d,
    complete7d: true,
    warning,
  };
}

function packsFromRows(rows: GachaPlatformRow[]): GachaPack[] {
  const out: GachaPack[] = [];
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
 * Build the budget-band comparison: for each spend tier, each gacha platform's
 * activity (banding the full per-price data). Platforms sorted by 24h
 * popularity so the leader is obvious.
 */
function buildSpendTiers(snap: GachaDuneSnapshot | null): SpendTier[] {
  if (!snap) return [];
  const out: SpendTier[] = [];

  for (const band of SPEND_BANDS) {
    const platforms: SpendTierPlatform[] = [];
    for (const source of PLATFORM_SOURCES) {
      const p = snap.platforms[source.key];
      if (!p || p.kind !== "gacha") continue;
      const inBand = p.byPrice.filter((b) => b.price >= band.min && b.price < band.max);
      const sum = (sel: (b: (typeof inBand)[number]) => number) =>
        inBand.reduce((a, b) => a + sel(b), 0);
      const spins30d = sum((b) => b.pulls30d);
      if (spins30d === 0) continue; // no activity in this band
      const vol30d = sum((b) => b.vol30d);
      platforms.push({
        key: source.key,
        name: source.name,
        short: source.short,
        chain: source.chain,
        spins24h: sum((b) => b.pulls24h),
        spins7d: sum((b) => b.pulls7d),
        spins30d,
        vol24h: sum((b) => b.vol24h),
        vol30d,
        avgSpend: spins30d > 0 ? vol30d / spins30d : 0,
        bestOdds: null,
        topPrizeUsd: null,
        biggestHitUsd: null,
      });
    }
    if (platforms.length === 0) continue;
    platforms.sort((a, b) => b.spins24h - a.spins24h || b.spins30d - a.spins30d);
    out.push({
      key: band.key,
      label: band.label,
      rangeLabel: rangeLabel(band.min, band.max),
      min: band.min,
      max: band.max,
      platforms,
      totalSpins24h: platforms.reduce((s, p) => s + p.spins24h, 0),
    });
  }
  return out;
}

async function buildGacha(): Promise<GachaPayload> {
  const snap = await readGachaDune();
  const rows = PLATFORM_SOURCES.map((source) =>
    rowFor(source, snap?.platforms?.[source.key]),
  )
    .sort((a, b) => b.vol24Usd - a.vol24Usd)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  // Hero counts only true gacha pulls — Courtyard tokenization is shown for
  // comparison but excluded from "pull volume" so the headline isn't inflated.
  const gacha = rows.filter((r) => r.kind === "gacha" && r.pulls24h > 0);
  const totalVol24Usd = gacha.reduce((s, r) => s + r.vol24Usd, 0);
  const totalPulls24h = gacha.reduce((s, r) => s + r.pulls24h, 0);
  const top = [...gacha].sort((a, b) => b.vol24Usd - a.vol24Usd)[0] ?? null;
  const packs = packsFromRows(rows.filter((r) => r.kind === "gacha"));
  const spendTiers = buildSpendTiers(snap);
  const bigHits = snap?.bigHits ?? [];

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
      bestEvPackId: null, // realized EV per pack — next
    },
    platforms: rows,
    spendTiers,
    packs,
    bigHits,
  };
}

export const getGachaData = unstable_cache(
  async () => buildGacha(),
  ["gacha:v9"],
  { revalidate: 3600, tags: ["gacha", "platform-buckets"] },
);
