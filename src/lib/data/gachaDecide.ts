/**
 * "Where should I spend $X?" decision view model.
 *
 * Joins the per-budget-tier activity (which platforms are live at $25/$50/…,
 * how popular, avg spend) with each platform's economics so a user can compare,
 * for a chosen budget, two things side by side and sort by either:
 *
 *   • MONEY BACK (EV) — from on-chain house take: house keeps X% ⇒ ~$(1−X) back
 *     per $1 if you cash out. Real where the buyback wallet is tracked
 *     (Collector Crypt, Phygitals); null ("soon") for Beezie/Courtyard.
 *   • HIT ODDS — probability of pulling an Epic+ prize, from realized rarity
 *     odds. Real for Collector Crypt today; null ("soon") elsewhere.
 *
 * Plus the platform's biggest recent hit (social proof) and popularity.
 *
 * Pure data join — no clock, no IO beyond the URL builder — safe to call in the
 * server component and hand to the client decider.
 */
import type { SpendTier, GachaPlatformRow } from "./fetchGacha";
import type { GachaBigHit } from "./gachaDuneCache";
import type { Chain } from "@/lib/types";
import { proxyImg } from "@/lib/img";

/** CC rarity tiers that count as "a hit" (a prize worth chasing). */
const HIT_TIERS = new Set(["Epic", "LGND", "SPrT"]);

export type PlatformDecision = {
  key: string;
  name: string;
  short: string;
  chain: Chain;
  /** Per-tier popularity + spend (real). */
  spins24h: number;
  spins30d: number;
  avgSpendUsd: number;
  /** Money back per $1 (1 − house take). null → "soon". */
  evMultiple: number | null;
  /** Money back on the selected budget = nominal × evMultiple. null → "soon". */
  moneyBackUsd: number | null;
  /** House edge (0–1). null → "soon". */
  houseEdgePct: number | null;
  /** Probability of an Epic+ pull (0–1). null → "soon". */
  hitOddsPct: number | null;
  /** Platform's biggest recent hit (social proof). */
  biggestHitUsd: number | null;
  biggestHitName: string | null;
  biggestHitImage: string | null;
};

export type SpendDecision = {
  key: string;
  label: string;
  /** Nominal budget for this tier (25/50/100/…). */
  nominalUsd: number;
  rangeLabel: string;
  totalSpins24h: number;
  /** Platforms live at this budget — UNSORTED; the client sorts by the active metric. */
  platforms: PlatformDecision[];
};

export type SpendDecider = { tiers: SpendDecision[] };

function biggestHitFor(platformKey: string, bigHits: GachaBigHit[]): GachaBigHit | null {
  let best: GachaBigHit | null = null;
  for (const h of bigHits) {
    if (h.platform !== platformKey) continue;
    if (!best || h.valueUsd > best.valueUsd) best = h;
  }
  return best;
}

export function buildSpendDecider(
  tiers: SpendTier[],
  platforms: GachaPlatformRow[],
  bigHits: GachaBigHit[],
): SpendDecider {
  const byKey = new Map(platforms.map((p) => [p.key, p]));

  const out: SpendDecision[] = tiers.map((tier) => {
    const nominalUsd = Number(tier.key) || 0;

    const platformsD: PlatformDecision[] = tier.platforms.map((tp) => {
      const row = byKey.get(tp.key);

      const houseEdgePct =
        row && row.houseTakePct != null && row.houseTakePct >= 0 && row.houseTakePct <= 1
          ? row.houseTakePct
          : null;
      const evMultiple = houseEdgePct != null ? 1 - houseEdgePct : null;
      const moneyBackUsd = evMultiple != null ? nominalUsd * evMultiple : null;

      let hitOddsPct: number | null = null;
      if (row?.odds && row.odds.length > 0) {
        hitOddsPct = row.odds
          .filter((o) => HIT_TIERS.has(o.tier))
          .reduce((s, o) => s + (o.pct ?? 0), 0);
      }

      const bh = biggestHitFor(tp.key, bigHits);

      return {
        key: tp.key,
        name: tp.name,
        short: tp.short,
        chain: tp.chain,
        spins24h: tp.spins24h,
        spins30d: tp.spins30d,
        avgSpendUsd: tp.avgSpend,
        evMultiple,
        moneyBackUsd,
        houseEdgePct,
        hitOddsPct,
        biggestHitUsd: bh ? bh.valueUsd : null,
        biggestHitName: bh ? bh.name : null,
        biggestHitImage: bh
          ? proxyImg(bh.image ?? bh.imageFallback ?? undefined) ?? null
          : null,
      };
    });

    return {
      key: tier.key,
      label: tier.label,
      nominalUsd,
      rangeLabel: tier.rangeLabel,
      totalSpins24h: tier.totalSpins24h,
      platforms: platformsD,
    };
  });

  return { tiers: out };
}
