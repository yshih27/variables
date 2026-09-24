"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { parseWatchId, watchIdForPath } from "@/lib/watchlist";
import { WATCH_BTN_RAIL, WatchStar } from "./WatchStar";
import { AlertMe } from "./AlertMe";

/**
 * Watchlist + Share actions for the IP / Platform rails (QA-1, R5).
 *
 *   • Watchlist — toggles this entity in the shared `lib/watchlist` localStorage
 *     set (`ip:pokemon`, `platform:beezie`, …), keyed off the current route so
 *     the rails don't have to thread an id. Read through useSyncExternalStore so
 *     every mounted copy (and the /watchlist page) stays in sync, hydration-safe.
 *   • Share — the native sheet on devices that have one (it's better than
 *     anything we'd build: real contacts, real apps). Everywhere else, a small
 *     popover: copy link, X, Telegram.
 *
 * The old desktop path copied silently and, if the clipboard was blocked, did
 * NOTHING AT ALL — which is why the button was reported as a dead no-op. Copy
 * failure is now a visible, actionable state (the URL is shown, selected, for
 * manual copying) rather than an empty catch.
 */

const BTN = WATCH_BTN_RAIL;

type CopyState = "idle" | "ok" | "fail";

export function RailActions({
  name,
  placement = "down",
}: {
  name: string;
  /** Which way the Share panel opens. "up" for the IP rail, where these buttons
   *  are pinned to the bottom of a scrolling column and "down" means "into the
   *  clipped void". */
  placement?: "up" | "down";
}) {
  const pathname = usePathname() ?? "";
  // e.g. "/ip/pokemon" → "ip:pokemon"; "/platform/collector-crypt" → "platform:collector-crypt".
  const id = watchIdForPath(pathname);
  // The same entity the star holds is what "Alert me" watches (ip / platform).
  const parsed = id ? parseWatchId(id) : null;
  const alertEntity = parsed && parsed.kind !== "identity" ? { type: parsed.kind, key: parsed.key, label: name } : null;

  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<CopyState>("idle");
  const [url, setUrl] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const failRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  // Close on outside click / Escape — a popover that can only be dismissed by
  // its own trigger is a trap on touch.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shareTitle = `${name} · VARIBLE`;

  async function onShare() {
    if (typeof window === "undefined") return;
    const href = window.location.href;
    setUrl(href);
    // Native sheet where it exists (mobile). A dismissal is NOT an error — the
    // catch stays silent on purpose; surfacing it would flag every cancel.
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: shareTitle, url: href });
      } catch {
        /* user dismissed the sheet — intentional no-op */
      }
      return;
    }
    setCopy("idle");
    setOpen((o) => !o);
  }

  async function copyLink() {
    const href = url || window.location.href;
    if (copyTimer.current) clearTimeout(copyTimer.current);
    try {
      // Can reject on http:// origins, in cross-origin iframes, or when the
      // permission is denied — all real, and all silent before this.
      await navigator.clipboard.writeText(href);
      setCopy("ok");
      copyTimer.current = setTimeout(() => setCopy("idle"), 1800);
    } catch {
      setCopy("fail");
    }
  }

  // Pre-select the fallback URL so a blocked clipboard is one ⌘C away. This has
  // to be an effect, not a rAF inside copyLink(): the input doesn't exist until
  // React commits the "fail" state, so a rAF fires against a null ref.
  useEffect(() => {
    if (copy === "fail") failRef.current?.select();
  }, [copy]);

  const enc = encodeURIComponent;
  const intents = [
    { label: "X", href: `https://x.com/intent/post?text=${enc(shareTitle)}&url=${enc(url)}` },
    { label: "Telegram", href: `https://t.me/share/url?url=${enc(url)}&text=${enc(shareTitle)}` },
  ];

  return (
    // Two up: the star (this device) beside the alert (a confirmed
    // subscription), Share full width beneath — three buttons side by side do
    // not fit the rail's ~252px content box at the rail's type size.
    <div ref={wrapRef} className="relative mt-auto grid grid-cols-2 gap-2 pt-[22px]">
      <WatchStar id={id} variant="rail" />
      <AlertMe entity={alertEntity} variant="rail" />

      <button
        type="button"
        onClick={onShare}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`${BTN} col-span-2 border-line-2 bg-transparent text-ink hover:bg-bg-2`}
      >
        ↗ Share
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`Share ${name}`}
          // ⚠️ `placement` is not decoration. These buttons sit at the BOTTOM of
          // the IP rail (mt-auto), inside a column that now scrolls — a panel
          // opening downward from there opens past the rail's bottom edge and
          // gets clipped away. It opens upward there and downward in the platform
          // header, where the buttons sit at the top and there's page beneath.
          // max-w-full: 260px doesn't fit the rail's ~252px content box.
          className={`absolute right-0 z-40 w-[260px] max-w-full rounded-lg border border-line-2 bg-bg-1 p-3 shadow-[0_12px_38px_rgba(0,0,0,0.6)] ${
            placement === "up" ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          <button
            type="button"
            onClick={copyLink}
            className="flex h-[34px] w-full items-center justify-center gap-2 rounded-lg border border-line-2 bg-bg-2 text-[12.5px] font-semibold text-ink transition-colors hover:bg-bg-3"
          >
            {copy === "ok" ? "✓ Link copied" : "Copy link"}
          </button>

          {copy === "fail" && (
            // The visible failure state. Before, a blocked clipboard produced
            // exactly nothing and the button looked broken.
            <div className="mt-2">
              <p className="text-[11px] leading-snug text-red">
                Your browser blocked the clipboard. Copy the link manually:
              </p>
              <input
                ref={failRef}
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="mt-1.5 w-full rounded-lg border border-line-2 bg-bg-2 px-2 py-1 font-mono text-[11px] text-ink-2 outline-none focus-visible:border-yellow"
              />
            </div>
          )}

          <div className="mt-2 grid grid-cols-2 gap-2">
            {intents.map((i) => (
              <a
                key={i.label}
                href={i.href}
                target="_blank"
                rel="noreferrer noopener"
                onClick={() => setOpen(false)}
                className="flex h-[34px] items-center justify-center rounded-lg border border-line-2 bg-transparent text-[12.5px] font-semibold text-ink-2 transition-colors hover:bg-bg-2 hover:text-ink"
              >
                {i.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
