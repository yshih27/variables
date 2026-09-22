/**
 * INDEX RECEIPTS — the sample behind one published month, and the gate behind
 * one that did not publish.
 *
 * ⚠️ WHY THIS EXISTS. A level is a claim. "V-MKT was 149 in August" is worth
 * exactly what the reader can check, and until v4.2 nothing under the line could
 * be checked: the blob carried anonymous [logReturn, weight] pairs for INV-13 and
 * nothing else, so the only answer to "which cards moved it?" was to rebuild the
 * panel. Now every published step carries its identities with both prices and
 * both sale counts, and every withheld month carries the gate that withheld it —
 * so the methodology page, the tooltip and a sceptical partner all read the same
 * numbers out of the same block.
 *
 * ⚠️ IT READS, IT DOES NOT RE-DERIVE. The receipt is the builder's own sample,
 * not a fresh computation over the panel: a receipt that recomputed could
 * disagree with the level it claims to explain. The one derived number is
 * `step`, the interpolated weighted median of the identities listed — which is
 * the estimator itself, run on the sample printed beside it, so a reader can
 * check the arithmetic. INV-13 makes the same check as a gate.
 */
import { readSnapshot } from "@/lib/db/snapshots";
import type { IndexPoint } from "./indices";
import { weightedMedian } from "./identityIndex";

/** The blob's estimator, named once. */
export const INDEX_ESTIMATOR = "interpolated weighted median" as const;

/** One identity's contribution to a step, as the blob stores it. */
export type StepObsTuple = [slug: string, logReturn: number, weight: number, priceFrom: number, priceTo: number, nFrom: number, nTo: number];

export type IndexHoldRecord = {
  ts: string;
  reason: "below-floor" | "step-limit" | "running-month" | "no-comparables";
  overlap: number;
  floor: number;
  stepPct: number | null;
};

export type PriceIndexReceiptBlob = {
  generatedAt?: string;
  method?: string;
  series?: Record<string, IndexPoint[]>;
  /** entity → point ts → the step's identities. */
  stepObs?: Record<string, Record<string, StepObsTuple[] | [number, number][]>>;
  /** entity → the months it withheld, with the gate that withheld each. */
  holds?: Record<string, IndexHoldRecord[]>;
  biasTests?: { entities?: Record<string, { heldReason?: string | null }> };
};

export type IdentityReceipt = {
  /** Identity slug — `/i/<slug>` is the card this line is about. */
  slug: string;
  logReturn: number;
  weight: number;
  priceFrom: number;
  priceTo: number;
  nFrom: number;
  nTo: number;
};

export type IndexReceipts = {
  entity: string;
  /** Month-END ISO, the stamp the point carries. */
  month: string;
  /** The published level, or null for a month that did not publish. */
  level: number | null;
  /** The step into this month, %, re-derived from `identities`. Null when held. */
  step: number | null;
  /** Months since the previously published point (1 = no gap). */
  spansMonths: number | null;
  thin: boolean;
  estimator: typeof INDEX_ESTIMATOR;
  /** The step's sample, heaviest first. Empty for a held month. */
  identities: IdentityReceipt[];
  /** Why nothing published, or null when it did. */
  held: { reason: string; detail: string } | null;
};

/**
 * Both shapes, one decoder. The v4.1 blob stored `[logReturn, weight]`; v4.2
 * stores the seven-field tuple. A reader that crashed on the old shape would
 * take the receipts page down for the window between this deploying and the next
 * index run — so the old pairs decode to a receipt with no slug and no prices,
 * which is what they are.
 */
export function decodeStepObs(raw: StepObsTuple[] | [number, number][] | undefined): IdentityReceipt[] {
  if (!Array.isArray(raw)) return [];
  const out: IdentityReceipt[] = [];
  for (const o of raw) {
    if (!Array.isArray(o)) continue;
    if (o.length >= 7 && typeof o[0] === "string") {
      const [slug, v, w, pFrom, pTo, nFrom, nTo] = o as StepObsTuple;
      out.push({ slug, logReturn: v, weight: w, priceFrom: pFrom, priceTo: pTo, nFrom, nTo });
    } else if (o.length === 2 && typeof o[0] === "number") {
      const [v, w] = o as [number, number];
      out.push({ slug: "", logReturn: v, weight: w, priceFrom: 0, priceTo: 0, nFrom: 0, nTo: 0 });
    }
  }
  return out;
}

