"use client";

import { useState } from "react";

/**
 * Card artwork with ONE graceful fallback for the whole app (D3): try the
 * primary image, then the fallback URL, then render the branded slab
 * placeholder (entity-colored outline + the card name) instead of a blank box
 * or the browser's broken-image icon. Card art comes from Arweave / CDN
 * proxies that occasionally 502, so every card-art slot should degrade the
 * same way.
 *
 * Three exports:
 *   • CardSlabGlyph — the bare SVG slab outline (also used behind Top Sales
 *     photos while they load);
 *   • CardArtFallback — glyph + optional name, fills its parent;
 *   • CardArt — generic <img> that swaps sources on error and lands on the
 *     fallback (use in tickers/grids);
 *   • CardImage — the card-page hero framing (kept API-compatible).
 */
export function CardSlabGlyph({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 64 96" className="h-full w-auto opacity-90" aria-hidden role="img">
      <rect x="3" y="3" width="58" height="90" rx="6" fill="#0e0e0e" stroke={color} strokeWidth="1.25" opacity="0.7" />
      <rect x="7" y="7" width="50" height="11" rx="2" fill={color} opacity="0.18" />
      <rect x="10" y="11" width="22" height="2" fill={color} opacity="0.6" />
      <rect x="10" y="14.5" width="14" height="1.5" fill={color} opacity="0.4" />
      <rect x="7" y="22" width="50" height="58" rx="2" fill={color} opacity="0.08" />
      <circle cx="32" cy="46" r="11" fill={color} opacity="0.35" />
      <circle cx="32" cy="46" r="5" fill={color} opacity="0.55" />
      <rect x="7" y="83" width="50" height="6" rx="1" fill={color} opacity="0.12" />
      <rect x="10" y="85" width="18" height="2" fill={color} opacity="0.45" />
    </svg>
  );
}

const FALLBACK_COLOR = "#8b8b94";

export function CardArtFallback({
  color = FALLBACK_COLOR,
  name,
}: {
  color?: string;
  name?: string;
}) {
  return (
    <span
      className="flex h-full w-full flex-col items-center justify-center gap-2 px-2 py-2"
      style={{
        background:
          "radial-gradient(circle at 50% 30%, rgba(255,255,255,0.04), transparent 65%), linear-gradient(180deg, #141414 0%, #0c0c0c 100%)",
      }}
    >
      <span className="min-h-0 flex-1">
        <CardSlabGlyph color={color} />
      </span>
      {name && (
        <span className="line-clamp-2 max-w-full text-center text-[10px] leading-tight text-ink-3">
          {name}
        </span>
      )}
    </span>
  );
}

/**
 * Generic card-art <img> for tickers/grids: steps through sources on error and
 * ends at the branded fallback. Fills its (positioned) parent; pass the
 * per-context fit via imgClassName.
 */
export function CardArt({
  sources,
  alt = "",
  color,
  name,
  imgClassName = "h-full w-full object-contain",
  loading = "lazy",
}: {
  sources: Array<string | null | undefined>;
  alt?: string;
  color?: string;
  name?: string;
  imgClassName?: string;
  loading?: "lazy" | "eager";
}) {
  const srcs = sources.filter((s): s is string => Boolean(s));
  const [idx, setIdx] = useState(0);
  const src = srcs[idx];

  if (!src) return <CardArtFallback color={color} name={name} />;
  return (
    /* eslint-disable-next-line @next/next/no-img-element -- external card art, codebase convention */
    <img src={src} alt={alt} className={imgClassName} loading={loading} onError={() => setIdx((i) => i + 1)} />
  );
}

/** Card-page hero framing (rounded border + shadow) over the same fallback. */
export function CardImage({
  primary,
  fallback,
  alt,
  color,
  // Default lazy (F8-5); above-fold callers (the card-page hero) opt into eager.
  loading = "lazy",
}: {
  primary?: string;
  fallback?: string;
  alt: string;
  color?: string;
  loading?: "lazy" | "eager";
}) {
  const sources = [primary, fallback].filter(Boolean) as string[];
  const [idx, setIdx] = useState(0);
  const src = sources[idx];

  if (!src) {
    return (
      <div className="h-full w-full overflow-hidden rounded-xl border border-line/60 bg-bg-1">
        <CardArtFallback color={color} name={alt} />
      </div>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt={alt}
      className="h-full w-full rounded-xl border border-line/60 bg-bg-1 object-contain p-2 drop-shadow-[0_10px_24px_rgba(0,0,0,0.5)]"
      loading={loading}
      onError={() => setIdx((i) => i + 1)}
    />
  );
}
