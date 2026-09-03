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
