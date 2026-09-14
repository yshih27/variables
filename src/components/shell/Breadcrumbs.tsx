"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { crumbsFor, crumbNamesFrom, crumbNamesFromCatalog, withNames, type CrumbNames } from "@/lib/shell/crumbs";
import { useRailModel } from "./RailModelContext";

/**
 * The trail — `Categories › Pokémon › Sets › 151` — on every page under /ip,
 * /platform, /ips, /platforms, /card and /i.
 *
 * ⚠️ IT TAKES THE SLOT THE "← Pokémon" LINK HAD, and no more: the same 12px line,
 * the same `mb-1.5`, so a page that swaps one for the other keeps its height and
 * its §7 partners keep their edges. Where a page had no back link (the root
 * pages) it is the same one line above the h1, not a band.
 *
 * ⚠️ THE LAST SEGMENT IS TEXT, NOT A LINK. It is where the reader already is; a
 * link to the current page is a control that does nothing.
 *
 * Mobile: only the last two segments show below `sm` — a phone-width trail that
 * wraps to two lines is worse than a shorter one, and the two nearest segments
 * are the ones a reader climbs. The full trail stays in the DOM for assistive
 * tech; the earlier segments are hidden visually, not removed.
 */
export function Breadcrumbs({
  leaf,
  names,
  className = "",
}: {
  leaf?: string | null;
  /** The page's own names for segments the rail model may not know (an
   *  identity's set with no published index). Data from the page's reader,
   *  never typed; merged over the model's names. */
  names?: Partial<CrumbNames> | null;
  className?: string;
}) {
  const pathname = usePathname() ?? "/";
  const model = useRailModel();
  const crumbs = useMemo(
    () => crumbsFor(pathname, withNames(model ? crumbNamesFrom(model) : crumbNamesFromCatalog(), names), leaf),
    [pathname, model, leaf, names],
  );
  // ⚠️ A ONE-SEGMENT TRAIL IS NOT A TRAIL (nav r4). On /ips and /platforms the
  // only segment is the page itself, and since r4 the h1 directly beneath says
  // the same word — "Categories" over "Categories" read as a stutter. A trail
  // earns its line when there is somewhere to climb to.
  if (crumbs.length < 2) return null;

  const firstVisibleOnMobile = Math.max(0, crumbs.length - 2);

  return (
    <nav aria-label="Breadcrumb" className={`mb-1.5 text-[12px] leading-none text-ink-3 ${className}`}>
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
        {crumbs.map((c, i) => {
          const mobileHidden = i < firstVisibleOnMobile ? "hidden sm:flex" : "flex";
          return (
            <li key={c.href} className={`${mobileHidden} min-w-0 items-center gap-x-1.5`}>
              {i > 0 && (
                <span aria-hidden className={i === firstVisibleOnMobile ? "hidden text-ink-4 sm:inline" : "text-ink-4"}>
                  ›
                </span>
              )}
              {c.current ? (
                <span aria-current="page" className="truncate text-ink-2">
                  {c.label}
                </span>
              ) : (
                <Link
                  href={c.href}
                  className="truncate underline-offset-2 transition-colors hover:text-yellow hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
                >
                  {c.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
