"use client";

import type { ComponentPropsWithoutRef } from "react";

/**
 * The ONE 24px disclosure control — the chevron that opens a category row in
 * the rail and folds a card on a page. A real button: `aria-expanded` carries
 * the state, the label says what it opens, and the glyph turns 90° when open
 * (`.rail-chevron` in globals.css, which also honours reduced motion).
 *
 * ⚠️ NO MARGIN OF ITS OWN. The row or header it sits in owns the spacing — the
 * rail's category row insets it with `mx-1`, a card header's right slot with
 * its own gap — so the same control never drifts by a few pixels between homes.
 *
 * `label` is the thing being disclosed ("Sports (6 IPs)", "Machines"); the
 * accessible name is built from it so a screen reader hears "Collapse Machines",
 * never a bare "button". Anything else (`onFocus`, `onKeyDown`, …) passes through
 * to the button untouched.
 */
export function DisclosureChevron({
  open,
  onToggle,
  label,
  className = "",
  ...rest
}: {
  open: boolean;
  onToggle: () => void;
  /** What the control discloses — completes "Expand …" / "Collapse …". */
  label: string;
  className?: string;
} & Omit<
  ComponentPropsWithoutRef<"button">,
  "onClick" | "aria-expanded" | "aria-label" | "type" | "className" | "children" | "title"
>) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
      title={open ? "Collapse" : "Expand"}
      /* 24px hit area, visibly a control: its own hover fill, one step up. */
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-bg-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60 ${className}`}
      {...rest}
    >
      <span aria-hidden className="rail-chevron" data-open={open ? "" : undefined}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
}
