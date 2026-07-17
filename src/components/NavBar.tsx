"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { GACHA_ENABLED } from "@/lib/flags";
import { BrandLockup, BrandMark } from "./Brand";

const LINKS: Array<{ label: string; href: string; matchPrefix?: string; shortLabel?: string }> = [
  { label: "Categories", href: "/ips", matchPrefix: "/ip" },
  { label: "Platforms", href: "/platforms", matchPrefix: "/platform" },
  { label: "Gacha", href: "/gacha" },
  { label: "Report", href: "/report" },
  // shortLabel keeps the row compact on small phones; the row also scrolls
  // horizontally on mobile (5 links + search) so nothing gets clipped.
  { label: "Watchlist", href: "/watchlist", shortLabel: "★" },
];

/** A single clickable stat in the top ticker. */
export type TickerItem = {
  label: string;
  value: string;
  href: string;
};

/** Height of the ticker strip when expanded (px). Animated to 0 on collapse. */
const TICKER_H = 38;

function isActive(currentPath: string, link: { href: string; matchPrefix?: string }): boolean {
  if (currentPath === link.href) return true;
  if (link.matchPrefix && currentPath.startsWith(link.matchPrefix)) return true;
  return false;
}

/**
 * Collapse the ticker on scroll-down past 80px; expand on scroll-up or near the
 * top. rAF-throttled with a 6px jitter threshold so it doesn't flicker.
 */
function useTickerCollapse(enabled: boolean): boolean {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const dy = y - lastY;
        if (Math.abs(dy) > 6) {
          if (dy > 0 && y > 80) setCollapsed(true);
          else if (dy < 0 || y <= 24) setCollapsed(false);
          lastY = y;
        }
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [enabled]);
  return collapsed;
}

export function NavBar({ ticker }: { ticker?: TickerItem[] }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [q, setQ] = useState("");
  const [mobileSearch, setMobileSearch] = useState(false);
  const hasTicker = !!ticker && ticker.length > 0;
  const collapsed = useTickerCollapse(hasTicker);

  function runSearch() {
    const trimmed = q.trim();
    if (trimmed.length === 0) return;
    setMobileSearch(false);
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  function onSearchSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    runSearch();
  }

  /**
   * Enter runs the search, explicitly.
   *
   * The <form> + submit button SHOULD reach `onSearchSubmit` through the
   * browser's implicit submission — but that path is conditional on markup this
   * component rewrites at runtime (the submit button only exists once there's a
   * query, and an empty form then leans on the separate "exactly one text field"
   * clause). A keyboard user finding the search dead is too sharp a failure to
   * rest on which branch of the spec happens to apply. This makes it one rule.
   *
   * preventDefault FIRST so that when implicit submission would have fired, it
   * doesn't — otherwise this and `onSearchSubmit` would both push the same route.
   */
  function onSearchKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    runSearch();
  }

  return (
    <div className="sticky top-0 z-30 bg-bg/80 backdrop-blur-xl font-sans">
      {hasTicker && (
        <div
          className="overflow-hidden border-b border-line/40 transition-[height,opacity] duration-[280ms] ease-out"
          style={{ height: collapsed ? 0 : TICKER_H, opacity: collapsed ? 0 : 1 }}
          aria-hidden={collapsed}
        >
          <div
            className="scroll-x mx-auto flex max-w-[1760px] items-center gap-x-6 px-8"
            style={{ height: TICKER_H }}
          >
            {ticker!.map((it) => (
              <Link
                key={it.label}
                href={it.href}
                className="group flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px]"
              >
                <span className="text-ink-3">{it.label}</span>
                <span className="font-semibold tabular text-ink transition-colors group-hover:text-yellow">
                  {it.value}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <nav className="flex items-center gap-3 border-b border-line/70 px-8 py-4 sm:gap-7">
        {/* Mark alone in the narrow slot, full lockup once there's room. */}
        <Link href="/" aria-label="VARIBLE — home" className="flex shrink-0 items-center text-ink">
          <BrandMark className="h-[22px] w-auto sm:hidden" />
          <BrandLockup className="hidden h-[19px] w-auto sm:block" />
        </Link>

        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] sm:flex-none sm:overflow-visible [&::-webkit-scrollbar]:hidden">
          {LINKS.filter((link) => GACHA_ENABLED || link.href !== "/gacha").map((link) => {
            const active = isActive(pathname, link);
            return (
              <Link
                key={link.label}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] transition-colors sm:px-3 ${
                  active ? "bg-bg-2 text-ink" : "text-ink-3 hover:text-ink"
                }`}
              >
                {link.shortLabel ? (
                  <>
                    <span className="sm:hidden" aria-label={link.label}>
                      {link.shortLabel}
                    </span>
                    <span className="hidden sm:inline">{link.label}</span>
                  </>
                ) : (
                  link.label
                )}
              </Link>
            );
          })}
        </div>

        <form
          onSubmit={onSearchSubmit}
          role="search"
          aria-label="Search VARIBLE"
          className="ml-auto hidden h-9 w-[360px] items-center gap-2.5 rounded-lg border border-line/70 bg-bg-1 px-4 text-[13px] text-ink-3 focus-within:border-yellow/50 md:flex"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="search"
            name="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Search cards, sets, IPs…"
            className="h-full flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3"
          />
          {q.trim().length > 0 && (
            <button
              type="submit"
              className="rounded-md bg-yellow px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-black hover:bg-yellow-2"
            >
              Search
            </button>
          )}
        </form>

        {/* Mobile: search is a toggle that drops a full-width input below the nav. */}
        <button
          type="button"
          onClick={() => setMobileSearch((o) => !o)}
          aria-label="Search"
          aria-expanded={mobileSearch}
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg border border-line/70 bg-bg-1 text-ink-3 transition-colors hover:text-ink md:hidden"
        >
          <SearchIcon />
        </button>
      </nav>

      {mobileSearch && (
        <form
          onSubmit={onSearchSubmit}
          role="search"
          aria-label="Search VARIBLE"
          className="flex items-center gap-2.5 border-b border-line/70 px-6 py-3 md:hidden"
        >
          <span className="text-ink-3">
            <SearchIcon />
          </span>
          <input
            autoFocus
            type="search"
            name="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Search cards, sets, IPs…"
            className="h-9 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
          />
          <button
            type="submit"
            className="rounded-md bg-yellow px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-black hover:bg-yellow-2"
          >
            Go
          </button>
        </form>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}
