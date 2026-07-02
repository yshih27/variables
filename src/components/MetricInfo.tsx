"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { METRICS, METHODOLOGY, type MetricKey } from "@/lib/metrics/glossary";

/**
 * MetricInfo (R5-3, R6-2) — the ONE ⓘ affordance for metric definitions, used on
 * table headers, KPI labels, chart legends and the volume-bar. Hover/focus opens
 * the brand popover INSTANTLY (no delay in) with a short grace period out so it
 * doesn't flicker on a wobbly cursor. No native `title=` — the grey OS tooltip
 * must never double-stack with the branded one (R6-2). aria-label carries the
 * full definition for a11y.
 *
 * The popover renders through a portal to <body> with fixed positioning computed
 * from the trigger's rect, so it's NEVER clipped by a table's `overflow` (the
 * bug R4-4 fixed for the treemap) and clamps to the viewport.
 */
export function MetricInfo({ metric, className = "" }: { metric: MetricKey; className?: string }) {
  const def = METRICS[metric];
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (!def) return null;

  const open = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.bottom + 6 });
  };
  // ~100ms grace so a brief cursor slip off the ⓘ doesn't snap it shut.
  const scheduleClose = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPos(null), 100);
  };
  const closeNow = () => {
    if (timer.current) clearTimeout(timer.current);
    setPos(null);
  };

  const W = 244;
  const left = pos ? Math.max(8, Math.min(pos.x - W / 2, window.innerWidth - W - 8)) : 0;

  return (
    <span className={`relative inline-flex align-middle ${className}`}>
      <button
        ref={ref}
        type="button"
        aria-label={`${def.term}: ${def.text}`}
        onMouseEnter={open}
        onMouseLeave={scheduleClose}
        onFocus={open}
        onBlur={closeNow}
        onClick={(e) => e.stopPropagation()}
        className="grid h-[13px] w-[13px] cursor-help place-items-center rounded-full border border-line text-[9px] font-bold leading-none text-ink-4 transition-colors hover:border-ink-4 hover:text-ink-2"
      >
        i
      </button>
      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[80] rounded-lg border border-line-2 bg-bg-2/95 p-3 text-left shadow-[0_10px_34px_rgba(0,0,0,0.55)] backdrop-blur"
            style={{ left, top: pos.y, width: W }}
          >
            <div className="mb-1 font-sans text-[12.5px] font-semibold text-ink">{def.term}</div>
            <p className="font-sans text-[11.5px] leading-relaxed text-ink-2">{def.text}</p>
            <span className="mt-1.5 inline-block font-sans text-[11px] text-ink-3">
              Full method on <span className="text-yellow">/methodology</span>
            </span>
          </div>,
          document.body,
        )}
      {/* Anchor link for keyboard/no-JS: the ⓘ is a button (tooltip), this hidden
          link makes the definition reachable at /methodology. */}
      <Link href={METHODOLOGY} className="sr-only">
        {def.term} methodology
      </Link>
    </span>
  );
}
