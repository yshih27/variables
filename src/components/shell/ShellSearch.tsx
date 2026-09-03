"use client";

import { SHELL_V2 } from "@/lib/flags";
import { PALETTE_OPEN_EVENT } from "./KeyboardLayer";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * The top bar's search field.
 *
 * ⚠️ IT IS THE PALETTE, NOT A SECOND SEARCH. Focusing or clicking it opens the
 * ⌘K command palette, which owns the query, the ranking and the results; this is
 * a button wearing a text field's clothes. One query surface, one ranking — the
 * brief is explicit about that.
 *
 * With the shell flag off this file isn't rendered at all (NavBar keeps its own
 * field), so the fallback below only exists for safety: if the palette layer were
 * ever absent, typing here still lands on the existing /search page.
 */
export function ShellSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Hand off to the palette. Kept as a function so every affordance on this
   *  control — click, focus, the mobile button — opens the same one thing. */
  function openPalette() {
    if (!SHELL_V2) return false;
    window.dispatchEvent(new CustomEvent(PALETTE_OPEN_EVENT));
    inputRef.current?.blur();
    return true;
  }

  function run() {
    const trimmed = q.trim();
    if (trimmed.length === 0) return;
    setMobileOpen(false);
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    run();
  }

  /** Enter runs the search explicitly — same reasoning as NavBar's: the implicit
   *  form submission path is conditional on markup this component rewrites at
   *  runtime, and a keyboard user finding search dead is too sharp a failure to
   *  rest on which branch of the spec applies. preventDefault first so the two
   *  paths can't both push. */
  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    run();
  }

  return (
    <>
      <form
        onSubmit={onSubmit}
        role="search"
        aria-label="Search VARIBLE"
        className="hidden h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line/70 bg-bg-1 px-3 text-[12.5px] text-ink-3 focus-within:border-yellow/50 md:flex md:max-w-[320px]"
      >
        <SearchIcon />
        <input
          ref={inputRef}
          type="search"
          name="q"
          value={q}
          readOnly={SHELL_V2}
          onFocus={() => openPalette()}
          onClick={() => openPalette()}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search cards, sets, IPs…"
          aria-keyshortcuts="Meta+K Control+K"
          className="h-full min-w-0 flex-1 cursor-pointer bg-transparent text-ink outline-none placeholder:text-ink-3"
        />
        <kbd className="hidden rounded border border-line px-1 py-px font-mono text-[9.5px] text-ink-4 lg:block">⌘K</kbd>
      </form>

      {/* Mobile: a toggle that drops a full-width field below the bar, so the
          brand · strip · star row keeps its space. */}
      <button
        type="button"
        onClick={() => {
          if (openPalette()) return;
          setMobileOpen((o) => !o);
        }}
        aria-label="Search"
        aria-keyshortcuts="Meta+K Control+K"
        aria-expanded={mobileOpen}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line/70 bg-bg-1 text-ink-3 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60 md:hidden"
      >
        <SearchIcon />
      </button>

      {mobileOpen && (
        <form
          onSubmit={onSubmit}
          role="search"
          aria-label="Search VARIBLE"
          className="absolute inset-x-0 top-full flex items-center gap-2.5 border-b border-line/70 bg-bg px-4 py-3 focus-within:border-yellow/50 md:hidden"
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
            onKeyDown={onKeyDown}
            placeholder="Search cards, sets, IPs…"
            className="h-8 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
          />
          <button
            type="submit"
            className="rounded-md bg-yellow px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-black hover:bg-yellow-2"
          >
            Go
          </button>
        </form>
      )}
    </>
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
