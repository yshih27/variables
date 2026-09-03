"use client";

/**
 * SHELL_V2 per-viewer preferences (S3): density and the palette's recents.
 *
 * Same guarded shape as `watchlist.ts` and `windowPref.ts` — every read and write
 * wrapped, because a blocked localStorage must degrade to "doesn't remember",
 * never to a thrown error inside chrome that renders on every route.
 */
export const DENSITY_KEY = "varible:density";
export const RECENT_KEY = "varible:recent";
export const RECENT_MAX = 8;

export type Density = "comfortable" | "compact";

export function readDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

/** Write + apply. `data-density` on <html> is what the CSS reads, so the write and
 *  the paint happen together and can't drift. */
export function writeDensity(v: Density): void {
  try {
    localStorage.setItem(DENSITY_KEY, v);
  } catch {
    /* blocked storage */
  }
  document.documentElement.setAttribute("data-density", v);
}

/**
 * The script that stamps `data-density` BEFORE hydration.
 *
 * ⚠️ Inline and synchronous, for the same reason the rail's is: compact changes
 * every table row's height, so applying it in an effect would paint the
 * comfortable layout and then jump the whole page. Same technique, same file
 * shape — see components/shell/railPref.ts.
 */
export const DENSITY_SCRIPT = `try{var d=localStorage.getItem(${JSON.stringify(DENSITY_KEY)});document.documentElement.setAttribute("data-density",d==="compact"?"compact":"comfortable")}catch(e){document.documentElement.setAttribute("data-density","comfortable")}`;

export type RecentEntry = { label: string; href: string };

export function readRecents(): RecentEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r): r is RecentEntry => !!r && typeof r.label === "string" && typeof r.href === "string")
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

/** Most-recent-first, deduped on href, capped at RECENT_MAX. */
export function pushRecent(entry: RecentEntry): void {
  try {
    const next = [entry, ...readRecents().filter((r) => r.href !== entry.href)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* blocked storage */
  }
}
