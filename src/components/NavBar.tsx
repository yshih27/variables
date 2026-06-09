"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

const LINKS: Array<{ label: string; href: string; matchPrefix?: string }> = [
  { label: "Categories", href: "/ips", matchPrefix: "/ip" },
  { label: "Platforms", href: "/platforms", matchPrefix: "/platform" },
  { label: "Gacha", href: "/gacha" },
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
          if (y > 80 && dy > 0) setCollapsed(true);
          else if (dy < 0 || y <= 80) setCollapsed(false);
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
  const hasTicker = !!ticker && ticker.length > 0;
  const collapsed = useTickerCollapse(hasTicker);

  function onSearchSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = q.trim();
    if (trimmed.length === 0) return;
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <div className="sticky top-0 z-30 bg-black/80 backdrop-blur-xl">
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

      <nav className="flex items-center gap-7 border-b border-line/70 px-8 py-4">
        <Link href="/" className="flex items-center gap-2 text-[17px] font-bold tracking-[0.02em]">
          <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md bg-yellow text-[12px] font-extrabold text-black">
            T
          </span>
          <span>
            TCG<span className="font-medium text-ink-3">.market</span>
          </span>
        </Link>

        <div className="flex gap-1">
          {LINKS.map((link) => {
            const active = isActive(pathname, link);
            return (
              <Link
                key={link.label}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 text-[13px] transition-colors ${
                  active ? "bg-bg-2 text-ink" : "text-ink-3 hover:text-ink"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <form
          onSubmit={onSearchSubmit}
          role="search"
          aria-label="Search TCG.market"
          className="ml-auto hidden h-9 w-[360px] items-center gap-2.5 rounded-full border border-line/70 bg-bg-1 px-4 text-[13px] text-ink-3 focus-within:border-yellow/50 md:flex"
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
      </nav>
    </div>
  );
}
