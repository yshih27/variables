/**
 * Watchlist store — a `localStorage` set of entity ids ("ip:pokemon",
 * "platform:beezie"), shared by the rail toggle (RailActions) and the
 * /watchlist page. Frontend-only: no account, no server round-trip.
 *
 * Same-tab writes notify subscribers through the local listener set (the
 * `storage` event only fires for OTHER tabs), so every mounted consumer —
 * rail button, nav, /watchlist view — stays in sync via useSyncExternalStore.
 */
export const WATCHLIST_KEY = "variable:watchlist";

const EMPTY = "[]";

export function readWatchlistRaw(): string {
  try {
    return localStorage.getItem(WATCHLIST_KEY) ?? EMPTY;
  } catch {
    return EMPTY;
  }
}

export function readWatchlist(): string[] {
  try {
    const arr = JSON.parse(readWatchlistRaw());
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();

export function subscribeWatchlist(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function writeWatchlist(next: string[]): void {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
  } catch {
    /* storage full / blocked — the toggle just won't persist */
  }
  for (const l of listeners) l();
}

export function toggleWatchlist(id: string): void {
  const list = readWatchlist();
  writeWatchlist(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
}
