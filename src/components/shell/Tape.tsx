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

/**
 * Constant scroll speed, in px/s.
 *
 * ⚠️ THE DURATION IS DERIVED, NOT FIXED. A fixed 90s over the run's width meant
 * pixel speed grew with the feed: 8 items crawled and 40 items (several thousand
 * px) flew past unreadably. Speed is the thing a reader experiences, so speed is
 * the thing that is pinned — the duration falls out of `scrollWidth / SPEED`.
 *
 * 28 px/s by eye at 1440 and 1100: a 220px item takes ~8s to cross, which is
 * long enough to read a card name and short enough that the band still feels
 * live. The brief's tuning range was 24–32.
 */
const TAPE_SPEED_PX_S = 28;

/** Persisted play/pause. The reader's choice outlives the page. */
const TAPE_PREF_KEY = "varible:tape";
type TapePref = "play" | "pause";

export function Tape({ initial }: { initial: TapeItem[] }) {
  const [items, setItems] = useState<TapeItem[]>(initial);
  /** Transient pause — hover or focus. Distinct from the reader's stored choice
   *  below, so leaving the band doesn't undo an explicit pause. */
  const [hovered, setHovered] = useState(false);
  const [pref, setPref] = useState<TapePref>("play");
  const bandRef = useRef<HTMLDivElement | null>(null);
  const runRef = useRef<HTMLDivElement | null>(null);
  // Rendered ages are derived from a clock the component OWNS, ticked on the
  // refresh cadence — reading Date.now() during render would be impure and would
  // also disagree between the server HTML and hydration.
  const [nowMs, setNowMs] = useState<number | null>(null);
  const timer = useRef<number | null>(null);

  // Stored play/pause, read after mount (storage during render = hydration mismatch).
  useEffect(() => {
    let v: string | null = null;
    try {
      v = localStorage.getItem(TAPE_PREF_KEY);
    } catch {
      /* blocked storage — the band just won't remember */
    }
    if (v !== "pause") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPref("pause");
  }, []);

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

  /**
   * Pin the SPEED by measuring the run and deriving the duration.
   *
   * ⚠️ THE MEASUREMENT HAS TO SURVIVE THE FONT SWAP. Measured once at mount the
   * band ran ~35 px/s instead of 28: the first layout uses the fallback face, and
   * when JetBrains Mono/Inter arrive the run grows (observed 7,984px → 9,960px)
   * while the duration keeps the old, too-short value. So this re-measures on
   * three triggers, not one:
   *   • a ResizeObserver in BORDER-BOX mode — content-box misses padding/border
   *     changes, and the default is content-box;
   *   • `document.fonts.ready`, which does not always surface as an observed
   *     resize;
   *   • `items`, since the 60s refresh swaps the feed;
   *   • `nowMs` — THE ONE THAT ACTUALLY BIT. Ages only render once the client
   *     clock exists, so the run gains a "4m ago" on every item some time after
   *     mount: measured 7,984px → 9,957px, +1,973px across 40 items. Measured
   *     before that, the duration was ~25% short and the band ran at 34.9 px/s
   *     instead of 28. The ResizeObserver did NOT fire for it (verified by
   *     nudging the box by hand), so the state it depends on is listed instead
   *     of trusted to an observer.
   * A stale duration is a wrong speed, silently — the one failure this component
   * cannot detect on its own.
   */
  useEffect(() => {
    const run = runRef.current;
    const band = bandRef.current;
    if (!run || !band) return;
    let done = false;
    const apply = () => {
      if (done) return;
      // The marquee translates by -100% of the run's own box, so THAT width is
      // the distance travelled — which is what the speed has to be derived from.
      const w = run.getBoundingClientRect().width;
      if (!(w > 0)) return;
      band.style.setProperty("--tape-dur", `${(w / TAPE_SPEED_PX_S).toFixed(2)}s`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(run, { box: "border-box" });
    void document.fonts?.ready.then(apply).catch(() => {});
    return () => {
      done = true;
      ro.disconnect();
    };
  }, [items, nowMs]);

  // Age out items as the page sits open: a sale that was 23h old on load must
  // leave the band an hour later rather than quietly becoming a 25h-old "live" event.
  const live = useMemo(
    // Sales and pulls age out at 24h. Index closes are EXEMPT: a weekly close is
    // days old by construction and its label already states that age ("· 4d ago"),
    // which is the house treatment for an older-but-honest point.
    () =>
      nowMs == null
        ? items
        : items.filter((it) => it.kind !== "sale" || relativeAge(Date.parse(it.ts), nowMs) != null),
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
      ref={bandRef}
      className="tape-band relative flex h-[var(--shell-tape-h)] items-center overflow-hidden border-b border-line/40 pr-8"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={() => setHovered(false)}
      data-paused={hovered || pref === "pause" ? "" : undefined}
    >
      {/* Two identical runs so the marquee wraps seamlessly. The SECOND is
          aria-hidden and inert: a screen reader must not read the feed twice,
          and Tab must not walk a duplicate set of links. */}
      <TapeRun items={live} nowMs={nowMs} innerRef={runRef} />
      <TapeRun items={live} nowMs={nowMs} duplicate />

      {/* The reader's own control, pinned to the band's right edge above the
          moving runs. Its own gradient so an item sliding under it doesn't
          collide with the glyph. */}
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center bg-gradient-to-l from-bg via-bg to-transparent pl-4 pr-1.5">
        <button
          type="button"
          onClick={() => {
            const next: TapePref = pref === "pause" ? "play" : "pause";
            setPref(next);
            try {
              localStorage.setItem(TAPE_PREF_KEY, next);
            } catch {
              /* blocked storage */
            }
          }}
          aria-pressed={pref === "pause"}
          aria-label={pref === "pause" ? "Play the tape" : "Pause the tape"}
          title={pref === "pause" ? "Play the tape" : "Pause the tape"}
          className="pointer-events-auto flex h-5 w-5 items-center justify-center rounded text-[9px] text-ink-4 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
        >
          <span aria-hidden>{pref === "pause" ? "▶" : "❙❙"}</span>
        </button>
      </div>
    </div>
  );
}

function TapeRun({
  items,
  nowMs,
  duplicate,
  innerRef,
}: {
  items: TapeItem[];
  nowMs: number | null;
  duplicate?: boolean;
  innerRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={innerRef}
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
  const age = nowMs == null || item.kind !== "sale" ? null : relativeAge(Date.parse(item.ts), nowMs);
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
