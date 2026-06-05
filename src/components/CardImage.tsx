"use client";

import { useState } from "react";

/**
 * Card artwork with graceful fallback: tries the primary image, then the
 * fallback URL, then a placeholder. Card art comes from Arweave / CDN proxies
 * that occasionally 502, so this swaps sources on error.
 */
export function CardImage({
  primary,
  fallback,
  alt,
}: {
  primary?: string;
  fallback?: string;
  alt: string;
}) {
  const sources = [primary, fallback].filter(Boolean) as string[];
  const [idx, setIdx] = useState(0);
  const src = sources[idx];

  if (!src) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-xl border border-line/60 bg-bg-1 text-[12px] text-ink-3">
        No image
      </div>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt={alt}
      className="h-full w-full rounded-xl border border-line/60 bg-bg-1 object-contain p-2 drop-shadow-[0_10px_24px_rgba(0,0,0,0.5)]"
      loading="eager"
      onError={() => setIdx((i) => i + 1)}
    />
  );
}
