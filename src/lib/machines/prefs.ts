/**
 * The machines table's two reader preferences — how many rows it shows and
 * whether the card is open — one key each, per platform, in localStorage.
 *
 *   varible:machines:<platform>:rows → "top" | "all"      (default top)
 *   varible:machines:<platform>:open → "open" | "closed"  (default open)
 *
 * Per platform, so a reader who folds Collector Crypt's card has said nothing
 * about a second venue's, should one ever carry a board. Read after mount like
 * every other stored preference (see `useStoredPref`), never during render.
 */

/** Rows shown by default — of the CURRENT sort, so "top 10 by spend" becomes
 *  "top 10 by pulls" the moment the reader re-sorts. */
export const TOP_ROWS = 10;

export const ROWS_PREF = ["top", "all"] as const;
export const OPEN_PREF = ["open", "closed"] as const;
export type RowsPref = (typeof ROWS_PREF)[number];
export type OpenPref = (typeof OPEN_PREF)[number];

export function machinesPrefKey(platform: string, pref: "rows" | "open"): string {
  return `varible:machines:${platform}:${pref}`;
}

/** The fragment that opens the card with every row — a link to "the machines"
 *  must never land on a folded card or a truncated table. */
export const MACHINES_ANCHOR = "machines";
