"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { GACHA_ENABLED } from "@/lib/flags";

/**
 * Mobile navigation (SHELL_V2 S1) — below 1024, where a 240px rail cannot exist
 * and a 56px one would eat a seventh of the screen. Five destinations plus a
 * "More" sheet, thumb-height, fixed to the bottom edge.
 *
 * This is the north star's "rail → bottom tabs" mobile commitment: the taxonomy
 * is still reachable (Categories and Platforms are their own index pages), it
 * just isn't a tree at this width.
 */
const TABS = [
  { href: "/", label: "Market", exact: true },
  { href: "/ips", label: "Categories", match: "/ip" },
  { href: "/platforms", label: "Platforms", match: "/platform" },
  { href: "/report", label: "Report" },
];

const MORE = [
  { href: "/watchlist", label: "Watchlist" },
  { href: "/status", label: "Data status" },
  { href: "/methodology", label: "Methodology" },
  { href: "/gacha", label: "Gacha", gated: true },
];

function active(pathname: string, t: { href: string; exact?: boolean; match?: string }): boolean {
  if (t.exact) return pathname === t.href;
  if (t.match && (pathname === t.match || pathname.startsWith(`${t.match}/`))) return true;
  return pathname === t.href || pathname.startsWith(`${t.href}/`);
}

export function BottomTabs() {
  const pathname = usePathname() ?? "/";
  const [moreOpen, setMoreOpen] = useState(false);
  const more = MORE.filter((m) => !m.gated || GACHA_ENABLED);

  return (
    <>
      {moreOpen && (
        <>
          {/* Scrim closes the sheet; it is not a focus trap — the sheet is four
              links and Tab should keep working through them. */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          />
          <div className="fixed inset-x-0 bottom-[56px] z-50 border-t border-line/70 bg-bg-1 p-2 lg:hidden">
            {more.map((m) => (
              <Link
                key={m.href}
                href={m.href}
                onClick={() => setMoreOpen(false)}
                className="block rounded-lg px-4 py-3 text-[14px] text-ink-2 hover:bg-bg-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
              >
                {m.label}
              </Link>
            ))}
          </div>
        </>
      )}

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-50 flex h-[56px] items-stretch border-t border-line/70 bg-bg/95 backdrop-blur-xl lg:hidden"
      >
        {TABS.map((t) => {
          const on = active(pathname, t);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-yellow/60 ${
                on ? "text-yellow" : "text-ink-3"
              }`}
            >
              <span aria-hidden className={`h-0.5 w-6 rounded-sm ${on ? "bg-yellow" : "bg-transparent"}`} />
              {t.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-yellow/60 ${
            moreOpen ? "text-yellow" : "text-ink-3"
          }`}
        >
          <span aria-hidden className={`h-0.5 w-6 rounded-sm ${moreOpen ? "bg-yellow" : "bg-transparent"}`} />
          More
        </button>
      </nav>
    </>
  );
}
