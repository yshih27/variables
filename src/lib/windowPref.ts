"use client";

import { useEffect, useState } from "react";

/**
 * Per-surface window/period preference — which grain a reader last chose on a
 * given chart or table. `localStorage`, frontend-only, no account, no server
 * round-trip; the same guarded shape as `src/lib/watchlist.ts`.
 *
 * Surfaces (one key each, so a choice on /ips doesn't move /platforms):
 *   studio:market · studio:platform · studio:platform:<key>
 *   cards:ips · cards:platforms · cards:platform:<key>
 *   table:ips · table:platforms
 */
export const WINDOW_PREF_PREFIX = "varible:window:";

export function windowPrefKey(surface: string): string {
  return `${WINDOW_PREF_PREFIX}${surface}`;
}

export function readWindowPref(surface: string): string | null {
  try {
    return localStorage.getItem(windowPrefKey(surface));
  } catch {
    return null; // private mode / blocked storage — the toggle just won't persist
  }
}

export function writeWindowPref(surface: string, value: string): void {
  try {
    localStorage.setItem(windowPrefKey(surface), value);
  } catch {
    /* storage full / blocked */
  }
}

/**
 * State hook for a persisted window choice.
 *
 * ⚠️ THE STORED VALUE IS READ IN AN EFFECT, NEVER IN THE INITIAL RENDER. The
 * server has no storage, so a lazy `useState(() => readWindowPref(...))` would
 * make the client's first render disagree with the server's HTML and React would
 * report a hydration mismatch. Mounting on `fallback` and repainting once — a
 * brief D→W flick on load — is the trade this makes deliberately; a hydration
 * warning is not acceptable.
 *
 * (`useSyncExternalStore` looks like the tidier primitive here and was tried
 * first, with a never-firing `subscribe` so the store would act as a read-once
 * default. It renders `getServerSnapshot` through hydration and then never
 * repaints, so the stored value was read and silently discarded — verified live.
 * The effect is the version that actually restores the preference.)
 *
 * Each instance holds its OWN state. Three cards sharing the "cards:ips" key must
 * still move independently once a reader starts clicking — the toggles are
 * per-chart, not page-level. What they share is only where they start next visit.
 *
 * `surface: null` opts out of persistence entirely (the homepage teasers, which
 * have no window control of their own).
 */
export function useWindowPref<T extends string>(
  surface: string | null,
  allowed: readonly T[],
  fallback: T,
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(fallback);

  // `allowed` is a module-level literal at every call site, so it is referentially
  // stable and listing it can't make this re-run and stomp a live choice.
  useEffect(() => {
    if (!surface) return;
    const stored = readWindowPref(surface);
    if (!stored || !(allowed as readonly string[]).includes(stored)) return;
    // The ONE repaint this rule warns about is exactly the intent here: storage
    // cannot be read during render without a hydration mismatch, so the restore
    // has to land after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(stored as T);
  }, [surface, allowed]);

  return [
    value,
    (v: T) => {
      setValue(v);
      if (surface) writeWindowPref(surface, v);
    },
  ];
}
