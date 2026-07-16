"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

/**
 * A table row whose whole surface navigates to `href`.
 *
 * ⚠️ Do NOT go back to the stretched-link pattern this replaces: a
 * `before:absolute before:inset-0` overlay on the name-cell <Link>, inside a
 * `relative` <tr>. It looked correct in Chrome and was broken in Safari, because
 * `position: relative` on a <tr> does not establish a containing block in WebKit
 * (Blink honours it). So every row's overlay sized itself against the page
 * instead of its row: they all stacked near the top, and the LAST row — painting
 * last — swallowed every click up there. Clicking the page header navigated to
 * the bottom row of the table.
 *
 * This carries no positioned <tr> and no overlay, so both engines agree by
 * construction. The name cell keeps a REAL <Link>: that's what serves keyboard
 * users, middle-click/⌘-click, and crawlers. This only adds pointer affordance
 * over the rest of the row, so it's additive — if the handler never ran, every
 * row would still be reachable.
 *
 * A client boundary here keeps the tables that are Server Components (IPTables,
 * PlatformTables, GachaTable) on the server: their cells render as `children`
 * and only this shell hydrates.
 */
export function TableRowLink({
  href,
  className = "",
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();

  const onClick = (e: MouseEvent<HTMLTableRowElement>) => {
    // A nested link or button owns its own click — the row must not hijack it.
    // This is what keeps the Top Card link, the ⓘ popovers and the sort headers
    // doing their own thing.
    if ((e.target as HTMLElement).closest("a,button")) return;
    // Rows are selectable now that no overlay covers them, and finishing a
    // drag-select fires a click — navigating there would throw the selection
    // away just as the user got it.
    if (window.getSelection()?.toString()) return;
    router.push(href);
  };

  return (
    <tr
      onClick={onClick}
      className={`group cursor-pointer transition-colors hover:bg-bg-2 ${className}`}
    >
      {children}
    </tr>
  );
}
