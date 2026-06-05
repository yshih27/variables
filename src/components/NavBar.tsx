"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const LINKS: Array<{ label: string; href: string; matchPrefix?: string }> = [
  { label: "Categories", href: "/ips", matchPrefix: "/ip" },
  { label: "Platforms", href: "/platforms", matchPrefix: "/platform" },
  { label: "Gacha", href: "/gacha" },
];

function isActive(currentPath: string, link: { href: string; matchPrefix?: string }): boolean {
  if (currentPath === link.href) return true;
  if (link.matchPrefix && currentPath.startsWith(link.matchPrefix)) return true;
  return false;
}

export function NavBar() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [q, setQ] = useState("");

  function onSearchSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = q.trim();
    if (trimmed.length === 0) return;
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <nav className="sticky top-0 z-30 flex items-center gap-7 border-b border-line/70 bg-black/80 px-8 py-4 backdrop-blur-xl">
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
                active
                  ? "bg-bg-2 text-ink"
                  : "text-ink-3 hover:text-ink"
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
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
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
  );
}
