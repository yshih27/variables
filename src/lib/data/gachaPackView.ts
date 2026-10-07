/**
 * Pure view helpers for the pack-centric comparison + budget planner.
 * No React, no IO — safe in both the server component and the client explorer.
 *
 * Honesty rules baked in:
 *   • Each derived metric carries its BASIS (stated | realized | platform) so the
 *     UI labels it and never silently ranks a vendor number above a measured one.
 *   • Realized numbers carry their sample size `n`; below THIN_N they're flagged.
 *   • Net-EV folds in the buyback haircut (the real cost if you flip every card).
 */
import type { GachaPack, GachaPrize, MetricBasis } from "./gachaPacksCache";
import { classifyIP } from "./ipCatalog";

/** Below this many realized pulls, a measured number is "thin" (badge it). */
export const THIN_N = 10;

export type Lead = { value: number; basis: MetricBasis; n: number | null };

/** EV multiple to lead with (value retained per $1) + basis. Prefer measured. */
export function leadEv(p: GachaPack): Lead | null {
  if (p.evRealized != null) return { value: p.evRealized, basis: "realized", n: p.realizedN };
  if (p.evStated != null) return { value: p.evStated, basis: "stated", n: null };
  return null;
}

/** The TYPICAL outcome (median value-back multiple) — less skewed than the mean
 *  EV. Realized only, and only when it passes the plausibility gate. */
export function leadMedian(p: GachaPack): Lead | null {
  if (p.medianReturn == null || plausibilityGate(p).withheld) return null;
  return { value: p.medianReturn, basis: "realized", n: p.realizedN };
}

// ─────────────────────────── Mixed pools ───────────────────────────

/** A game needs this many prizes in a pool to count toward "mixed": one keyword misread is not a second game. */
export const MIXED_POOL_MIN_PRIZES = 2;

/**
 * A prize's game: its own category where the venue tags each prize (Beezie's
 * category trait), else the IP its name and traits classify to. Null when
 * neither names a game ("other" is not a game).
 */
export function prizeGame(p: Pick<GachaPrize, "category" | "name" | "traits">): string | null {
  if (p.category) return p.category;
  const ip = classifyIP([p.name ?? undefined, ...(p.traits ?? [])]);
  return ip.key === "other" ? null : ip.key;
}

/**
 * True only when a pack's pool prizes span more than one game, each with at
 * least MIXED_POOL_MIN_PRIZES prizes. Pure. A pack whose prizes name no game,
 * or one game, is not mixed.
 */
