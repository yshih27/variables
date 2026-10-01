import { monthStartUtc } from "@/lib/chart/period";
import { weekStartUtc } from "@/lib/data/priceIndex";

/**
 * Where the in-progress period starts, for INV-7 (`scripts/check-invariants.ts`):
 * a published index point must be stamped strictly before it.
 *
 * ⚠️ THE PERIOD IS THE BLOB'S CADENCE. INV-7 was written for the weekly index and
 * compared every newest point with the running WEEK's Monday. Since v4 the blob is
 * monthly (`cadence: "monthly"`), and a month-end that falls inside the current
 * calendar week then read as "the in-progress week": the September close, stamped
 * 2026-09-30 and published at 00:17 UTC on Oct 1, failed the gate on all eight
 * series (the running week's Monday was Sep 28), and would have kept every indices
 * and daily run red until Oct 5, and again after every month-end. For a monthly
 * blob the running period starts on the 1st of the current month; a weekly or
 * undeclared (pre-v4) blob keeps the Monday rule.
 */
export function indexCompletenessCutoff(
  cadence: string | undefined,
  nowMs: number,
): { cutoffMs: number; period: "month" | "week" } {
  return cadence === "monthly"
    ? { cutoffMs: Date.parse(monthStartUtc(nowMs)), period: "month" }
    : { cutoffMs: Date.parse(weekStartUtc(nowMs)), period: "week" };
}
