/**
 * WHICH DAYS A WINDOWED DUNE SCAN COVERED — so a day with no rows is written as
 * a measured zero, never left blank.
 *
 * ⚠️ MEASURED 2026-09-22. Courtyard's on-chain secondary market is ~6 OpenSea
 * trades a day (194 in 30d, $3–25 each). Sep 20 had none; Sep 21's two landed
 * after the 11:12 UTC execution. The spine writer only wrote days that had a
 * sale, so the stream went silent for two complete days and check-invariants'
 * source-death gate — correctly reading "no write" as "no scan" — failed the
 * indices job. Silence and zero are different facts: the query `block_time >
 * now() - interval 'N' day` DID scan Sep 20 and found nothing. This module
 * names the days a scan actually covered so the writer can say so.
 *
 * The first day inside the window is partial (the window starts mid-day at
 * execution time minus N days) and is excluded; so is any day the execution had
 * not finished — a day is covered only when its end is at or before the
 * execution time. An unknown execution time covers nothing: the caller then
 * writes only what it saw, exactly as before.
 */
import { dayStartUtc } from "@/lib/data/metricSnapshots";

const DAY = 24 * 60 * 60 * 1000;

/** ISO day-starts (UTC) fully covered by a scan of `windowDays` ending at `executionEndedAt`. */
export function scannedCompleteDays(executionEndedAt: string | null, windowDays: number): string[] {
  if (!executionEndedAt) return [];
  const exec = Date.parse(executionEndedAt);
  if (!Number.isFinite(exec) || !(windowDays > 0)) return [];
  const first = Date.parse(dayStartUtc(exec - windowDays * DAY)) + DAY;
  const out: string[] = [];
  for (let d = first; d + DAY <= exec; d += DAY) out.push(dayStartUtc(d));
  return out;
}
