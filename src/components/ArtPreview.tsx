"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { GradeChip } from "./GradeChip";

/**
 * The card-art preview — a 220px slab floating beside a row's thumb.
 *
 * A 40×56 thumb tells the reader WHICH card the row is; this is where they see
 * it. Portalled to <body> and positioned `fixed`, so it is out of the table's
 * flow (no row grows, no column shifts) and never clipped by a card's
 * `overflow-hidden`. It draws the SAME image the thumb draws — the thumb hands
 * over its resolved source — so the preview cannot disagree with the row.
 *
 * Geometry: beside the thumb (to its right, vertically centred on it), flipped
 * to the left when the right edge would leave the viewport, and clamped so it
 * never crosses the top or bottom. The panel's height is FIXED (art frame +
 * a caption block with a fixed height) so the clamp is exact without a
 * measure-then-move.
 *
 * On touch (`(hover: none)`) there is no hover: the thumb's tap opens it
 * centred, and a second tap — on the panel or anywhere else — closes it (the
 * thumb owns that listener). The hover panel is `pointer-events: none`; the
 * touch panel takes the tap so a close-tap on it cannot fall through to a row
 * beneath.
 *
 * One at a time: opening a panel closes whichever was open. Reduced motion is
 * honoured by having no motion at all — the 120ms intent delay is the caller's.
 */

export const PREVIEW_W = 220;
/** 5:7 of the width. */
const ART_H = Math.round((PREVIEW_W * 7) / 5);
/** Name (two lines) + chip, fixed so the panel's height is known up front. */
const CAPTION_H = 78;
export const PREVIEW_H = ART_H + CAPTION_H + 2; // + the 1px border top and bottom
const GAP = 8;
const MARGIN = 8;

export type PreviewMeta = { name: string; grade?: string | null };
export type PreviewMode = "hover" | "touch";

/** The one open panel's closer — a new panel closes the previous one. */
let closeCurrent: (() => void) | null = null;
export function claimPreview(close: () => void): void {
  if (closeCurrent && closeCurrent !== close) closeCurrent();
  closeCurrent = close;
}
export function releasePreview(close: () => void): void {
  if (closeCurrent === close) closeCurrent = null;
}

/** Where the panel goes for a thumb at `anchor`, in viewport coordinates. */
export function placePreview(anchor: DOMRect, mode: PreviewMode, vw: number, vh: number): { left: number; top: number; flipped: boolean } {
  if (mode === "touch") {
    return { left: Math.max(MARGIN, Math.round((vw - PREVIEW_W) / 2)), top: Math.max(MARGIN, Math.round((vh - PREVIEW_H) / 2)), flipped: false };
  }
  let left = anchor.right + GAP;
  let flipped = false;
  if (left + PREVIEW_W + MARGIN > vw) {
    left = anchor.left - GAP - PREVIEW_W;
    flipped = true;
  }
  left = Math.max(MARGIN, Math.min(left, vw - PREVIEW_W - MARGIN));
  const centred = anchor.top + anchor.height / 2 - PREVIEW_H / 2;
  const top = Math.max(MARGIN, Math.min(centred, vh - PREVIEW_H - MARGIN));
  return { left: Math.round(left), top: Math.round(top), flipped };
}

export function ArtPreview({
  src,
  anchor,
  mode,
  meta,
  onClose,
}: {
  /** The thumb's resolved source — the crop when it has one. */
  src: string | undefined;
  anchor: DOMRect;
  mode: PreviewMode;
  meta: PreviewMeta;
  onClose: () => void;
}) {
  // Placed in render from the anchor the opener measured, so the first frame is
  // already where it belongs. Only ever mounted by a client interaction.
  const pos = typeof window === "undefined" ? null : placePreview(anchor, mode, window.innerWidth, window.innerHeight);

  // Closes on scroll (the anchor moves) and on Escape. The touch "tap anywhere
  // closes it" rule lives with the thumb that opened it (CardThumb), which
  // also has to know whether that tap landed on itself.
  useEffect(() => {
    const onScroll = () => onClose();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (typeof document === "undefined" || !pos) return null;

  return createPortal(
    <div
      role="tooltip"
      data-art-preview=""
      data-flipped={pos.flipped ? "" : undefined}
      className={`fixed z-[80] overflow-hidden rounded-lg border border-line-2 bg-bg-2/95 shadow-[0_12px_38px_rgba(0,0,0,0.6)] backdrop-blur ${
        mode === "touch" ? "pointer-events-auto" : "pointer-events-none"
      }`}
      style={{ left: pos.left, top: pos.top, width: PREVIEW_W, height: PREVIEW_H }}
      onClick={mode === "touch" ? onClose : undefined}
    >
      <div className="flex items-center justify-center bg-bg-2" style={{ width: PREVIEW_W, height: ART_H }}>
        {src ? (
          /* eslint-disable-next-line @next/next/no-img-element -- the thumb's own resolved source */
          <img src={src} alt="" className="h-full w-full object-contain p-2" decoding="async" />
        ) : (
          <span className="block h-8 w-8 rounded-sm bg-line-2" />
        )}
      </div>
      <div className="flex flex-col justify-center gap-1.5 border-t border-line px-3" style={{ height: CAPTION_H }}>
        <span className="line-clamp-2 text-[12.5px] font-semibold leading-[1.35] text-ink">{meta.name}</span>
        {meta.grade ? (
          <span className="flex">
            <GradeChip label={meta.grade} />
          </span>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
