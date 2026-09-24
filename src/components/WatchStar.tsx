"use client";

import { useSyncExternalStore } from "react";
import { readWatchlist, subscribeWatchlist, toggleWatchlist } from "@/lib/watchlist";

/**
 * The star — one toggle in the shared `lib/watchlist` localStorage set, for any
 * entity the site can watch (`ip:`, `platform:`, `identity:`). The IP and
 * platform rails use it through `RailActions`; the identity header uses it
 * directly with the card's canonical id.
 *
 * ⚠️ IT WRITES NOTHING TO A SERVER. A star is a bookmark on this device; an
 * alert is a separate, confirmed subscription (`AlertMe`). Keeping the two
 * apart is what lets the star stay instant and account-free.
 *
 * Read through useSyncExternalStore: the server and first client render say
 * "not starred" (no mismatch), the stored state lands after hydration.
 */
export const WATCH_BTN_RAIL =
  "flex h-[38px] flex-1 items-center justify-center gap-2 rounded-xl border text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60";

const WATCH_BTN_COMPACT =
  "inline-flex h-[30px] items-center gap-1.5 rounded-md border px-2.5 font-mono text-[11.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60";

export function WatchStar({ id, variant = "rail" }: { id: string | null; variant?: "rail" | "compact" }) {
  const saved = useSyncExternalStore(
    subscribeWatchlist,
    () => (id ? readWatchlist().includes(id) : false),
    () => false,
  );
  const base = variant === "rail" ? WATCH_BTN_RAIL : WATCH_BTN_COMPACT;
  return (
    <button
      type="button"
      onClick={() => id && toggleWatchlist(id)}
      aria-pressed={saved}
      disabled={!id}
      data-watch-star={id ?? ""}
      className={`${base} ${
        saved
          ? "border-yellow/40 bg-yellow/10 text-yellow"
          : variant === "rail"
            ? "border-line-2 bg-transparent text-ink hover:bg-bg-2"
            : "border-line bg-bg-1 text-ink-2 hover:border-line-2 hover:text-ink"
      }`}
    >
      {saved ? "★ Watchlisted" : "☆ Watchlist"}
    </button>
  );
}