/** "2026-08-31T…" / "2026-08" / a Date-parseable string → "2026-08". */
function monthOf(ts: string): string {
  if (/^\d{4}-\d{2}/.test(ts)) return ts.slice(0, 7);
  const t = Date.parse(ts);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 7) : ts;
}

const HOLD_DETAIL: Record<IndexHoldRecord["reason"], (h: IndexHoldRecord) => string> = {
  "below-floor": (h) => `${h.overlap} identities priced in both months, below the ${h.floor} this index needs — the step is unknown, so the chain does not advance`,
  "step-limit": (h) => `the step was ${h.stepPct == null ? "beyond the limit" : `${h.stepPct >= 0 ? "+" : ""}${h.stepPct.toFixed(1)}%`} on ${h.overlap} identities — past ±25% a month needs 50, so it is withheld rather than chained through`,
  "running-month": () => "the month is still running — a month is stamped only once it has ended",
  "no-comparables": () => "no identity was priced in both this month and the one before it",
};

/**
 * Every month this entity has a record for — published points and withheld
 * months together, oldest first — so the receipts page can offer its neighbours
 * without a second reader or a second idea of what a month is.
 */
export async function readIndexMonths(entityId: string): Promise<{ month: string; published: boolean }[]> {
  const snap = await readSnapshot<PriceIndexReceiptBlob>("price-index");
  const series = snap?.series?.[entityId];
  if (!series) return [];
  const months = new Map<string, boolean>();
  for (const p of series) months.set(monthOf(p.ts), true);
  for (const h of snap?.holds?.[entityId] ?? []) if (!months.has(monthOf(h.ts))) months.set(monthOf(h.ts), false);
  return [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, published]) => ({ month, published }));
}

/**
 * The receipt for one entity-month. Null when the entity publishes no series at
 * all (nothing to explain) — a month that exists but did not publish comes back
 * with `held`, which is the point.
 */
export async function readIndexReceipts(entityId: string, monthTs: string): Promise<IndexReceipts | null> {
  const snap = await readSnapshot<PriceIndexReceiptBlob>("price-index");
  const series = snap?.series?.[entityId];
  if (!series) return null;
  const month = monthOf(monthTs);
  const base: Omit<IndexReceipts, "level" | "step" | "spansMonths" | "thin" | "identities" | "held"> = {
    entity: entityId,
    month,
    estimator: INDEX_ESTIMATOR,
  };

  // An entity the builder held outright explains every one of its months.
  const entityHold = snap?.biasTests?.entities?.[entityId]?.heldReason;
  if (entityHold) {
    return { ...base, level: null, step: null, spansMonths: null, thin: false, identities: [], held: { reason: entityHold, detail: "the index is withheld for this entity: its holding-period spread is past the hard limit, so the series is not published at any month" } };
  }

  const pt = series.find((p) => monthOf(p.ts) === month) as (IndexPoint & { spansWeeks?: number }) | undefined;
  if (!pt) {
    const hold = (snap?.holds?.[entityId] ?? []).find((h) => monthOf(h.ts) === month);
    if (!hold) {
      return { ...base, level: null, step: null, spansMonths: null, thin: false, identities: [], held: { reason: "out-of-span", detail: "the month is outside this index's published span" } };
    }
    return { ...base, month: monthOf(hold.ts), level: null, step: null, spansMonths: null, thin: false, identities: [], held: { reason: hold.reason, detail: HOLD_DETAIL[hold.reason]?.(hold) ?? "" } };
  }

  const identities = decodeStepObs(snap?.stepObs?.[entityId]?.[pt.ts]).sort((a, b) => b.weight - a.weight || b.priceTo - a.priceTo);
  const derived = identities.length ? weightedMedian(identities.map((o) => ({ v: o.logReturn, w: o.weight }))) : NaN;
  return {
    ...base,
    month: monthOf(pt.ts),
    level: pt.value,
    step: Number.isFinite(derived) ? (Math.exp(derived) - 1) * 100 : null,
    spansMonths: pt.spansWeeks ?? null,
    thin: pt.thin === true,
    identities,
    held: null,
  };
}
