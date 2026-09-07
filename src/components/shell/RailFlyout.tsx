"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RailNode } from "@/lib/types";
import { RailSpark } from "./RailSpark";

/**
 * The collapsed rail's flyout (polish r1, item 3).
 *
 * At 56px a node is a 2–3 letter code and nothing else, which is a column of
 * abbreviations rather than navigation. Hovering or focusing one opens a labelled
 * panel beside the rail carrying what the open rail would have shown — full name,
 * spark, delta — and for a category, its IP list, so the collapsed rail is fully
 * usable WITHOUT expanding it.
 *
 * ⚠️ 250ms OPEN DELAY, none on close. Without the delay, dragging the cursor down
 * the rail strobes six panels on the way to the seventh. The close is immediate
 * because a panel that lingers covers the thing you moved to.
 *
 * Rendered only in icons mode — `RailNav` gates it on the pref rather than the
 * CSS, because this is real DOM with links in it and hiding it with `display:none`
 * would leave those links in the tab order at 240px.
 *
 * ⚠️ IT MUST PORTAL. The rail is a scroll container (`overflow-y: auto`), and CSS
 * forces the other axis to `auto` the moment one axis is not `visible` — so an
 * absolutely-positioned panel can NEVER escape the 56px column, whatever the
 * overflow-x rule says. Same lesson, same fix as ChartTooltip: portal to <body>,
 * position: fixed off the anchor's rect, clamp to the viewport.
 */
const OPEN_DELAY_MS = 250;

export function useFlyout() {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const timer = useRef<number | null>(null);

  const clear = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => clear, []);

  return {
    openKey,
    anchor,
    open(key: string, el: HTMLElement | null) {
      clear();
      timer.current = window.setTimeout(() => {
        setAnchor(el);
        setOpenKey(key);
      }, OPEN_DELAY_MS);
    },
    close(key: string) {
      clear();
      setOpenKey((cur) => (cur === key ? null : cur));
    },
    closeAll() {
      clear();
      setOpenKey(null);
    },
  };
}

export function RailFlyout({
  node,
  ips,
  anchor,
  onClose,
}: {
  node: RailNode;
  /** A category's members, so the collapsed rail can reach an IP directly. */
  ips?: RailNode[];
  /** The rail node this panel belongs to — it is positioned off this rect. */
  anchor: HTMLElement | null;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  // Measure AFTER paint, so the panel's own height is known before it is clamped.
  useEffect(() => {
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 0;
    const top = Math.max(8, Math.min(a.top, window.innerHeight - h - 8));
    setPos({ top, left: a.right + 4 });
  }, [anchor, ips]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      /* Keep it open while the cursor is inside — a flyout you cannot reach is a
         tooltip, and the IP list below has to be clickable. */
      onMouseLeave={onClose}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      className="fixed z-[60] w-[228px] rounded-xl border border-line-2 bg-bg-1 p-2.5 font-sans shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
    >
      <div className="flex items-center justify-between gap-2">
        <Link
          href={node.href}
          className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink hover:text-yellow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
        >
          {node.name}
        </Link>
        <RailSpark node={node} />
      </div>

      {ips && ips.length > 0 && (
        <div className="mt-2 border-t border-line pt-1.5">
          {ips.map((ip) => (
            <Link
              key={ip.key}
              href={ip.href}
              className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-[12px] text-ink-2 transition-colors hover:bg-bg-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
            >
              <span className="min-w-0 flex-1 truncate">{ip.name}</span>
              <RailSpark node={ip} />
            </Link>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
