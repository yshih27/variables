"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { chipSnippets } from "@/lib/card/chipEmbed";
import { CHIP_BOX, CHIP_SIZES, type ChipSize, type ChipTheme } from "./PriceChip";

/**
 * "Get the chip" — the sheet a venue copies from.
 *
 * Three things, each one click: the chip as an iframe, the badge as an `<img>`
 * wrapped in the attribution link, and the key-free API URL. Both previews are
 * LIVE — the iframe loads the real chip and the `<img>` loads the real badge
 * off the same endpoints the snippets name, so what a venue sees here is
 * exactly what their page will render, not a drawing of it.
 *
 * ⚠️ THE SNIPPETS CARRY THE CANONICAL SLUG (chipEmbed.ts), never the URL the
 * reader happens to be on. An embed pinned to a superseded form would outlive
 * the page it came from.
 *
 * ⚠️ NOTHING HERE IS TYPED. Every number inside the previews comes from the
 * price endpoint at render time in the browser; this component only chooses a
 * size and a theme.
 */
export function GetTheChip({ slug, name }: { slug: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Embed this card's price on your own site"
        aria-label="Get the chip"
        className="rounded-md border border-line px-2 py-1 font-mono text-[11px] text-ink-3 transition-colors hover:border-line-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
      >
        Get the chip
      </button>
      {open && <ChipSheet slug={slug} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

function ChipSheet({ slug, name, onClose }: { slug: string; name: string; onClose: () => void }) {
  const [size, setSize] = useState<ChipSize>("md");
  const [theme, setTheme] = useState<ChipTheme>("dark");
  // `<id>` after a successful write, `<id>:failed` when the clipboard refused
  // it — a button that says "Copied" over a write that failed is a lie the
  // reader only discovers on paste.
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const snippets = chipSnippets(slug, size, theme);
  const box = CHIP_BOX[size];

  const copy = useCallback((id: string, text: string) => {
    const done = (ok: boolean) => {
      setCopied(ok ? id : `${id}:failed`);
      if (timer.current != null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), ok ? 1800 : 3000);
    };
    const clip = navigator.clipboard;
    if (!clip) { done(false); return; }
    clip.writeText(text).then(() => done(true), () => done(false));
  }, []);
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current); }, []);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Get the chip for ${name}`}
        data-chip-sheet
        tabIndex={-1}
        ref={(el) => el?.focus()}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
        className="scroll-y relative max-h-[92vh] w-full max-w-[640px] rounded-2xl border border-line-2 bg-bg-1 p-4 font-sans shadow-[0_24px_64px_rgba(0,0,0,0.6)] focus:outline-none"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold">Put this price on your site</h2>
            <p className="mt-1 text-[11.5px] leading-snug text-ink-3">
              Server-rendered from the same reader as this page, cached 30 minutes. The link back is part of the
              snippet — a number needs a way to its method.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {CHIP_SIZES.map((s) => (
              <Toggle key={s} on={size === s} onClick={() => setSize(s)} label={s} />
            ))}
            <span className="mx-1 h-4 w-px bg-line" aria-hidden />
            {(["dark", "light"] as const).map((t) => (
              <Toggle key={t} on={theme === t} onClick={() => setTheme(t)} label={t} />
            ))}
          </div>
        </div>

        {/* The chip, live at the chosen size and theme. */}
        <Block
          title="Chip · iframe"
          note={`${box.w}×${box.h}`}
          code={snippets.iframe}
          copied={copied === "iframe" ? true : copied === "iframe:failed" ? "failed" : false}
          onCopy={() => copy("iframe", snippets.iframe)}
        >
          <iframe
            src={snippets.chipUrl}
            width={box.w}
            height={box.h}
            frameBorder="0"
            loading="lazy"
            title="Varible price chip preview"
            className="block max-w-full"
          />
        </Block>

        {/* The badge, live, at both sizes — an <img> a venue can drop anywhere. */}
        <Block
          title="Badge · image"
          note="both sizes"
          code={snippets.badge}
          copied={copied === "badge" ? true : copied === "badge:failed" ? "failed" : false}
          onCopy={() => copy("badge", snippets.badge)}
        >
          <span className="flex flex-wrap items-center gap-3">
            {CHIP_SIZES.map((s) => (
              /* eslint-disable-next-line @next/next/no-img-element -- the live badge endpoint, which is the point of the preview */
              <img key={s} src={chipSnippets(slug, s, theme).badgeUrl} alt={`Varible price badge, ${s}`} height={s === "sm" ? 20 : 28} />
            ))}
          </span>
        </Block>

        <Block
          title="API · no key"
          note="JSON · CORS open"
          code={snippets.api}
          copied={copied === "api" ? true : copied === "api:failed" ? "failed" : false}
          onCopy={() => copy("api", snippets.api)}
        >
          <span className="font-mono text-[10.5px] text-ink-4">
            price, last sale, the floor rule and the last ten sales — the same payload the chip and the badge render
          </span>
        </Block>

        <div className="mt-3 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-3 hover:text-ink">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-md px-2 py-1 font-mono text-[11px] leading-none transition-colors ${
        on ? "bg-yellow font-semibold text-bg" : "bg-bg-2 text-ink-3 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function Block({
  title,
  note,
  code,
  copied,
  onCopy,
  children,
}: {
  title: string;
  note: string;
  code: string;
  copied: boolean | "failed";
  onCopy: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4 border-t border-line pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[12.5px] font-semibold text-ink">{title}</h3>
        <span className="font-mono text-[10.5px] text-ink-4">{note}</span>
      </div>
      <div className="mt-2 flex min-h-[32px] items-center justify-center rounded-lg border border-line bg-bg px-3 py-3">
        {children}
      </div>
      <div className="mt-2 flex items-start gap-2">
        <pre className="scroll-x min-w-0 flex-1 whitespace-pre rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[10.5px] leading-relaxed text-ink-2">
          {code}
        </pre>
        <button
          type="button"
          onClick={onCopy}
          data-copy={title}
          className={`shrink-0 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors ${
            copied ? "bg-bg-2 text-ink-2" : "bg-yellow text-black hover:bg-yellow-2"
          }`}
        >
          {copied === "failed" ? "Copy failed" : copied ? "Copied" : "Copy"}
        </button>
      </div>
    </section>
  );
}