export function isMixedPool(prizes: Pick<GachaPrize, "category" | "name" | "traits">[]): boolean {
  const counts = new Map<string, number>();
  for (const p of prizes) {
    const g = prizeGame(p);
    if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return [...counts.values()].filter((n) => n >= MIXED_POOL_MIN_PRIZES).length > 1;
}

/** Every pack with `mixedPool` set from the prizes the finder lists for it (pool and pulled). Pure. */
export function withMixedPool(packs: GachaPack[], prizes: Pick<GachaPrize, "packId" | "category" | "name" | "traits">[]): GachaPack[] {
  const byPack = new Map<string, Pick<GachaPrize, "category" | "name" | "traits">[]>();
  for (const p of prizes) {
    const arr = byPack.get(p.packId);
    if (arr) arr.push(p);
    else byPack.set(p.packId, [p]);
  }
  return packs.map((p) => ({ ...p, mixedPool: isMixedPool(byPack.get(p.id) ?? []) }));
}

// ─────────────────────────── Plausibility gate ───────────────────────────

/** A realized median above this multiple of the stated EV is withheld. */
export const MEDIAN_MAX_OVER_STATED_EV = 1.5;
/**
 * A realized median above this multiple of its own mean is withheld. Not 1.0: a
 * low-variance pack's median honestly sits a hair above its mean (DYLI's Pack
 * Ripper 1.02× vs 1.00×, n=67, Oct 7), and the rule exists for the right-skewed
 * artifact (CC PKMN 50 read 2.36× vs 1.90×), which 10% still catches.
 */
export const MEDIAN_MAX_OVER_MEAN = 1.1;

export type PlausibilityVerdict = { withheld: boolean; reason: string | null };

/**
 * Does a pack's realized median survive a plausibility check? A gacha payout is
 * right-skewed — most pulls return under the price, a few return many times it
 * — so its median sits BELOW its mean, and well inside the venue's own stated
 * EV. A realized median above the realized mean, or above
 * MEDIAN_MAX_OVER_STATED_EV × the stated EV, says the sample is not the
 * machine (the Oct 7 headline: CC's PKMN 50 at a 2.36× median on 25 pulls of a
 * tier-stratified slice). Such a median is withheld with the reason, and the
 * hero never headlines it. Pure.
 */
export function plausibilityGate(p: GachaPack): PlausibilityVerdict {
  const med = p.medianReturn;
  if (med == null) return { withheld: false, reason: null };
  if (p.evRealized != null && med > MEDIAN_MAX_OVER_MEAN * p.evRealized) {
    return {
      withheld: true,
      reason: `realized median ${med.toFixed(2)}× is more than ${Math.round((MEDIAN_MAX_OVER_MEAN - 1) * 100)}% above its own mean ${p.evRealized.toFixed(2)}× (n=${p.realizedN ?? "?"})`,
    };
  }
  if (p.evStated != null && p.evStated > 0 && med > MEDIAN_MAX_OVER_STATED_EV * p.evStated) {
    return {
      withheld: true,
      reason: `realized median ${med.toFixed(2)}× is above ${MEDIAN_MAX_OVER_STATED_EV}× the venue's stated EV ${p.evStated.toFixed(2)}× (n=${p.realizedN ?? "?"})`,
    };
  }
  return { withheld: false, reason: null };
}

/**
 * The pack as the payload ships it: a median that fails the gate is nulled and
 * its reason carried in `medianWithheld`, so no surface can print it.
 */
export function gatePack(p: GachaPack): GachaPack {
  const v = plausibilityGate(p);
  return v.withheld ? { ...p, medianReturn: null, medianWithheld: v.reason } : { ...p, medianWithheld: null };
}

/** Chance of a "good pull" (≥ stake value / rare tier) + basis. */
export function leadHitOdds(p: GachaPack): Lead | null {
  if (p.hitOddsStated != null) return { value: p.hitOddsStated, basis: "stated", n: null };
  if (p.hitOddsRealized != null) {
    return {
      value: p.hitOddsRealized,
      basis: p.oddsBasis,
      n: p.oddsBasis === "realized" ? p.realizedN : null,
    };
  }
  return null;
}

/** Net EV after the buyback haircut — the realistic expected return if you flip. */
export function netEv(p: GachaPack): number | null {
  const ev = leadEv(p);
  if (!ev) return null;
  return p.buybackPct != null ? ev.value * p.buybackPct : ev.value;
}

/** House edge (share of stake the house keeps), 0–1. null if no EV. */
export function houseEdge(p: GachaPack): number | null {
  const ev = leadEv(p);
  return ev ? 1 - ev.value : null;
}

/** Is the realized number behind a lead too thin to trust? */
export function isThin(lead: Lead | null): boolean {
  return !!lead && lead.basis === "realized" && (lead.n == null || lead.n < THIN_N);
}

/** The grail this pack is chasing (advertised top-hit, else realized). */
export function chaseUsd(p: GachaPack): number | null {
  return p.topHitAvailableUsd ?? p.topHitRealizedUsd ?? null;
}

// ─────────────────────────── Budget planner (split-vs-single) ───────────────────────────

export type PackPlan = {
  pack: GachaPack;
  shots: number; // ⌊budget / price⌋
  spend: number;
  leftover: number;
  /** Per-pull good-pull odds used for the at-least-one calc (+ basis). null when
   *  not pack-attributable (platform-wide CC odds). */
  hitOdds: Lead | null;
  /** Whether `hitOdds` rests on a thin realized sample — UI must flag, not assert. */
  thinOdds: boolean;
  /** P(≥1 good pull across `shots` pulls) = 1 − (1 − p)^shots. null if odds aren't
   *  pack-attributable (CC). Kept (flagged) for thin samples so the buyer sees it. */
  pAtLeastOne: number | null;
  /** The ceiling — best card you could pull from this pack. */
  ceilingUsd: number | null;
  /** Net EV of the whole spend (shots × price × netEvMultiple). */
  netReturnUsd: number | null;
};

/**
 * For a budget, every affordable pack with how many pulls it buys, the combined
 * P(≥1 hit), the ceiling, and the net expected return. This is the split-vs-single
 * comparison: a cheap pack buys more shots (higher P-of-any-hit, lower ceiling);
 * a pricey pack has a huge ceiling but one shot. The buyer reads the tradeoff
 * straight off the rows.
 *
 * ⚠️ P(≥1) assumes independent pulls. Where a pack draws from a finite pool that
 * removes prizes as they're won, real odds shift — the UI footnotes this.
 */
export function budgetPlans(packs: GachaPack[], budget: number): PackPlan[] {
  const out: PackPlan[] = [];
  for (const pack of packs) {
    if (!(pack.priceUsd > 0) || pack.priceUsd > budget) continue;
    const shots = Math.floor(budget / pack.priceUsd);
    if (shots < 1) continue;
    const hitOdds = leadHitOdds(pack);
    // CC odds are platform-wide — computing a per-pack P(≥1) from them would
    // fabricate a pack-level number the model forbids. Suppress for those.
    const attributable = hitOdds != null && hitOdds.basis !== "platform" && !pack.notDirectlyComparable;
    const p = attributable ? hitOdds.value : null;
    const pAtLeastOne = p != null ? 1 - Math.pow(1 - p, shots) : null;
    const nev = netEv(pack);
    out.push({
      pack,
      shots,
      spend: shots * pack.priceUsd,
      leftover: budget - shots * pack.priceUsd,
      hitOdds: attributable ? hitOdds : null,
      thinOdds: attributable ? isThin(hitOdds) : false,
      pAtLeastOne,
      ceilingUsd: chaseUsd(pack),
      netReturnUsd: nev != null ? shots * pack.priceUsd * nev : null,
    });
  }
  return out;
}

export const BASIS_LABEL: Record<MetricBasis, string> = {
  stated: "stated",
  realized: "measured",
  platform: "platform-wide",
  assumed: "assumed",
};

// ─────────────────────────── Odds audit (stated vs measured) ───────────────────────────

/** Below this many measured pulls an audit verdict would be noise. */
export const AUDIT_MIN_N = 30;

export type OddsAudit = {
  verdict: "match" | "off" | "thin";
  stated: number; // the platform's published hit odds (0–1)
  measured: number; // our measured hit share (0–1)
  deltaPts: number; // measured − stated, in percentage points (signed)
  n: number; // pulls behind the measurement
};

/**
 * The audit: does the platform's PUBLISHED hit rate survive contact with the
 * pulls we measured? Wilson 95% interval on the measured share — "match" when
 * the stated rate sits inside it, "off" when it doesn't, "thin" under
 * AUDIT_MIN_N pulls. Only packs exposing BOTH sides are auditable (CC today).
 */
export function oddsAudit(p: GachaPack): OddsAudit | null {
  if (p.hitOddsStated == null || p.hitOddsRealized == null || p.realizedN == null) return null;
  const n = p.realizedN;
  const stated = p.hitOddsStated;
  const measured = p.hitOddsRealized;
  const deltaPts = (measured - stated) * 100;
  if (n < AUDIT_MIN_N) return { verdict: "thin", stated, measured, deltaPts, n };
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const center = (measured + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((measured * (1 - measured)) / n + (z * z) / (4 * n * n))) / denom;
  const inCI = stated >= center - half && stated <= center + half;
  return { verdict: inCI ? "match" : "off", stated, measured, deltaPts, n };
}
