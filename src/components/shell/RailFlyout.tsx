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
 * ⚠️ 120ms HOVER-INTENT DELAY, none on close, none on CLICK. Without the delay,
 * dragging the cursor down the rail strobes six panels on the way to the seventh;
 * 120ms is under the threshold where a deliberate stop feels laggy (nav r3 cut it
 * from 250). The close is immediate because a panel that lingers covers the thing
 * you moved to. A click opens at once AND moves focus into the panel, so a
 * keyboard or touch user has the same path a mouse user has — hover was the only
 * way in before, and a hover-gated path is no path on a phone.
 *
 * Escape closes the open panel and returns focus to the tile that opened it.
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
export const OPEN_DELAY_MS = 120;

export function useFlyout() {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  /** True when the panel was opened by a click/keyboard: it then takes focus and
   *  does NOT close on mouseleave — a deliberately opened panel outlives the
   *  cursor wandering off it. */
  const [pinned, setPinned] = useState(false);
  const timer = useRef<number | null>(null);
  /** Set by Escape just before it hands focus back to the tile: the tile's own
   *  onFocus would otherwise reopen the panel it just closed, and Escape would
   *  be a key that does nothing you can see. Cleared by the next open() call. */
  const swallowNextFocus = useRef(false);

  const clear = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => clear, []);

  // Escape closes whatever is open and hands focus back to its anchor.
  useEffect(() => {
    if (!openKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      clear();
      setOpenKey(null);
      setPinned(false);
      // The anchor is the node's WRAPPER (so the panel can be positioned off the
      // whole row); the thing that can take focus is the tile inside it.
      const target = anchor?.matches("a,button") ? anchor : anchor?.querySelector<HTMLElement>("a,button");
      swallowNextFocus.current = true;
      target?.focus();
      // A focus that never arrives (nothing to focus) must not leave the latch set.
      window.setTimeout(() => { swallowNextFocus.current = false; }, 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openKey, anchor]);

  return {
    openKey,
    anchor,
    pinned,
    /** Hover intent: open after the delay unless the cursor leaves first. */
    open(key: string, el: HTMLElement | null) {
      if (swallowNextFocus.current) {
        swallowNextFocus.current = false;
        return;
      }
      clear();
      timer.current = window.setTimeout(() => {
        setAnchor(el);
        setOpenKey(key);
        setPinned(false);
      }, OPEN_DELAY_MS);
    },
    /**
     * Click / keyboard: open now, keep open, focus the panel.
     *
     * ⚠️ A CLICK ON A HOVER-OPENED PANEL PINS IT, IT DOES NOT CLOSE IT. The
     * mousedown that precedes a click focuses the tile, focus opens the panel on
     * the intent path, and a naive toggle then saw "already open" and closed it
     * — so clicking did the opposite of what it promised. Only a panel that is
     * already PINNED closes on a second click.
     */
    toggle(key: string, el: HTMLElement | null) {
      clear();
      if (openKey === key && pinned) {
        setOpenKey(null);
        setPinned(false);
      } else {
        setAnchor(el);
        setOpenKey(key);
        setPinned(true);
      }
    },
    /** Hover leave: a pinned panel ignores it. */
    close(key: string) {
      clear();
      setOpenKey((cur) => (cur === key && !pinned ? null : cur));
    },
    closeAll() {
      clear();
      setOpenKey(null);
      setPinned(false);
    },
  };
}

export function RailFlyout({
  node,
  ips,
  groups,
  anchor,
  pinned = false,
  onClose,
}: {
  node: RailNode;
  /** Opened by click/keyboard: focus moves in, mouseleave does not close. */
  pinned?: boolean;
  /** A category's members, so the collapsed rail can reach an IP directly. */
  ips?: RailNode[];
  /**
   * Further labelled lists under the members — the published sets in this
   * category, and the market-wide grade indices.
   *
   * ⚠️ EACH GROUP CARRIES ITS OWN LABEL BECAUSE THE SCOPES DIFFER. The sets under
   * a category ARE that category's; the grades are market-wide (a `grade:` entity
   * has no IP). Listing them under one unlabelled rule would let a reader take
   * the grade index for the category's own.
   */
  groups?: { label: string; items: RailNode[] }[];
  /** The rail node this panel belongs to — it is positioned off this rect. */
  anchor: HTMLElement | null;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  // A panel opened by click/keyboard takes focus on its first link, so Tab
  // continues INTO the panel rather than past it down the rail.
  useEffect(() => {
    if (!pinned) return;
    ref.current?.querySelector<HTMLElement>("a,button")?.focus();
  }, [pinned]);

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
      onMouseLeave={pinned ? undefined : onClose}
      data-pinned={pinned ? "" : undefined}
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
      {groups?.map((g) =>
        g.items.length === 0 ? null : (
          <div key={g.label} className="mt-2 border-t border-line pt-1.5">
            <div className="px-1.5 pb-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-4">
              {g.label}
            </div>
            {g.items.map((it) => (
              <Link
                key={it.key}
                href={it.href}
                className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-[12px] text-ink-2 transition-colors hover:bg-bg-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
              >
                <span className="min-w-0 flex-1 truncate">{it.name}</span>
                <RailSpark node={it} />
              </Link>
            ))}
          </div>
        ),
      )}
    </div>,
    document.body,
  );
}
