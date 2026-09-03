"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { readDensity, writeDensity, type Density } from "@/lib/shellPrefs";
import { useChartFocus } from "./ChartFocus";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsHelp } from "./ShortcutsHelp";

/**
 * The global keyboard map (SHELL_V2 S3, north-star Move 4) plus the two overlays
 * it opens. Mounted once by AppShell.
 *
 * ⚠️ SHORTCUTS NEVER FIRE WHILE AN INPUT HAS FOCUS. Every handler bails on an
 * <input>/<textarea>/<select>/contenteditable target — otherwise typing "d" in
 * the search box would flip the whole site's density, which is the classic way
 * these maps become hostile.
 *
 * ⚠️ AND NEVER WITH A MODIFIER (except ⌘K/Ctrl K itself). Bare-letter handlers
 * that ignore modifiers eat the browser's own chords — Ctrl+D bookmarks, ⌘J
 * downloads — and users notice that immediately.
 */

/** Chord prefix: "g" then a destination. Expires so a stray g doesn't arm forever. */
const CHORD_MS = 1200;
const CHORDS: Record<string, string> = {
  m: "/",
  i: "/ips",
  p: "/platforms",
  r: "/report",
  w: "/watchlist",
};

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

/** Move the row focus ring within the table the current row belongs to (or the
 *  first table on the page when nothing is focused yet). */
function moveRow(dir: 1 | -1): boolean {
  const rows = [...document.querySelectorAll<HTMLElement>("[data-shell-row]")];
  if (!rows.length) return false;
  const current = document.activeElement as HTMLElement | null;
  const at = current ? rows.indexOf(current.closest<HTMLElement>("[data-shell-row]") ?? current) : -1;
  const next = at < 0 ? (dir === 1 ? 0 : rows.length - 1) : Math.min(Math.max(at + dir, 0), rows.length - 1);
  rows[next]?.focus();
  rows[next]?.scrollIntoView({ block: "nearest" });
  return true;
}

export const PALETTE_OPEN_EVENT = "varible:palette";

export function KeyboardLayer() {
  const router = useRouter();
  const charts = useChartFocus();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const chord = useRef<{ key: string; at: number } | null>(null);

  /* Density is NOT React state. `data-density` on <html> is the single source of
     truth — the pre-hydration script writes it, the CSS reads it, and `d` flips
     it. Mirroring it in state would give two truths that can disagree, and
     nothing in this component renders differently for it. */
  const toggleDensity = useCallback(() => {
    const next: Density = readDensity() === "compact" ? "comfortable" : "compact";
    writeDensity(next);
  }, []);

  // The top-bar field opens this palette rather than carrying its own results —
  // one query surface, one ranking. A DOM event keeps that link from needing a
  // context that would have to cross the server/client boundary in AppShell.
  useEffect(() => {
    const open = () => setPaletteOpen(true);
    window.addEventListener(PALETTE_OPEN_EVENT, open);
    return () => window.removeEventListener(PALETTE_OPEN_EVENT, open);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      // ⌘K / Ctrl+K works even from inside a field — it is the escape hatch.
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (isTypingTarget(e.target)) return;
      // Leave every other browser/OS chord alone.
      if (meta || e.altKey) return;

      // While an overlay is up, its own handler owns the keys.
      if (paletteOpen || helpOpen) {
        if (e.key === "Escape") {
          setPaletteOpen(false);
          setHelpOpen(false);
        }
        return;
      }

      const k = e.key;

      // Chord: "g" then a destination.
      const armed = chord.current;
      if (armed && Date.now() - armed.at < CHORD_MS) {
        chord.current = null;
        const href = CHORDS[k.toLowerCase()];
        if (href) {
          e.preventDefault();
          router.push(href);
          return;
        }
      }
      if (k.toLowerCase() === "g") {
        chord.current = { key: "g", at: Date.now() };
        return;
      }
      chord.current = null;

      if (k === "/") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (k === "?") {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (k === "[" || k === "]") {
        // Only swallow the key if a chart actually took it — otherwise leave the
        // browser's own binding alone.
        if (charts.cycleActive(k === "]" ? 1 : -1)) e.preventDefault();
        return;
      }
      if (k === "j" || k === "k") {
        if (moveRow(k === "j" ? 1 : -1)) e.preventDefault();
        return;
      }
      if (k.toLowerCase() === "d") {
        e.preventDefault();
        toggleDensity();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, charts, paletteOpen, helpOpen, toggleDensity]);

  return (
    <>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      {/* A visible, focusable way to reach the map — the shortcut itself is only
          discoverable to someone who already knows to press "?". */}
      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        aria-label="Keyboard shortcuts"
        aria-keyshortcuts="?"
        className="fixed bottom-3 right-3 z-30 hidden h-7 w-7 items-center justify-center rounded-lg border border-line/70 bg-bg-1/90 font-mono text-[12px] text-ink-4 backdrop-blur transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60 lg:flex"
      >
        ?
      </button>
    </>
  );
}
