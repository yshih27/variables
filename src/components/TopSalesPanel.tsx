"use client";

import { useEffect, useRef, useState } from "react";
import type { TopSale } from "@/lib/types";
import { Section } from "./Section";
import { MetricInfo } from "./MetricInfo";
import { CardSlabGlyph } from "./CardImage";
import { IPIcon } from "./IPIcon";
import { proxyImg } from "@/lib/img";
import { formatCompactUsd } from "@/lib/format";
import { cardHref, cardSupported } from "@/lib/card/ids";
import { isSealed } from "@/lib/card/sealed";
import { parseGrade } from "@/lib/card/grade";
import { GradeChip } from "./GradeChip";

const PLATFORM_LABELS: Record<string, string> = {
  beezie: "Beezie",
  courtyard: "Courtyard",
  "collector-crypt": "Collector Crypt",
};

/** How a tile is loading its image, in escalation order. */
type Attempt = "direct" | "proxied" | "plain";

type Props = { items: TopSale[] };

export function TopSalesPanel({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <Section
      // The price tags read as prices but not as REALIZED sale prices — the ⓘ
      // says so (a listing/appraisal would be a very different number). D4.
      title={
        <span className="inline-flex items-center gap-1.5">
          Top Sales
          <MetricInfo metric="salePrice" />
        </span>
      }
      right={<span className="text-[11.5px] text-ink-3">top {items.length} cards · 24h</span>}
      className="font-sans"
      flush
    >
      <div className="grid grid-cols-2 gap-5 px-4 pb-4 pt-1 sm:px-5 sm:pb-5 md:grid-cols-3 lg:grid-cols-5">
        {items.map((s, i) => (
          <SaleCard key={`${s.platform}:${s.cardName}:${i}`} sale={s} />
        ))}
      </div>
    </Section>
  );
}

