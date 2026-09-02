"use client";

import { useState } from "react";
import { proxyImg } from "@/lib/img";

/**
 * CardThumb — a small square of card art for list and tile rows.
 *
 * Routes through `proxyImg`, so it inherits the app's one set of image rules
 * (Beezie's `original-N.jpg` rewrite, /api/img for CORP-blocked hosts). Never
 * point an <img> at a raw metadata URL — those rules exist because several of
 * these hosts otherwise fail to render at all.
 *
 * ⚠️ A MISSING THUMB IS A BLANK FRAME, NOT A GAP. Card art comes from Arweave and
 * CDN mirrors that 502 and go dead; some tokens have no cached art at all. The
 * frame always occupies its space so rows never reflow as images resolve or fail,
 * and a failure lands on the same neutral frame as an absent URL — the row is
 * about the trade, and art is decoration that must not be able to break it.
 */
export function CardThumb({
  src,
  alt = "",
  size = 32,
  fill,
  className,
}: {
  src?: string | null;
  alt?: string;
  size?: number;
  /** Fill the parent instead of drawing a fixed `size` square — for a large-art
   *  tile frame (the parent owns the aspect ratio). Same failure behavior: a dead
   *  or absent image still occupies the frame rather than collapsing it. */
  fill?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = failed ? null : proxyImg(src ?? undefined);

  return (
    <span
      className={
        fill
          ? `absolute inset-0 flex items-center justify-center overflow-hidden ${className ?? ""}`
          : `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-bg-2 ${className ?? ""}`
      }
      style={fill ? undefined : { width: size, height: size }}
      aria-hidden={alt === "" ? true : undefined}
    >
      {url ? (
        /* eslint-disable-next-line @next/next/no-img-element -- remote card art on
           unbounded third-party hosts; next/image would need every one allow-listed. */
        <img
          src={url}
          alt={alt}
          {...(fill ? {} : { width: size, height: size })}
          loading="lazy"
          decoding="async"
          // Large frames use object-CONTAIN so an off-scale slab shows WHOLE
          // (Top Sales' rule); the 32px thumb keeps cover, where a crop reads fine.
          className={fill ? "h-full w-full object-contain p-3" : "h-full w-full object-cover"}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={fill ? "block h-8 w-8 rounded-sm bg-line-2" : "block h-1/3 w-1/3 rounded-sm bg-line-2"} />
      )}
    </span>
  );
}
