/**
 * The rail's open/icons preference — one key, read in three places (the
 * pre-hydration script, the rail toggle, and the shell's grid CSS via the
 * `data-rail` attribute it stamps).
 *
 * Kept in its own module so the inline script and the React component can't
 * disagree about the key name or the allowed values.
 */
export const RAIL_PREF_KEY = "varible:rail";
export type RailPref = "open" | "icons";

/** Which categories the reader has expanded. Own key, own shape (a per-category
 *  map), so it can't collide with the open/icons preference above. */
export const RAIL_OPEN_KEY = "varible:rail:open";

/**
 * The script that runs BEFORE hydration, stamping `data-rail` on <html>.
 *
 * ⚠️ It has to be inline and synchronous. The rail's width is a CSS variable the
 * grid reads, so a stored "icons" applied in an effect would paint a 240px rail
 * and then snap it to 56px — a 184px layout shift on every load for anyone who
 * collapsed it. Same technique the density toggle uses in S3.
 *
 * Wrapped in try/catch: a blocked localStorage must not throw before the app
 * mounts. No value stamped = the CSS default (240px at ≥1280).
 */
export const RAIL_PREF_SCRIPT = `try{var v=localStorage.getItem(${JSON.stringify(RAIL_PREF_KEY)});if(v==="icons"||v==="open")document.documentElement.setAttribute("data-rail",v)}catch(e){}`;


/**
 * The open/icons preference as a tiny shared store.
 *
 * ⚠️ TWO CONTROLS NOW DRIVE IT — the chevron beside the brand mark and the one at
 * the rail's foot — plus the ⌘\ shortcut, so a component-local useState would let
 * them disagree the moment one of them fired. Same listener-set pattern as
 * `watchlist.ts`: one writer, everyone re-reads.
 */
const listeners = new Set<() => void>();

export function readRailPref(): RailPref {
  // The DOM is the truth in the browser: the pre-hydration script already stamped
  // it, so reading the attribute can't disagree with what is painted.
  if (typeof document !== "undefined") {
    const v = document.documentElement.getAttribute("data-rail");
    if (v === "icons" || v === "open") return v;
  }
  try {
    const v = localStorage.getItem(RAIL_PREF_KEY);
    if (v === "icons" || v === "open") return v;
  } catch {
    /* blocked storage */
  }
  return "open";
}

export function applyRailPref(next: RailPref): void {
  document.documentElement.setAttribute("data-rail", next);
  try {
    localStorage.setItem(RAIL_PREF_KEY, next);
  } catch {
    /* blocked storage — the rail just won't remember */
  }
  for (const l of listeners) l();
}

export function toggleRailPref(): void {
  applyRailPref(readRailPref() === "icons" ? "open" : "icons");
}

export function subscribeRailPref(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
