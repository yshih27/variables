"use client";

import { useSyncExternalStore } from "react";

/**
 * "12m ago", computed in the BROWSER from the timestamp.
 *
 * ⚠️ NEVER ON THE SERVER. /gacha is cached for an hour; an age rendered into
 * that HTML would read "3m ago" for the whole hour. The server snapshot is
 * null (nothing printed), the client fills it after hydration and refreshes it
 * every minute from one shared clock.
 */
let now = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, 60_000);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function agoText(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || !nowMs) return "";
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  const h = Math.round(s / 3600);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function Ago({ at, prefix = "" }: { at: string; prefix?: string }) {
  const nowMs = useSyncExternalStore(subscribe, () => now || Date.now(), () => 0);
  const t = agoText(at, nowMs);
  return t ? (
    <span suppressHydrationWarning>
      {prefix}
      {t}
    </span>
  ) : null;
}
