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
  className,
}: {
  src?: string | null;
  alt?: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = failed ? null : proxyImg(src ?? undefined);

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-bg-2 ${className ?? ""}`}
      style={{ width: size, height: size }}
      aria-hidden={alt === "" ? true : undefined}
    >
      {url ? (
        /* eslint-disable-next-line @next/next/no-img-element -- remote card art on
           unbounded third-party hosts; next/image would need every one allow-listed. */
        <img
          src={url}
          alt={alt}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="block h-1/3 w-1/3 rounded-sm bg-line-2" />
      )}
    </span>
  );
}
