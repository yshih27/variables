/**
 * Renaiss constants the copy prints as well as the code uses — kept in a module
 * with no imports, so the methodology page can read them without pulling the
 * warmers' database and API clients into its bundle, and the copy cannot drift
 * from what the warmers do.
 */

/** How far back every incremental pulls run re-reads, for prizes Renaiss names after the pull. */
export const PULLS_REREAD_DAYS = 14;

/** Below this share of held tokens carrying a stated value, Renaiss's market cap is withheld (holders.ts). */
export const STATED_MCAP_MIN_COVERAGE = 0.8;

/** The machine board's window, in complete days (machines.ts). */
export const RENAISS_MACHINE_WINDOW_DAYS = 30;
