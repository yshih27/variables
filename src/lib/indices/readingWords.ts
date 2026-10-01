import type { IndexProvisional, StepVenues } from "@/lib/data/indices";
import { STEP_LIMIT_PCT } from "@/lib/data/identityIndex";
import { PLATFORM_META, type CardPlatform } from "@/lib/card/ids";

/**
 * The V's words, with no data imports — safe in a client component (the Index
 * Studio draws the provisional in the browser). `reading.ts` re-exports these
 * and adds the server-side decision of what leads.
 *
 * ⚠️ NOTHING HERE COMPUTES A NUMBER: it names months, derives the close date
 * from `month`, formats timestamps and lays out the backend's counts.
 */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10" → "October". */
export function monthName(month: string): string {
  const m = Number(month.slice(5, 7));
  return MONTH[m - 1] ?? month;
}

/** "2026-10" → "Nov 1" — the day the month's close publishes (the first of the next month, UTC). */
export function closeDateOf(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if (!y || !m) return "—";
  const next = m === 12 ? 1 : m + 1;
  return `${MON[next - 1]} 1`;
}

/** "2026-10-14T09:12:33Z" → "Oct 14 09:12 UTC". */
export function asOfStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()} ${hh}:${mm} UTC`;
}

/** A series point's month ("2026-09-30T…" → "2026-09"). */
export const monthOf = (ts: string): string => ts.slice(0, 7);

/** Who an entity's floor is for, in the below-floor sentence. */
function floorNoun(entity: string): string {
  if (entity === "market") return "the market";
  if (entity === "category") return "a category";
  if (entity === "ip") return "an IP";
  return "this index";
}

function venueLabel(v: string): string {
  return PLATFORM_META[v as CardPlatform]?.label ?? v;
}

/**
 * `sample: Beezie 31 · Collector Crypt 22 identities` — the venues a step rests
 * on, largest first, from the backend's `venues`. An identity sold on two venues
 * counts under each, so when `multiVenue` > 0 the line says by how many rather
 * than let the per-venue counts read as distinct.
 */
export function sampleLine(v: StepVenues | null | undefined): { line: string; note: string | null } | null {
  if (!v || !v.byVenue) return null;
  const parts = Object.entries(v.byVenue)
    .filter(([, x]) => x.identities > 0)
    .sort((a, b) => b[1].identities - a[1].identities)
    .map(([venue, x]) => `${venueLabel(venue)} ${x.identities}`);
  if (!parts.length) return null;
  const note =
    v.multiVenue > 0
      ? `${v.multiVenue} identit${v.multiVenue === 1 ? "y" : "ies"} sold on more than one venue, counted on each`
      : null;
  return { line: `sample: ${parts.join(" · ")} identit${v.identities === 1 ? "y" : "ies"}`, note };
}

/** The chip and receipt line of a provisional that clears its floor. */
export function provisionalWords(p: Extract<IndexProvisional, { value: number }>): { chip: string; receipt: string; closeDate: string } {
  return {
    chip: `${monthName(p.month)} so far · provisional`,
    // asOf is the newest sale in the sample; null when the backend has none to name.
    receipt: `${p.n} identit${p.n === 1 ? "y" : "ies"} · closes ${closeDateOf(p.month)}${p.asOf ? ` · as of ${asOfStamp(p.asOf)}` : ""}`,
    closeDate: closeDateOf(p.month),
  };
}

/**
 * The receipt line of a running month that is not shown: under its floor, or
 * (on a thin sample) a step past the limit the builder holds at.
 */
export function belowFloorWords(entity: string, p: Extract<IndexProvisional, { reason: string }>): string {
  const head = `${monthName(p.month)} so far: ${p.n} identit${p.n === 1 ? "y" : "ies"}`;
  const tail = `the close publishes ${closeDateOf(p.month)}`;
  if (p.reason === "step-limit") {
    return `${head}, a step past the ±${STEP_LIMIT_PCT}% limit on a thin sample, not shown; ${tail}`;
  }
  return `${head}, under the ${p.floor} ${floorNoun(entity)} needs; ${tail}`;
}