function SaleCard({ sale }: { sale: TopSale }) {
  const sources = [sale.image, sale.imageFallback]
    .map((s) => proxyImg(s ?? undefined))
    .filter((s): s is string => Boolean(s));
  const [srcIdx, setSrcIdx] = useState(0);
  const [failed, setFailed] = useState(sources.length === 0);
  const rawSrc = sources[srcIdx];
  const platformLabel = PLATFORM_LABELS[sale.platform] ?? sale.platform;
  // Link to the card detail page when we can render it; else fall back to the IP.
  const cardLink =
    sale.tokenId && cardSupported(sale.platform)
      ? cardHref(sale.platform, sale.tokenId)
      : `/ip/${sale.ipKey}`;

  // Sources frame the slab at wildly different scales (Beezie centres it on a
  // 2160² near-black field; others ship tight crops). No CSS fit normalises that
  // because it can't tell the slab from its padding. So once the photo loads we
  // read its pixels, detect the slab's bounding box (autoTrim), and swap in a
  // tightly-cropped version rendered with object-contain — every slab then shows
  // WHOLE at the same size.
  //
  // ⚠️ The trim needs READABLE pixels, and that's where the Beezie Pikachu slipped
  // through: its asset load refused the cross-origin read, so the OLD code reloaded
  // the SAME url without `crossOrigin` — which displays but taints the canvas, so
  // autoTrim could never run and the slab rendered small inside its padded field
  // via object-contain. Now a refused read escalates through the SAME-ORIGIN
  // `/api/img` proxy first (same-origin pixels are always readable → trim works →
  // true normalisation); only if even that fails do we fall to a plain,
  // un-trimmable load, and THAT one renders object-cover so the subject still fills
  // the tile height rather than floating tiny in its padding.
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [trimmed, setTrimmed] = useState<string | null>(null);
  // How we're loading the CURRENT source. "direct": as proxyImg gave it, with a
  // CORS read. "proxied": routed through /api/img so pixels are same-origin.
  // "plain": no CORS — displays but can't be trimmed (last resort).
  const [attempt, setAttempt] = useState<Attempt>("direct");
  const [loaded, setLoaded] = useState(false);

  // Same-origin already (a `/api/img?…` or `/…` path) → the proxy step is a no-op,
  // so a failed direct read jumps straight to the next source.
  const sameOrigin = !!rawSrc && rawSrc.startsWith("/");
  const displaySrc =
    attempt === "proxied" && !sameOrigin
      ? `/api/img?url=${encodeURIComponent(rawSrc)}`
      : rawSrc;
  // direct + proxied both aim for a readable (trimmable) canvas; plain does not.
  const canTrim = attempt !== "plain";

  // Sealed products (booster boxes, ETBs) are near-square white-bg shots — give
  // them a squarer frame so they aren't letterboxed into a slab's portrait (R6-1).
  const sealed = isSealed(sale.cardName);
  // The grade is inline in the card name — no feed gives us a separate field.
  const grade = parseGrade(sale.cardName);

  const analyze = () => {
    const el = imgRef.current;
    if (!el || !el.complete || el.naturalWidth === 0) return;
    setLoaded(true);
    if (!trimmed) {
      const cropped = autoTrim(el);
      if (cropped) setTrimmed(cropped);
    }
  };

  // Escalate one step when a load fails: direct → proxied → plain → next source.
  const onLoadError = () => {
    if (attempt === "direct" && !sameOrigin) {
      setAttempt("proxied");
    } else if (attempt !== "plain") {
      setAttempt("plain"); // display-only; renders object-cover, not trimmed
    } else if (srcIdx + 1 < sources.length) {
      setSrcIdx(srcIdx + 1);
      setAttempt("direct");
      setLoaded(false);
    } else {
      setFailed(true);
    }
  };

  // Catch images that finished loading before React attached onLoad (cache hit).
  useEffect(() => {
    if (canTrim) analyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displaySrc, canTrim]);

  return (
    <a
      href={cardLink}
      className="group flex flex-col overflow-hidden rounded-xl bg-bg-2 transition duration-200 ease-out hover:bg-bg-3 motion-safe:hover:-translate-y-0.5"
    >
      {/* Image area: the glyph is the FAILURE fallback ONLY — never rendered behind a
          photo (R7-4). While loading, the dark surface shows (img fades in); a photo
          uses object-contain so white boxes / off-scale slabs show WHOLE, no crop. */}
      <div
        className={`relative overflow-hidden ${sealed ? "aspect-[4/5]" : "aspect-[3/4]"}`}
        style={{
          background:
            "radial-gradient(circle at 50% 30%, rgba(255,255,255,0.04), transparent 65%), linear-gradient(180deg, #141414 0%, #0c0c0c 100%)",
        }}
      >
        {failed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 pb-3 pt-4">
            <span className="min-h-0 flex-1">
              {/* Neutral gray so a missing image reads as a skeleton, not artwork
                  (Q8) — card-detail already uses the neutral fallback. */}
              <CardSlabGlyph color="#8b8b94" />
            </span>
            <span className="line-clamp-2 max-w-full text-center text-[10px] leading-tight text-ink-3">
              {sale.cardName}
            </span>
          </div>
        ) : trimmed ? (
          // Auto-trimmed crop: whole slab, uniform size across every tile.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={trimmed}
            alt=""
            className="absolute inset-0 m-auto h-full w-full object-contain p-2 drop-shadow-[0_8px_18px_rgba(0,0,0,0.5)]"
          />
        ) : (
          displaySrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={displaySrc}
              alt=""
              {...(canTrim ? { crossOrigin: "anonymous" as const } : {})}
              // Trimmable loads get object-contain (whole slab, uniform); the
              // un-trimmable last resort gets object-cover so the subject fills
              // the tile height instead of sitting tiny in its padding.
              className={`absolute inset-0 h-full w-full transition-opacity duration-200 ${
                canTrim ? "object-contain p-3" : "object-cover"
              } ${loaded ? "opacity-100" : "opacity-0"}`}
              onLoad={() => (canTrim ? analyze() : setLoaded(true))}
              onError={onLoadError}
              loading="lazy"
            />
          )
        )}
      </div>

      {/* Meta — price + grade, then title, then platform/IP. Adopts the gacha
          PrizeCard's anatomy so the two card surfaces read as one system (R1).
          The price used to print TWICE: a chip over the image and again at the
          bottom. It now appears once, here, where the grade gives it context.
          No fixed outer height any more — the title reserves two lines
          (min-h, not h, so a long name grows instead of clipping) and the grid
          row equalises the rest. */}
      <div className="flex flex-col border-t border-line px-4 pb-3.5 pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="tabular text-[16px] font-bold leading-none text-yellow">
            {formatCompactUsd(sale.priceUsd)}
          </span>
          {/* Omitted entirely when the name carries no parseable grade (Beezie
              names often don't) — a chip would imply a grade we don't have. */}
          {grade ? <GradeChip label={grade.label} /> : null}
        </div>

        <div className="mt-2 line-clamp-2 min-h-[34px] text-[12.5px] font-semibold leading-[1.35]">
          {sale.cardName}
        </div>

        <div className="mt-2 flex items-center gap-1.5 border-t border-line/60 pt-2 text-[11px] leading-none text-ink-3">
          <IPIcon
            name={sale.ipName}
            short={sale.ipShort}
            color={sale.ipColor}
            logo={sale.ipLogo}
            iconBlendMode={sale.ipIconBlendMode}
            emoji={sale.ipEmoji}
            size={14}
          />
          <span className="truncate text-ink-2">{platformLabel}</span>
        </div>
      </div>
    </a>
  );
}

