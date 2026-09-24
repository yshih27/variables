/**
 * Watchlist store — a `localStorage` set of entity ids ("ip:pokemon",
 * "platform:beezie", "identity:pokemon/151/6/charizard-ex/psa-10/jp"), shared by
 * the star (WatchStar: the IP and platform rails, the identity header) and the
 * /watchlist page. Frontend-only: no account, no server round-trip — a watch
 * that WRITES is an alert (`/api/alerts`), a separate, confirmed thing.
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

/** The three entity kinds a star can hold — the same three an alert can watch. */
export type WatchKind = "ip" | "platform" | "identity";

/**
 * An identity is watched by its CANONICAL slug — the card's one URL — so a
 * star set on a v4.1 form and one set on the canonical page are the same star.
 */
export const identityWatchId = (canonicalSlug: string): string => `identity:${canonicalSlug}`;

/** "identity:pokemon/151/…" → { kind: "identity", key: "pokemon/151/…" }; null for anything else. */
export function parseWatchId(id: string): { kind: WatchKind; key: string } | null {
  const i = id.indexOf(":");
  if (i <= 0) return null;
  const kind = id.slice(0, i);
  const key = id.slice(i + 1);
  if (!key || (kind !== "ip" && kind !== "platform" && kind !== "identity")) return null;
  return { kind, key };
}

/**
 * The watch id a route is about: `/ip/<k>` → `ip:<k>`, `/platform/<k>` →
 * `platform:<k>`, `/i/<slug…>` → `identity:<slug>`. The identity form takes the
 * path as it is; the identity header passes its canonical id explicitly, so
 * this is the fallback for a caller that only has a route.
 */
export function watchIdForPath(pathname: string): string | null {
  const seg = pathname.split("/").filter(Boolean);
  if (seg[0] === "i" && seg.length >= 6) return identityWatchId(seg.slice(1).map(safeDecode).join("/"));
  if ((seg[0] === "ip" || seg[0] === "platform") && seg[1]) return `${seg[0]}:${seg[1]}`;
  return null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
