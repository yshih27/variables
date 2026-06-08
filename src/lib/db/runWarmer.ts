/**
 * runWarmer — the provenance wrapper every warmer runs inside.
 *
 * It records an honest `source_freshness` row on EVERY outcome:
 *   • success → status "ok" + rows written + duration
 *   • throw   → status "error" + the exception message + duration, then RE-THROWS
 *
 * Re-throwing matters: the GitHub Actions steps use `continue-on-error: true`,
 * which today swallows failures silently (that's how cc-sales rotted 27 days
 * unnoticed). With runWarmer the failure both (a) writes a visible error row the
 * UI/`check-freshness` surface, and (b) makes the step exit non-zero so the
 * Actions run shows red. Sibling steps still run because each is independent.
 *
 * `nextExpectedAt` is derived from the shared SOURCE_INTERVALS_MS cadence so the
 * staleness verdict can't drift between the warmer, the script, and the UI.
 */
import { recordFreshness, SOURCE_INTERVALS_MS } from "./freshness";

/** A warmer may return its row count for provenance, or nothing. */
export type WarmerOutcome = { rowsWritten?: number } | void;

export async function runWarmer<T extends WarmerOutcome>(
  source: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const interval = SOURCE_INTERVALS_MS[source];
  const nextExpectedAt = interval
    ? new Date(startedAt + interval).toISOString()
    : null;

  try {
    const result = await fn();
    const rowsWritten =
      result && typeof result === "object" && "rowsWritten" in result
        ? result.rowsWritten
        : undefined;
    await recordFreshness(source, {
      status: "ok",
      rowsWritten,
      durationMs: Date.now() - startedAt,
      nextExpectedAt,
    });
    return result;
  } catch (err) {
    await recordFreshness(source, {
      status: "error",
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message.slice(0, 500) : String(err),
      nextExpectedAt,
    });
    throw err;
  }
}
