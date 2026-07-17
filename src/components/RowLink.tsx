"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The name in an OverviewMetricColumn row, as a real link.
 *
 * It sits inside a <summary>, which is the whole problem: a click anywhere in a
 * summary is the disclosure's activation, so the row would navigate AND expand
 * from one click. Two things worth knowing about why this is only a one-liner:
 *
 *  • The browser already does most of the work. Activation resolves to the
 *    INNERMOST ancestor with activation behaviour, so a real <a> inside the
 *    summary claims the click and the summary never toggles. That's also why
 *    this must stay an <a> and never become a div-with-onClick.
 *  • stopPropagation is the belt to that braces: it keeps the click off any
 *    ancestor LISTENER. It's specifically NOT preventDefault, which would cancel
 *    the navigation we're here to perform. MetricInfo does the same thing for its
 *    popover, for the same reason.
 *
 * So: the name navigates, the rest of the row toggles, and neither needs to know
 * about the other. Keyboard reaches both — Tab to the link, Tab to the summary.
 */
export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      className="underline-offset-2 hover:text-yellow hover:underline"
    >
      {children}
    </Link>
  );
}
