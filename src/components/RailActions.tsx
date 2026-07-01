"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Watchlist + Share actions for the IP / Platform rails (QA-1). Both were dead
 * no-op buttons; now real and frontend-only:
 *   • Watchlist — toggles this entity in a `localStorage` set (`ip:pokemon`,
 *     `platform:beezie`, …), keyed off the current route so the rails don't have
 *     to thread an id. Read through useSyncExternalStore so every mounted copy
 *     (and a future `/watchlist` view) stays in sync, hydration-safe.
 *   • Share — Web Share sheet on devices that support it, else copy the link and
 *     flash "Copied". Cancelling the native sheet is a no-op (we don't then copy).
 */
const STORE_KEY = "variable:watchlist";

function readList(): string[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// Tiny external store so same-tab writes notify subscribers (the `storage` event
// only fires for OTHER tabs).
const listeners = new Set<() => void>();
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function writeList(next: string[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* storage full / blocked — the button just won't persist */
  }
  for (const l of listeners) l();
}

const BTN =
  "flex h-[38px] flex-1 items-center justify-center gap-2 rounded-[11px] border text-[13px] font-semibold transition-colors";

export function RailActions({ name }: { name: string }) {
  const pathname = usePathname() ?? "";
  const seg = pathname.split("/").filter(Boolean);
  // e.g. "/ip/pokemon" → "ip:pokemon"; "/platform/collector-crypt" → "platform:collector-crypt".
  const id = seg.length >= 2 ? `${seg[0]}:${seg[1]}` : null;

  // Server + first client render return false (no mismatch); real state resolves
  // after hydration via the store snapshot.
  const saved = useSyncExternalStore(
    subscribe,
    () => (id ? readList().includes(id) : false),
    () => false,
  );
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  function toggleWatch() {
    if (!id) return;
    const list = readList();
    writeList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function share() {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    const shareData = { title: `${name} · VARIABLE`, url };
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share(shareData);
      } catch {
        /* user dismissed the sheet — intentional no-op */
      }
      return;
    }
    // No Web Share API (most desktops) → copy the link and confirm.
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — nothing more we can do gracefully */
    }
  }

  return (
    <div className="mt-auto flex gap-2 pt-[22px]">
      <button
        type="button"
        onClick={toggleWatch}
        aria-pressed={saved}
        className={`${BTN} ${
          saved
            ? "border-yellow/40 bg-yellow/10 text-yellow"
            : "border-line-2 bg-transparent text-ink hover:bg-bg-2"
        }`}
      >
        {saved ? "★ Watchlisted" : "☆ Watchlist"}
      </button>
      <button
        type="button"
        onClick={share}
        className={`${BTN} border-line-2 bg-transparent text-ink hover:bg-bg-2`}
      >
        {copied ? "✓ Copied" : "↗ Share"}
      </button>
    </div>
  );
}
