"use client";

import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * The chart hover readout — portalled to <body>, positioned at the cursor.
 *
 * ⚠️ IT MUST BE A PORTAL. Every chart in the app lives inside <Section>, whose
 * shell carries `overflow-hidden` for its rounded corners. A tooltip positioned
 * below the plot with plain `absolute` is CLIPPED at the card's bottom edge —
 * caught on the /platform Players chart, where the lower half of a six-row
 * breakdown was sliced off. Same reason MetricInfo portals (R4-4), same fix.
 *
 * Anchored to the CURSOR rather than to the hovered band's rect: no
 * getBoundingClientRect, so it can't be thrown off by a transformed or
 * still-laying-out ancestor, and it tracks naturally across a wide band.
 */
export type TooltipAnchor = { x: number; y: number };

/** Cursor → anchor, with the offset that keeps the box off the pointer itself. */
export function anchorFromEvent(e: { clientX: number; clientY: number }): TooltipAnchor {
  return { x: e.clientX, y: e.clientY + 16 };
}

export function ChartTooltip({
  anchor,
  width = 186,
  children,
}: {
  /** null → nothing rendered. */
  anchor: TooltipAnchor | null;
  /** Used for the horizontal clamp; the box may grow past it. */
  width?: number;
  children: ReactNode;
}) {
  if (!anchor || typeof document === "undefined") return null;

  // Clamp into the viewport on both axes so an edge column's readout stays whole.
  const left = Math.max(8, Math.min(anchor.x - width / 2, window.innerWidth - width - 8));
  // Flip above the cursor when there isn't room below, rather than hanging off.
  const ESTIMATED_H = 132;
  const below = anchor.y + ESTIMATED_H <= window.innerHeight - 8;
  const top = below ? anchor.y : Math.max(8, anchor.y - ESTIMATED_H - 26);

  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[80] whitespace-nowrap rounded-md border border-line-2 bg-bg-2/95 px-2.5 py-1.5 font-mono text-[10.5px] shadow-[0_8px_24px_rgba(0,0,0,0.55)] backdrop-blur"
      style={{ left, top, minWidth: width }}
    >
      {children}
    </div>,
    document.body,
  );
}
