/**
 * source_freshness helpers — the honest "as of" / provenance layer.
 *
 * Every warmer calls recordFreshness() when it finishes (ok or error). The UI
 * reads readFreshness() to show a real per-source timestamp instead of a fake
 * "Live" badge. See MIGRATION_PLAN.md §3.7.
 */
import { db } from "./client";

export type FreshnessStatus = "ok" | "stale" | "error";

export type FreshnessRow = {
  source: string;
  generated_at: string;
  status: FreshnessStatus;
  rows_written: number | null;
  duration_ms: number | null;
  error: string | null;
  next_expected_at: string | null;
};

export async function recordFreshness(
  source: string,
  info: {
    status?: FreshnessStatus;
    rowsWritten?: number;
    durationMs?: number;
    error?: string | null;
    /** Defaults to now. */
    generatedAt?: string;
    nextExpectedAt?: string | null;
  } = {},
): Promise<void> {
  const { error } = await db()
    .from("source_freshness")
    .upsert({
      source,
      generated_at: info.generatedAt ?? new Date().toISOString(),
      status: info.status ?? "ok",
      rows_written: info.rowsWritten ?? null,
      duration_ms: info.durationMs ?? null,
      error: info.error ?? null,
      next_expected_at: info.nextExpectedAt ?? null,
    });
  // Freshness is metadata: a warm that already wrote its data must not fail just
  // because this ping didn't land. Log loudly instead of throwing.
  if (error) console.warn(`[freshness] failed to record "${source}": ${error.message}`);
}

/** Read freshness rows for the given sources (or all of them). */
export async function readFreshness(sources?: string[]): Promise<FreshnessRow[]> {
  let q = db().from("source_freshness").select("*");
  if (sources && sources.length) q = q.in("source", sources);
  const { data, error } = await q;
  if (error) {
    console.warn(`[freshness] read failed: ${error.message}`);
    return [];
  }
  return (data as FreshnessRow[]) ?? [];
}
