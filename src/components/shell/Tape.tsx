"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TapeItem } from "@/lib/types";
import { deltaDir, formatDelta } from "@/lib/format";
import { relativeAge } from "./relativeTime";

/**
 * The tape (SHELL_V2 S2, north-star Move 2) — a 32px band of REALIZED events
 * between the top bar and the content: cleared sales, paid pulls, index closes.
 * Nobody else in the space shows the market actually clearing.
 *
 * SERVER-RENDERED FIRST. `initial` arrives in the layout's HTML, so the band is
 * never empty-then-populated on load; the client only refreshes it.
 *
 * ⚠️ THE REFRESH IS NOT ON THE CRITICAL PATH and does not run in a background
 * tab. It fires 60s after mount and only while `document.visibilityState` is
 * "visible", so a tab left open overnight makes no requests, and a hidden tab
 * doesn't animate either.
 *
 * ⚠️ NO FAKE URGENCY. Every item carries its true age; nothing past 24h is shown
 * (the server drops it, and `live()` drops it again on the client as the page
 * sits open); an empty window says so in one quiet line rather than replaying
 * yesterday's events to keep the band looking busy.
 */

const REFRESH_MS = 60_000;

export function Tape({ initial }: { initial: TapeItem[] }) {
  const [items, setItems] = useState<TapeItem[]>(initial);
  const [paused, setPaused] = useState(false);
  // Rendered ages are derived from a clock the component OWNS, ticked on the
  // refresh cadence — reading Date.now() during render would be impure and would
  // also disagree between the server HTML and hydration.
  const [nowMs, setNowMs] = useState<number | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/internal/tape", { cache: "no-store" });
        if (!res.ok) return; // route not live yet (backend brief) — keep what we have
        // The route answers in the internal v1 envelope: { ok, meta, data: TapeItem[] }.
        const next = (await res.json()) as { data?: TapeItem[]; items?: TapeItem[] } | TapeItem[];
        const list = Array.isArray(next) ? next : (next.data ?? next.items);
        if (!cancelled && Array.isArray(list)) setItems(list);
      } catch {
        /* offline / aborted — the band keeps the events it already has */
      }
    };

    // First clock read AFTER mount, so ages start rendering without a hydration
    // mismatch against the server's ageless first paint. The one repaint this
    // rule warns about is the intent — the clock cannot be read during render
    // without making the component impure AND breaking hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowMs(Date.now());
    timer.current = window.setInterval(() => {
      setNowMs(Date.now());
      void tick();
    }, REFRESH_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setNowMs(Date.now());
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer.current != null) window.clearInterval(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Age out items as the page sits open: a sale that was 23h old on load must
  // leave the band an hour later rather than quietly becoming a 25h-old "live" event.
  const live = useMemo(
    // Sales and pulls age out at 24h. Index closes are EXEMPT: a weekly close is
    // days old by construction and its label already states that age ("· 4d ago"),
    // which is the house treatment for an older-but-honest point.
    () =>
      nowMs == null
        ? items
        : items.filter((it) => it.kind === "index" || relativeAge(Date.parse(it.ts), nowMs) != null),
    [items, nowMs],
  );

  if (live.length === 0) {
    return (
      <div className="flex h-[var(--shell-tape-h)] items-center border-b border-line/40 px-4 text-[11.5px] text-ink-4 sm:px-5">
        no cleared sales in the last 24h
      </div>
    );
  }

  return (
    <div
      className="tape-band relative flex h-[var(--shell-tape-h)] items-center overflow-hidden border-b border-line/40"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      data-paused={paused ? "" : undefined}
    >
      {/* Two identical runs so the marquee wraps seamlessly. The SECOND is
          aria-hidden and inert: a screen reader must not read the feed twice,
          and Tab must not walk a duplicate set of links. */}
      <TapeRun items={live} nowMs={nowMs} />
      <TapeRun items={live} nowMs={nowMs} duplicate />
    </div>
  );
}

function TapeRun({
  items,
  nowMs,
  duplicate,
}: {
  items: TapeItem[];
  nowMs: number | null;
  duplicate?: boolean;
}) {
  return (
    <div
      className="tape-run flex shrink-0 items-center gap-x-7 px-4 sm:px-5"
      aria-hidden={duplicate || undefined}
      // `inert` keeps the duplicate run out of the tab order entirely — aria-hidden
      // alone hides it from the accessibility tree but leaves its links tabbable,
      // which would make Tab walk the whole feed twice.
      inert={duplicate}
    >
      {items.map((it) => (
        <TapeEntry key={it.id} item={it} nowMs={nowMs} />
      ))}
    </div>
  );
}

const KIND_LABEL: Record<TapeItem["kind"], string> = {
  sale: "sold",
  pull: "pull",
  index: "close",
};

function TapeEntry({ item, nowMs }: { item: TapeItem; nowMs: number | null }) {
  // Index closes carry their age inside the label; rendering a second one here
  // would print "· 4d ago 4d ago".
  const age = nowMs == null || item.kind === "index" ? null : relativeAge(Date.parse(item.ts), nowMs);
  const dir = deltaDir(item.deltaPct);
  const deltaCls = dir === "up" ? "text-green" : dir === "down" ? "text-red" : "text-ink-3";
  return (
    <Link
      href={item.href}
      className="group flex shrink-0 items-center gap-2 whitespace-nowrap text-[11.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
    >
      <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-4">
        {KIND_LABEL[item.kind]}
      </span>
      {/* Prose label — dropped below sm, where the brief's compressed marquee is
          just the value and its age. */}
      <span className="hidden max-w-[280px] truncate text-ink-2 group-hover:text-ink sm:inline">
        {item.label}
      </span>
      <span className="tabular font-semibold text-ink transition-colors group-hover:text-yellow">
        {item.valueText}
      </span>
      {/* A delta only where the event actually HAS one. */}
      {item.deltaPct != null && Number.isFinite(item.deltaPct) && (
        <span className={`tabular font-semibold ${deltaCls}`}>{formatDelta(item.deltaPct)}</span>
      )}
      {/* The age is the honesty. It renders once the client clock exists; the
          server paint carries the events without claiming a freshness it can't
          compute without reading the clock during render. */}
      {age && <span className="text-ink-4">{age}</span>}
    </Link>
  );
}
