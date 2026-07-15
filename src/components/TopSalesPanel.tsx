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

const PLATFORM_LABELS: Record<string, string> = {
  beezie: "Beezie",
  courtyard: "Courtyard",
  "collector-crypt": "Collector Crypt",
};

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
  const currentSrc = sources[srcIdx];
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
  // WHOLE at the same size. Reads need CORS (Beezie sends `ACAO: *`); when a host
  // refuses cross-origin reads we retry without it and keep an object-cover
  // fallback (display always works, it just isn't auto-trimmed).
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [trimmed, setTrimmed] = useState<string | null>(null);
  const [corsBlocked, setCorsBlocked] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Sealed products (booster boxes, ETBs) are near-square white-bg shots — give
  // them a squarer frame so they aren't letterboxed into a slab's portrait (R6-1).
  const sealed = isSealed(sale.cardName);

  const analyze = () => {
    const el = imgRef.current;
    if (!el || !el.complete || el.naturalWidth === 0) return;
    setLoaded(true);
    if (!trimmed) {
      const cropped = autoTrim(el);
      if (cropped) setTrimmed(cropped);
    }
  };

  // Catch images that finished loading before React attached onLoad (cache hit).
  useEffect(() => {
    if (!corsBlocked) analyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSrc, corsBlocked]);

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
          currentSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={currentSrc}
              alt=""
              {...(corsBlocked ? {} : { crossOrigin: "anonymous" as const })}
              className={`absolute inset-0 h-full w-full object-contain p-3 transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
              onLoad={() => (corsBlocked ? setLoaded(true) : analyze())}
              onError={() => {
                // First failure is usually a host refusing cross-origin reads —
                // retry the same src without crossOrigin so it still displays.
                if (!corsBlocked) {
                  setCorsBlocked(true);
                  return;
                }
                if (srcIdx + 1 < sources.length) {
                  setSrcIdx(srcIdx + 1);
                  setLoaded(false);
                } else setFailed(true);
              }}
              loading="lazy"
            />
          )
        )}
        <span className="absolute right-2.5 top-2.5 z-10 rounded-md bg-yellow px-2 py-[3px] text-[11px] font-bold text-black tabular shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
          {formatCompactUsd(sale.priceUsd)}
        </span>
      </div>

      {/* Fixed-height meta block */}
      <div className="flex h-[110px] flex-col border-t border-line px-4 pt-3.5 pb-4">
        <div className="line-clamp-2 h-[34px] text-[12.5px] font-semibold leading-[1.35]">
          {sale.cardName}
        </div>
        <div className="mt-2 flex h-[16px] items-center gap-1.5 text-[11px] leading-none text-ink-3">
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
        <div className="mt-auto text-[15px] font-bold tabular leading-none">
          {formatCompactUsd(sale.priceUsd)}
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
 * downscaled copy for the subject's bounding box. Returns the trimmed crop, the
 * whole frame when there's no clear background to trim, or null when the pixels
 * can't be read (cross-origin taint).
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

  // Default to the full frame; trim to the subject when one clearly stands out.
  let sx = 0, sy = 0, sw = W, sh = H;
  if (maxX >= minX && maxY >= minY) {
    const bw = (maxX - minX) / scale;
    const bh = (maxY - minY) / scale;
    const meaningful = bw > W * 0.15 && bh > H * 0.15 && (bw < W * 0.97 || bh < H * 0.97);
    if (meaningful) {
      const padX = (maxX - minX) * 0.03 + 1;
      const padY = (maxY - minY) * 0.03 + 1;
      sx = Math.max(0, minX - padX) / scale;
      sy = Math.max(0, minY - padY) / scale;
      sw = Math.min(aw, maxX + padX) / scale - sx;
      sh = Math.min(ah, maxY + padY) / scale - sy;
    }
  }

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
