"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { GroupedResults, SearchResult } from "@/lib/data/searchIndex";
import { GACHA_ENABLED } from "@/lib/flags";
import { pushRecent, readRecents, type RecentEntry } from "@/lib/shellPrefs";

/**
 * ⌘K / Ctrl+K / "/" — jump to anything (SHELL_V2 S3, north-star Move 3).
 *
 * ⚠️ THE TOP-BAR SEARCH FIELD IS THIS, not a second search: `ShellSearch` opens
 * the palette rather than carrying its own results, so there is one query surface
 * and one ranking.
 *
 * ⚠️ THE REMOTE ENDPOINT IS THE BACKEND'S AND HAS NOT LANDED.
 * `/api/internal/search` (brief-backend-shell-v2-feeds.md) is the grouped source
 * — cards, IPs, sets, platforms, pages, metrics. This builds against that
 * contract and degrades HONESTLY without it: the static Pages group (routes, not
 * data, so listing them locally invents nothing) always works, and Enter on a raw
 * query falls through to the existing /search page. It never shows a fabricated
 * card row while the endpoint is missing.
 */

type PaletteGroup = { key: string; label: string; items: PaletteItem[] };
type PaletteItem = { label: string; sub?: string; href: string };

/** The backend's shape is GroupedResults plus the groups its brief adds. Optional
 *  so today's endpoint (ips/platforms/cards) and tomorrow's both parse. */
type RemoteResults = GroupedResults & {
  sets?: SearchResult[];
  pages?: SearchResult[];
  metrics?: SearchResult[];
};

/** Routes — not data. Listing them client-side fabricates nothing. */
const PAGES: PaletteItem[] = [
  { label: "Market", sub: "homepage", href: "/" },
  { label: "Categories", sub: "market overview by IP", href: "/ips" },
  { label: "Platforms", sub: "every tracked venue", href: "/platforms" },
  { label: "Weekly Report", href: "/report" },
  { label: "Watchlist", href: "/watchlist" },
  { label: "Data status", sub: "freshness of every source", href: "/status" },
  { label: "Methodology", href: "/methodology" },
  ...(GACHA_ENABLED ? [{ label: "Gacha", href: "/gacha" }] : []),
];

const MIN_QUERY = 2;

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  /* Results carry the QUERY they answered. Stale results then simply don't match
     the current query and are ignored — no effect has to clear them, and a
     late response for "cha" can never render under "charizard". */
  const [remote, setRemote] = useState<{ q: string; data: RemoteResults } | null>(null);
  const [remoteDown, setRemoteDown] = useState(false);
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Fresh state on every open; recents read here (after mount, never during render).
  useEffect(() => {
    if (!open) return;
    // Opening IS the state change: the palette must start empty every time and
    // recents can only be read after mount (storage during render would be a
    // hydration mismatch), so this is the one repaint the rule warns about.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQ("");
    setCursor(0);
    setRecents(readRecents());
    inputRef.current?.focus();
  }, [open]);

  // Query the backend's grouped endpoint. Aborts in flight so a fast typist can't
  // land an older response on a newer query.
  useEffect(() => {
    const needle = q.trim();
    if (!open || needle.length < MIN_QUERY) return;
    const ctl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/internal/search?q=${encodeURIComponent(needle)}`, {
          signal: ctl.signal,
        });
        if (!res.ok) {
          setRemoteDown(true);
          return;
        }
        setRemote({ q: needle, data: (await res.json()) as RemoteResults });
        setRemoteDown(false);
      } catch {
        /* aborted or offline — the local groups still answer */
      }
    }, 120);
    return () => {
      ctl.abort();
      window.clearTimeout(t);
    };
  }, [open, q]);

  const groups = useMemo<PaletteGroup[]>(() => {
    const trimmed = q.trim();
    const needle = trimmed.toLowerCase();
    // Only results that answered THIS query.
    const fresh = remote && remote.q === trimmed ? remote.data : null;
    const out: PaletteGroup[] = [];
    if (needle.length === 0) {
      if (recents.length) out.push({ key: "recent", label: "Recent", items: recents });
      out.push({ key: "pages", label: "Pages", items: PAGES });
      return out;
    }
    const asItems = (rs: SearchResult[] | undefined): PaletteItem[] =>
      (rs ?? []).map((r) => ({ label: r.label, sub: r.sub, href: r.href }));
    const pages = PAGES.filter((p) => p.label.toLowerCase().includes(needle));
    if (pages.length) out.push({ key: "pages", label: "Pages", items: pages });
    if (fresh) {
      for (const [key, label, rs] of [
        ["ips", "IPs", fresh.ips],
        ["sets", "Sets", fresh.sets],
        ["platforms", "Platforms", fresh.platforms],
        ["cards", "Cards", fresh.cards],
        ["metrics", "Metrics", fresh.metrics],
      ] as const) {
        const items = asItems(rs);
        if (items.length) out.push({ key, label, items });
      }
    }
    return out;
  }, [q, remote, recents]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const clampedCursor = flat.length === 0 ? 0 : Math.min(cursor, flat.length - 1);

  const go = useCallback(
    (item: PaletteItem) => {
      pushRecent({ label: item.label, href: item.href });
      onClose();
      router.push(item.href);
    },
    [onClose, router],
  );

  // Focus trap + the dialog's own keys. Kept on the dialog (not the window) so it
  // cannot swallow the global map while closed.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!flat.length) return;
      setCursor((c) => {
        const next = (e.key === "ArrowDown" ? c + 1 : c - 1 + flat.length) % flat.length;
        return next;
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[clampedCursor];
      if (item) go(item);
      // No selection but a real query → the existing /search page, which is what
      // the endpoint-less state falls back to rather than a dead Enter.
      else if (q.trim().length >= MIN_QUERY) {
        onClose();
        router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      }
      return;
    }
    if (e.key === "Tab") {
      // Trap: the dialog holds exactly one tab stop (the input), so Tab is a no-op
      // rather than a way to walk the page behind the scrim.
      e.preventDefault();
      inputRef.current?.focus();
    }
  };

  if (!open) return null;

  let idx = -1;
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        className="relative flex max-h-[70vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-line-2 bg-bg-1 shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <span className="text-ink-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            placeholder="Jump to a card, IP, platform or page…"
            aria-label="Search"
            aria-controls={listId}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
          />
          <kbd className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-4">esc</kbd>
        </div>

        <div id={listId} role="listbox" className="scroll-y min-h-0 flex-1 overflow-y-auto py-1.5">
          {groups.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12.5px] text-ink-3">
              {q.trim().length < MIN_QUERY
                ? `Type ${MIN_QUERY}+ characters`
                : remoteDown
                  ? "Search index isn’t wired up yet — press Enter for the full search page"
                  : "No matches"}
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.key}>
                <div className="px-4 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-4">
                  {g.label}
                </div>
                {g.items.map((item) => {
                  idx += 1;
                  const on = idx === clampedCursor;
                  return (
                    <button
                      key={`${g.key}:${item.href}:${item.label}`}
                      type="button"
                      role="option"
                      aria-selected={on}
                      tabIndex={-1}
                      onMouseMove={((i) => () => setCursor(i))(idx)}
                      onClick={() => go(item)}
                      className={`flex w-full items-baseline gap-2 px-4 py-2 text-left text-[13px] ${
                        on ? "bg-bg-2 text-ink" : "text-ink-2"
                      }`}
                    >
                      <span className="truncate">{item.label}</span>
                      {item.sub && <span className="truncate text-[11.5px] text-ink-4">{item.sub}</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
