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
import type { GachaPack, MetricBasis } from "./gachaPacksCache";

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
 *  EV. Realized only (Beezie/CC have no per-pull distribution). */
export function leadMedian(p: GachaPack): Lead | null {
  return p.medianReturn != null
    ? { value: p.medianReturn, basis: "realized", n: p.realizedN }
    : null;
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
