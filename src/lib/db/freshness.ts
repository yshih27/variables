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

// ── Expected refresh cadence per source (drives the staleness verdict) ──
// Mirrors the GitHub Actions schedule in .github/workflows/warm.yml. A source
// is "stale" once it's older than 2× its interval — i.e. it has missed at
// least one full cycle. Shared by runWarmer (nextExpectedAt), the
// check-freshness script, and the UI freshness chips so they can never drift.
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const SOURCE_INTERVALS_MS: Record<string, number> = {
  // core batch — every 6h
  "core-volume": 6 * HOUR_MS,
  marketcap: 6 * HOUR_MS,
  listings: 6 * HOUR_MS,
  "courtyard-primary": 6 * HOUR_MS,
  "primary-revenue": 6 * HOUR_MS,
  history: 6 * HOUR_MS,
  "gacha-dune": 6 * HOUR_MS,
  // daily batch — every 24h
  holders: DAY_MS,
  "beezie-traits": DAY_MS,
  phygitals: DAY_MS,
  // weekly batch — every 7d
  "cc-traits": 7 * DAY_MS,
};

export type FreshnessState = "ok" | "stale" | "error" | "untracked";

/**
 * Pure verdict for one source: combine the recorded status with an age check.
 * `untracked` = no row at all (source isn't wired yet, e.g. a platform we
 * don't track) — deliberately distinct from `error` (a warmer that ran and
 * failed) and `stale` (ran ok once but hasn't refreshed in 2× its interval).
 */
export function freshnessState(
  source: string,
  row: FreshnessRow | undefined,
  now: number = Date.now(),
): { state: FreshnessState; ageMs: number | null } {
  if (!row) return { state: "untracked", ageMs: null };
  const ageMs = now - new Date(row.generated_at).getTime();
  if (row.status === "error") return { state: "error", ageMs };
  const interval = SOURCE_INTERVALS_MS[source] ?? 6 * HOUR_MS;
  if (ageMs > 2 * interval) return { state: "stale", ageMs };
  return { state: "ok", ageMs };
}
