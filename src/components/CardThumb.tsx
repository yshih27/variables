"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTrimmedArt } from "@/lib/img/autoTrim";
import { ArtPreview, claimPreview, releasePreview, type PreviewMeta, type PreviewMode } from "./ArtPreview";

/**
 * CardThumb — THE card-art frame for lists, tables and headers.
 *
 * Portrait (5:7, the slab's shape) and TRIMMED: the photo loads through
 * `useTrimmedArt`, which reads its pixels, finds the slab's bounding box and
 * swaps in the tight crop, so a Beezie slab centred on a 2160² black field and
 * a Collector Crypt tight crop come out the same size. Drawn `object-contain`
 * always — a trim that fails (unreadable pixels) falls back to the whole
 * photo, never a cropped slab in a portrait frame.
 *
 * Sizes are a VARIANT, not a pixel prop, so every surface picks from three:
 *   row   40×56  — list rows and two-line tables (set top sales, set cards,
 *                  slabs, the report)
 *   cell  30×42  — the dense tables (IP, platform, trait tables)
 *   hero  144px wide (96px on phones) — the identity and character headers;
 *         the card page keeps its own 340px hero
 * `fill` stays for a tile frame that owns its own aspect (TrendingCards).
 *
 * Routes through `proxyImg` (inside the hook), so it inherits the app's one set
 * of image rules (Beezie's `original-N.jpg` rewrite, /api/img for ORB-blocked
 * hosts). Never point an <img> at a raw metadata URL.
 *
 * ⚠️ A MISSING THUMB IS A BLANK FRAME, NOT A GAP. Card art comes from Arweave and
 * CDN mirrors that 502 and go dead; some tokens have no cached art at all. The
 * frame always occupies its space so rows never reflow as images resolve or fail,
 * and a failure lands on the same neutral frame as an absent URL — the row is
 * about the trade, and art is decoration that must not be able to break it.
 *
 * `preview` — give a row or cell thumb the card's name and grade and it gets the
 * hover / focus / tap preview (ArtPreview): a 220px panel with the SAME image
 * this thumb resolved, out of flow, one at a time.
 */
export type CardThumbVariant = "row" | "cell" | "hero";

const FRAME: Record<CardThumbVariant, string> = {
  row: "h-14 w-10",
  cell: "h-[42px] w-[30px]",
  hero: "aspect-[5/7] w-24 sm:w-36",
};

const HOVER_DELAY_MS = 120;

export function CardThumb({
  src,
  alt = "",
  variant = "row",
  fill,
  className,
  preview,
}: {
  src?: string | null;
  alt?: string;
  variant?: CardThumbVariant;
  /** Fill the parent instead of drawing a variant frame — for a large-art tile
   *  frame (the parent owns the aspect ratio). Same failure behavior: a dead or
   *  absent image still occupies the frame rather than collapsing it. */
  fill?: boolean;
  className?: string;
  /** The row's own name and grade → the preview panel on hover, focus and tap. */
  preview?: PreviewMeta;
}) {
  const { src: artSrc, displaySrc, failed, imgRef, imgProps } = useTrimmedArt(src);
  const frameRef = useRef<HTMLSpanElement | null>(null);

  // ── the preview ─────────────────────────────────────────────────────────
  const [open, setOpen] = useState<{ mode: PreviewMode; anchor: DOMRect } | null>(null);
  const timer = useRef<number | null>(null);
  // Touch: did this tap start while the panel was open? The document listener
  // below closes the panel on the pointerdown; the click that follows must then
  // do nothing, or a second tap on the thumb would close and reopen in one go.
  const pressedWhileOpen = useRef(false);
  const previewable = !!preview && !fill && variant !== "hero";

  const close = useCallback(() => {
    if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null; }
    setOpen(null);
  }, []);
  const show = useCallback((mode: PreviewMode) => {
    const el = frameRef.current;
    if (!el) return;
    claimPreview(close);
    setOpen({ mode, anchor: el.getBoundingClientRect() });
  }, [close]);
  const showSoon = useCallback((mode: PreviewMode) => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => show(mode), HOVER_DELAY_MS);
  }, [show]);
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current); releasePreview(close); }, [close]);
  useEffect(() => { if (!open) releasePreview(close); }, [open, close]);

  const isTouch = () => typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;

  // Touch: while the panel is open, ANY tap closes it — on the panel, on the
  // thumb, on the row's name (which then navigates as it always did) or
  // anywhere else. Registered on the pointerdown that opened it, deferred a
  // tick so that tap does not close what it just opened; a tap on the thumb
  // itself is remembered so its click does not reopen the panel.
  useEffect(() => {
    if (!open || open.mode !== "touch") return;
    const onTap = (e: PointerEvent) => {
      pressedWhileOpen.current = !!frameRef.current && e.target instanceof Node && frameRef.current.contains(e.target);
      close();
    };
    const t = window.setTimeout(() => document.addEventListener("pointerdown", onTap, { capture: true }), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("pointerdown", onTap, { capture: true });
    };
  }, [open, close]);

  // Keyboard: focus on the row's link (the thumb's nearest <a>) opens it, blur
  // closes it — the thumb itself is not a tab stop.
  useEffect(() => {
    if (!previewable) return;
    const link = frameRef.current?.closest("a");
    if (!link) return;
    const onFocus = () => { if (!isTouch()) showSoon("hover"); };
    const onBlur = () => close();
    link.addEventListener("focus", onFocus);
    link.addEventListener("blur", onBlur);
    return () => { link.removeEventListener("focus", onFocus); link.removeEventListener("blur", onBlur); };
  }, [previewable, showSoon, close]);

  const handlers = previewable
    ? {
        onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType !== "touch") showSoon("hover"); },
        onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType !== "touch") close(); },
        // Touch: the thumb's tap opens the panel and does NOT follow the row's
        // link — the name beside it still does. A tap while it is open only
        // closes it (the document listener above already did, on pointerdown).
        onClick: (e: React.MouseEvent) => {
          if (!isTouch()) return;
          e.preventDefault();
          e.stopPropagation();
          if (pressedWhileOpen.current) { pressedWhileOpen.current = false; return; }
          show("touch");
        },
      }
    : {};

  const frame = fill
    ? `absolute inset-0 flex items-center justify-center overflow-hidden ${className ?? ""}`
    : `relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-bg-2 ${FRAME[variant]} ${className ?? ""}`;

  return (
    <span ref={frameRef} className={frame} aria-hidden={alt === "" ? true : undefined} {...handlers}>
      {failed || !displaySrc ? (
        <span className={fill ? "block h-8 w-8 rounded-sm bg-line-2" : "block h-1/3 w-1/3 rounded-sm bg-line-2"} />
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element -- remote card art on
           unbounded third-party hosts; next/image would need every one allow-listed. */
        <img
          ref={imgRef}
          {...imgProps}
          // The crop once there is one; the untrimmed photo — still contained,
          // never cut — until then or when no confident crop exists.
          src={artSrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={`h-full w-full object-contain ${fill ? "p-3" : variant === "hero" ? "p-1.5" : "p-px"}`}
        />
      )}
      {open && preview && (
        <ArtPreview src={artSrc} anchor={open.anchor} mode={open.mode} meta={preview} onClose={close} />
      )}
    </span>
  );
}
