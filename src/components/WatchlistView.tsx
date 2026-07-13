"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import type { IPRow, PlatformRow } from "@/lib/types";
import { IPTable } from "./IPTable";
import { PlatformTable } from "./PlatformTable";
import { readWatchlistRaw, subscribeWatchlist } from "@/lib/watchlist";

/**
 * /watchlist body — filters the (server-provided) IP + platform tables down to
 * the entities saved via the rail ☆ toggle. The list itself lives in
 * localStorage (lib/watchlist), so the page is ISR-cacheable: the server sends
 * full rows, the client picks the saved ones after hydration.
 *
 * The raw JSON string is the useSyncExternalStore snapshot (strings are
 * referentially stable across calls; a fresh array each call would loop).
 */
export function WatchlistView({ ips, platforms }: { ips: IPRow[]; platforms: PlatformRow[] }) {
  const raw = useSyncExternalStore(subscribeWatchlist, readWatchlistRaw, () => "[]");
  const saved = useMemo(() => {
    try {
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
    } catch {
      return new Set<string>();
    }
  }, [raw]);

  // Don't flash the empty state during hydration (server snapshot is always []):
  // this store reads true only on the client, false during SSR/hydration.
  const hydrated = useSyncExternalStore(
    subscribeWatchlist,
    () => true,
    () => false,
  );

  const savedIps = ips.filter((r) => saved.has(`ip:${r.key}`));
  const savedPlatforms = platforms.filter((r) => saved.has(`platform:${r.key}`));
  // Saved ids whose entity isn't in the tracked tables anymore (renamed/dropped).
  const orphans = [...saved].filter(
    (id) =>
      !savedIps.some((r) => id === `ip:${r.key}`) &&
      !savedPlatforms.some((r) => id === `platform:${r.key}`),
  );

  if (!hydrated) return null;

  if (savedIps.length === 0 && savedPlatforms.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line px-8 py-16 text-center">
        <div className="text-[15px] font-semibold">No watchlisted items yet.</div>
        <p className="mx-auto mt-2 max-w-md text-[12.5px] leading-relaxed text-ink-3">
          Visit any{" "}
          <Link href="/ips" className="text-ink-2 underline decoration-line underline-offset-2 hover:text-yellow">
            Categories
          </Link>{" "}
          or{" "}
          <Link href="/platforms" className="text-ink-2 underline decoration-line underline-offset-2 hover:text-yellow">
            Platforms
          </Link>{" "}
          page and click <span className="text-ink-2">☆ Watchlist</span> to add them here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {savedIps.length > 0 && <IPTable rows={savedIps} seeAllHref="/ips" teaser title="IPs" />}
      {savedPlatforms.length > 0 && <PlatformTable rows={savedPlatforms} seeAllHref="/platforms" title="Platforms" />}
      {orphans.length > 0 && (
        <p className="text-[11.5px] text-ink-4">
          {orphans.length} saved {orphans.length === 1 ? "entry is" : "entries are"} no longer
          tracked and {orphans.length === 1 ? "is" : "are"} hidden.
        </p>
      )}
    </div>
  );
}
