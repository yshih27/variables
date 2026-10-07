import { completeMonthsOnly, monthlyChangePct, type IndexPoint } from "@/lib/data/indices";
import type { IndexProvisional, StepVenues } from "@/lib/data/indices";
import { belowFloorWords, closeDateOf, monthName, monthOf, provisionalWords, sampleLine } from "./readingWords";

export { monthName, closeDateOf, asOfStamp, monthOf, sampleLine, provisionalWords, belowFloorWords } from "./readingWords";

/**
 * THE V'S READING — which number leads a V block, and every word around it.
 *
 * The index publishes once a month; between closes the backend computes the
 * running month's step and, when it clears the entity's floor, hands it over as
 * a PROVISIONAL reading (never chained, never a series point, replaced at the
 * close). This module decides, from the backend's objects alone, what a V block
 * leads with and what it says — so the homepage hero, the strip, the charts and
 * the receipts page cannot tell the same moment two ways.
 *
 * ⚠️ NOTHING HERE COMPUTES A NUMBER. Values, steps, counts, floors, months and
 * timestamps come from the provisional object and the published series; this
 * file rescales (the page's own rebase factor) and puts them in sentences. The
 * close date is DERIVED from `month` (the first day of the next month), never
 * typed.
 *
 * ⚠️ THE LAST CLOSE IS NEVER HIDDEN. When the provisional leads, the close is
 * still returned — one line below on the hero, in the tooltip on the strip — so
 * a reader can always find the published number.
 */

export type { IndexProvisional, StepVenues };

export type CloseReading = {
  ts: string;
  month: string;
  /** Rebased level of the last published close. */
  value: number;
  /** "September close". */
  name: string;
  /** "September close 151.2". */
  label: string;
  /** The close's month-over-month step (from the published series), or null. */
  stepPct: number | null;
  sample: { line: string; note: string | null } | null;
};

export type ProvisionalReading =
  | {
      state: "leads";
      month: string;
      asOf: string | null;
      /** Rebased, on the same base as the close. */
      value: number;
      lo: number;
      hi: number;
      stepPct: number;
      n: number;
      thin: boolean;
      /** "October so far · provisional". */
      chip: string;
      /** "63 identities · closes Nov 1 · as of Oct 14 09:12 UTC". */
      receipt: string;
      closeDate: string;
      sample: { line: string; note: string | null } | null;
    }
  | {
      state: "below-floor";
      month: string;
      asOf: string | null;
      n: number;
      floor: number;
      closeDate: string;
      /** "October so far: 12 identities, under the 20 the market needs; the close publishes Nov 1". */
      receipt: string;
    };

export type IndexReading = {
  lead: "provisional" | "close";
  /** The figure the block leads with (rebased). */
  figure: number | null;
  /** Its step, and the window that step covers: MTD for a provisional, 1m for a close. */
  stepPct: number | null;
  stepWindow: "MTD" | "1m";
  close: CloseReading | null;
  provisional: ProvisionalReading | null;
  /** The reading that does NOT lead, for a tooltip ("September close 151.2 · −5.3% 1m"). */
  other: string | null;
};

const pct = (p: number) => `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p).toFixed(1)}%`;

/**
 * Decide what a V block leads with.
 *
 * @param series   the PUBLISHED points (closes only — never a running month)
 * @param prov     the backend's provisional object (or null when it sent none)
 * @param opts.base  the page's rebase base (series value that maps to 100); the
 *                   provisional is rescaled by the same factor
 */
export function indexReading(
  entity: string,
  series: IndexPoint[],
  prov: IndexProvisional | null,
  opts: { base: number | null },
): IndexReading {
  const f = opts.base && opts.base > 0 ? 100 / opts.base : 1;
  // Closes only: a running month is never a close, whatever the caller passed.
  const pts = completeMonthsOnly(series).filter((p) => Number.isFinite(p.value));
  const last = pts.at(-1) ?? null;

  const close: CloseReading | null = last
    ? {
        ts: last.ts,
        month: monthOf(last.ts),
        value: last.value * f,
        name: `${monthName(monthOf(last.ts))} close`,
        label: `${monthName(monthOf(last.ts))} close ${(last.value * f).toFixed(1)}`,
        // The same month-over-month the hero and the strip have always printed.
        stepPct: monthlyChangePct(pts),
        // The venues behind the close's own step, carried on the published point.
        sample: sampleLine(last.venues),
      }
    : null;

  let provisional: ProvisionalReading | null = null;
  if (prov && "reason" in prov) {
    provisional = {
      state: "below-floor",
      month: prov.month,
      asOf: prov.asOf,
      n: prov.n,
      floor: prov.floor,
      closeDate: closeDateOf(prov.month),
      receipt: belowFloorWords(entity, prov),
    };
  } else if (prov) {
    provisional = {
      state: "leads",
      month: prov.month,
      asOf: prov.asOf,
      value: prov.value * f,
      lo: prov.lo * f,
      hi: prov.hi * f,
      stepPct: prov.stepPct,
      n: prov.n,
      thin: prov.thin,
      ...provisionalWords(prov),
      sample: sampleLine(prov.venues),
    };
  }

  if (provisional?.state === "leads") {
    return {
      lead: "provisional",
      figure: provisional.value,
      stepPct: provisional.stepPct,
      stepWindow: "MTD",
      close,
      provisional,
      other: close ? `${close.label}${close.stepPct != null ? ` · ${pct(close.stepPct)} 1m` : ""}` : null,
    };
  }
  return {
    lead: "close",
    figure: close?.value ?? null,
    stepPct: close?.stepPct ?? null,
    stepWindow: "1m",
    close,
    provisional,
    other: provisional?.state === "below-floor" ? provisional.receipt : null,
  };
}
