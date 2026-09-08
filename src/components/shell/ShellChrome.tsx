"use client";

import { usePathname } from "next/navigation";

/**
 * The shell's chrome, gated off the routes that must not have it.
 *
 * ⚠️ `/embed/*` RENDERS INSIDE SOMEONE ELSE'S PAGE. The rail, the tape, the top
 * bar and the bottom tabs are hostile there — a nav bar in a 460px iframe on a
 * third-party blog is chrome the reader cannot use and did not ask for, and the
 * whole point of the embed is one chart plus its receipt.
 *
 * ⚠️ WHY A CLIENT COMPONENT AND NOT A ROUTE GROUP. The textbook fix is two root
 * layouts (`app/(site)/` and `app/(bare)/`), but that means moving every route in
 * the app to make one route bare. `usePathname` is available during SSR for
 * client components, so this renders NO chrome markup at all for an embed — not
 * chrome hidden with CSS — at the cost of one small client boundary.
 *
 * The shell's two cached reads still happen for an embed request. They are
 * snapshot reads behind a 30-minute cache, so the cost is a map lookup; not worth
 * restructuring the app to avoid.
 */
const BARE_PREFIX = "/embed";

export function ShellChrome({
  chrome,
  children,
}: {
  /** The full frame — top bar, tape, rail, tabs — already rendered by AppShell. */
  chrome: React.ReactNode;
  /** The page. Rendered alone on a bare route. */
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  if (pathname === BARE_PREFIX || pathname.startsWith(`${BARE_PREFIX}/`)) {
    return <>{children}</>;
  }
  return <>{chrome}</>;
}
