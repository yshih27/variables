/**
 * Renaiss constants the copy prints as well as the code uses — kept in a module
 * with no imports, so the methodology page can read them without pulling the
 * warmers' database and API clients into its bundle, and the copy cannot drift
 * from what the warmers do.
 */

/** How far back every incremental pulls run re-reads, for prizes Renaiss names after the pull. */
export const PULLS_REREAD_DAYS = 14;
