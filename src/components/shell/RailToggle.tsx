"use client";

import { useRailPref } from "./useRailPref";

/**
 * The rail's expand/collapse chevron (polish r1, item 3).
 *
 * TWO instances render it — one beside the brand mark in the top bar (the primary,
 * where a collapsed rail's reader actually looks) and one at the rail's foot (a
 * duplicate that stays reachable on a long page). Both drive the same shared
 * store, so they can never show opposite arrows.
 *
 * ⚠️ Only mounted at ≥1280 by its callers. Between 1024 and 1279 the rail is
 * iconised BY THE VIEWPORT and there is nothing to choose, so a control there
 * would promise something it can't do.
 */
export function RailToggle({ variant }: { variant: "top" | "foot" }) {
  const [pref, setPref] = useRailPref();
  const collapsed = pref === "icons";
  const label = collapsed ? "Expand rail (⌘\\)" : "Collapse rail (⌘\\)";

  if (variant === "top") {
    return (
      <button
        type="button"
        onClick={() => setPref(collapsed ? "open" : "icons")}
        aria-label={label}
        aria-keyshortcuts="Meta+\\ Control+\\"
        title={label}
        className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-4 transition-colors hover:bg-bg-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60 xl:flex"
      >
        <Chevron open={!collapsed} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPref(collapsed ? "open" : "icons")}
      aria-label={label}
      aria-keyshortcuts="Meta+\\ Control+\\"
      title={label}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] text-ink-3 transition-colors hover:bg-bg-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
    >
      <Chevron open={!collapsed} />
      <span className="rail-label whitespace-nowrap">Collapse</span>
    </button>
  );
}

/** ‹ when the rail is open (click to collapse), › when it is collapsed. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d={open ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
