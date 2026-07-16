/**
 * View model for the LIVE biggest-hits ticker (see GachaHitsTicker).
 *
 * Maps raw `GachaBigHit` rows → the display shape: real card art, parsed
 * grade, rarity (from CC tier, with a value fallback for non-CC platforms),
 * relative time, and a chain badge.
 *
 * BACKEND DEPENDENCIES (flagged for the data chat):
 *   • A true 24h window: the warmer currently aggregates a longer window, so
 *     `mapBigHits` prefers the last 24h and falls back to "recent" when too few
 *     hits land in 24h. Provide 24h-windowed big hits to make this exact.
 *   • `pull` (pack price paid) + `mult` (return multiple): need pull→prize
 *     linkage on-chain; until then the detail panel shows them as "soon".
 */
import { proxyImg } from "@/lib/img";
import { parseGrade } from "@/lib/card/grade";
import type { GachaBigHit } from "./gachaDuneCache";
import type { Chain } from "@/lib/types";

export type HitRarity = "mythic" | "legendary" | "ultra" | "rare" | "holo";

export type CoverflowHit = {
  rank: number;
  name: string;
  /** Secondary line — platform label for now (no per-hit set field yet). */
  set: string | null;
  /** Parsed from the card name (e.g. "PSA 10"), or null. */
  grade: string | null;
  rarity: HitRarity;
  /** Raw CC tier (Low/Mid/High/Epic/LGND/SPrT) or "" — used as a label fallback. */
  tier: string;
  image: string | null;
  imageFallback: string | null;
  /** Realized FMV, formatted "$48,200". */
  hit: string;
  hitValueUsd: number;
  /** Pack price paid — null until pull→prize linkage lands ("soon"). */
  pull: string | null;
  /** Return multiple — null until pull price is known ("soon"). */
  mult: string | null;
  platform: string;
  platformKey: string;
  chain: Chain;
  mint: string;
  ago: string;
  at: string;
  /** Pack/machine the hit came from, where known. */
  pack: string | null;
};

export type MappedHits = {
  hits: CoverflowHit[];
  /** "last 24h" when enough hits fall in the 24h window, else "recent". */
  windowLabel: string;
  is24h: boolean;
};

export const RARITY_META: Record<
  HitRarity,
  { color: string; glow: string; label: string }
> = {
  mythic: { color: "#f3ff42", glow: "rgba(243,255,66,.45)", label: "Mythic Pull" },
  legendary: { color: "#ff8a3d", glow: "rgba(255,138,61,.4)", label: "Legendary" },
  ultra: { color: "#a18cff", glow: "rgba(161,140,255,.4)", label: "Ultra Rare" },
  rare: { color: "#5fa3ff", glow: "rgba(95,163,255,.38)", label: "Rare" },
  holo: { color: "#6cf48a", glow: "rgba(108,244,138,.38)", label: "Holo" },
};

const PLATFORM: Record<string, { label: string; chain: Chain }> = {
  "collector-crypt": { label: "Collector Crypt", chain: "Solana" },
  beezie: { label: "Beezie", chain: "Base" },
  phygitals: { label: "Phygitals", chain: "Solana" },
  courtyard: { label: "Courtyard", chain: "Polygon" },
};

// CC rarity tiers, rarest→commonest: SPrT > LGND > Epic > High > Mid > Low.
const TIER_RARITY: Record<string, HitRarity> = {
  SPrT: "mythic",
  LGND: "legendary",
  Epic: "ultra",
  High: "rare",
  Mid: "holo",
  Low: "holo",
};

function rarityFor(hit: GachaBigHit): HitRarity {
  const t = TIER_RARITY[hit.tier];
  if (t) return t;
  // Value fallback for platforms without rarity tiers (Beezie/Phygitals).
  const v = hit.valueUsd;
  if (v >= 10000) return "mythic";
  if (v >= 2000) return "legendary";
  if (v >= 500) return "ultra";
  if (v >= 100) return "rare";
  return "holo";
}

/** Grade parsing lives in @/lib/card/grade — this file used to carry its own
 *  regex, which had drifted from the warmer's (no BECKETT, no PRISTINE) and
 *  missed hyphenated GEM-MT entirely. */
const gradeOf = (name: string) => parseGrade(name)?.label ?? null;

function agoOf(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  const h = Math.round(s / 3600);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/**
 * Map raw gacha big-hits → the coverflow view model, sorted by realized value.
 * `nowMs` is passed in (not read from the clock) so server and client renders
 * agree — no hydration drift.
 */
export function mapBigHits(
  bigHits: GachaBigHit[],
  nowMs: number,
  limit = 12,
): MappedHits {
  const DAY = 24 * 60 * 60 * 1000;
  const within24h = bigHits.filter((h) => {
    const t = Date.parse(h.at);
    return Number.isFinite(t) && nowMs - t <= DAY;
  });
  const is24h = within24h.length >= 3;
  const source = is24h ? within24h : bigHits;

  const hits = [...source]
    .sort((a, b) => b.valueUsd - a.valueUsd)
    .slice(0, limit)
    .map((h, i): CoverflowHit => {
      const meta = PLATFORM[h.platform] ?? {
        label: h.platform,
        chain: "Solana" as Chain,
      };
      return {
        rank: i + 1,
        name: h.name,
        set: meta.label,
        grade: gradeOf(h.name),
        rarity: rarityFor(h),
        tier: h.tier,
        image: proxyImg(h.image ?? undefined) ?? null,
        imageFallback: proxyImg(h.imageFallback ?? undefined) ?? null,
        hit: usd(h.valueUsd),
        hitValueUsd: h.valueUsd,
        pull: null,
        mult: null,
        platform: meta.label,
        platformKey: h.platform,
        pack: h.pack ?? null,
        chain: meta.chain,
        mint: h.mint,
        ago: agoOf(h.at, nowMs),
        at: h.at,
      };
    });

  return { hits, windowLabel: is24h ? "last 24h" : "recent", is24h };
}