/**
 * Detect the slab/card inside a photo and return a tightly-cropped JPEG data
 * URL, so every tile can render the WHOLE subject at the same size with
 * object-contain. Sources frame slabs at inconsistent scales and CSS can't tell
 * the subject from its padding — so we trim the uniform background by scanning a
 * downscaled copy for the subject's bounding box. Returns the trimmed crop, or
 * null when there's no confident crop to make — no clear subject, or the pixels
 * can't be read (cross-origin taint). Null is the caller's cue to render
 * object-cover instead of a small object-contain.
 */
function autoTrim(img: HTMLImageElement): string | null {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  if (!W || !H) return null;

  // Downscale for a cheap bounding-box scan.
  const aw = Math.min(W, 160);
  const scale = aw / W;
  const ah = Math.max(1, Math.round(H * scale));
  const scan = document.createElement("canvas");
  scan.width = aw;
  scan.height = ah;
  const sctx = scan.getContext("2d", { willReadFrequently: true });
  if (!sctx) return null;
  sctx.drawImage(img, 0, 0, aw, ah);

  let px: Uint8ClampedArray;
  try {
    px = sctx.getImageData(0, 0, aw, ah).data;
  } catch {
    return null; // cross-origin tainted — pixels unreadable
  }

  // Background ≈ average of the four corners.
  const corner = (x: number, y: number) => {
    const i = (y * aw + x) * 4;
    return [px[i], px[i + 1], px[i + 2]];
  };
  const corners = [corner(0, 0), corner(aw - 1, 0), corner(0, ah - 1), corner(aw - 1, ah - 1)];
  const bg = [0, 1, 2].map((k) => corners.reduce((sum, c) => sum + c[k], 0) / corners.length);

  // Bounding box of everything that differs from the background.
  const THRESH = 42; // sum of per-channel deltas
  let minX = aw, minY = ah, maxX = -1, maxY = -1;
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const i = (y * aw + x) * 4;
      const delta =
        Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]);
      if (delta > THRESH) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // A subject has to clearly stand out from the background, and clearly be
  // SMALLER than the frame, or there's nothing to trim.
  //
  // ⚠️ Return null — don't fall back to re-drawing the full frame. A full-frame
  // "crop" is indistinguishable from a real one to the caller, so a padded slab
  // (Beezie's near-black field) would be handed back untrimmed and rendered
  // object-contain — small. Null tells the caller "couldn't normalise this one",
  // and it renders object-cover so the subject at least fills the tile height.
  if (maxX < minX || maxY < minY) return null; // nothing differed from the background
  const bw = (maxX - minX) / scale;
  const bh = (maxY - minY) / scale;
  const meaningful = bw > W * 0.15 && bh > H * 0.15 && (bw < W * 0.97 || bh < H * 0.97);
  if (!meaningful) return null; // subject fills the frame (or is too tiny to trust)
  const padX = (maxX - minX) * 0.03 + 1;
  const padY = (maxY - minY) * 0.03 + 1;
  const sx = Math.max(0, minX - padX) / scale;
  const sy = Math.max(0, minY - padY) / scale;
  const sw = Math.min(aw, maxX + padX) / scale - sx;
  const sh = Math.min(ah, maxY + padY) / scale - sy;

  // Re-draw the chosen region, capped to a sane resolution.
  const outH = Math.min(sh, 720);
  const k = outH / sh;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(sw * k));
  out.height = Math.max(1, Math.round(outH));
  const octx = out.getContext("2d");
  if (!octx) return null;
  octx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
  try {
    return out.toDataURL("image/jpeg", 0.92);
  } catch {
    return null;
  }
}
