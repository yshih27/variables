/**
 * Addresses looked up on this device — the door's short list, the watchlist's
 * pattern (`src/lib/watchlist.ts`): a `localStorage` array, same-tab listeners,
 * read through useSyncExternalStore so nothing touches storage during render.
 *
 * ⚠️ THIS DEVICE ONLY, AND ONLY THE LAST FIVE. The site never records who
 * looked up whom; this list exists so a reader can get back to their own
 * wallet, lives in their browser, and is theirs to remove.
 */
export const VAULT_RECENT_KEY = "varible:vault-recent";
export const VAULT_RECENT_MAX = 5;

const EMPTY = "[]";

export function readVaultRecentRaw(): string {
  try {
    return localStorage.getItem(VAULT_RECENT_KEY) ?? EMPTY;
  } catch {
    return EMPTY;
  }
}

export function parseVaultRecent(raw: string): string[] {
  try {
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string").slice(0, VAULT_RECENT_MAX) : [];
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();

export function subscribeVaultRecent(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function write(next: string[]): void {
  try {
    localStorage.setItem(VAULT_RECENT_KEY, JSON.stringify(next.slice(0, VAULT_RECENT_MAX)));
  } catch {
    /* storage blocked — the list just won't persist */
  }
  for (const l of listeners) l();
}

/** Most recent first; a repeat moves to the top rather than appearing twice. */
export function rememberVaultAddress(address: string): void {
  const list = parseVaultRecent(readVaultRecentRaw());
  write([address, ...list.filter((a) => a !== address)]);
}

export function forgetVaultAddress(address: string): void {
  write(parseVaultRecent(readVaultRecentRaw()).filter((a) => a !== address));
}
