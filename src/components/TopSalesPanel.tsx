"use client";

import { useState } from "react";
import type { TopSale } from "@/lib/types";
import { IPIcon } from "./IPIcon";
import { proxyImg } from "@/lib/img";
import { formatCompactUsd } from "@/lib/format";
import { cardHref, cardSupported } from "@/lib/card/ids";

const PLATFORM_LABELS: Record<string, string> = {
  beezie: "Beezie",
  courtyard: "Courtyard",
  "collector-crypt": "Collector Crypt",
};

type Props = { items: TopSale[] };

export function TopSalesPanel({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-bg-1">
      <div className="flex items-center gap-2.5 border-b border-line px-6 py-5">
        <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-green px-2 text-[11px] font-bold uppercase tracking-[0.04em] text-black">
          📈 Sales
        </span>
        <span className="text-[15px] font-semibold">Top Sales</span>
        <span className="ml-auto text-[11.5px] text-ink-3">
          top {items.length} cards · 24h
        </span>
      </div>
      <div className="grid grid-cols-2 gap-5 px-6 pb-6 pt-6 md:grid-cols-3 lg:grid-cols-5">
        {items.map((s, i) => (
          <SaleCard key={`${s.platform}:${s.cardName}:${i}`} sale={s} />
        ))}
      </div>
    </div>
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

  // No JS "loaded" gating — the photo renders at full opacity layered ABOVE
  // the slab placeholder. While the image is still downloading it has no
  // pixels (transparent), so the slab shows through; once decoded it covers
  // the slab; on error `onError` removes it and the slab stays. This is
  // race-free, unlike an opacity-toggle gated on a load event that can fire
  // during SSR hydration before React attaches the handler.
  //
  // Beezie ships a 2160² image with the slab small (~44%w × ~78%h) centered
  // on its own near-black field; Collector Crypt ships a tight slab crop. So:
  //   - Beezie → object-contain + scale-150 so the WHOLE slab (case + grade
  //              label) enlarges to fill the frame like CC; dark side margins
  //              overflow and clip harmlessly against the card background.
  //   - Others → object-contain with padding so the slab "floats".
  const isBeezie = sale.platform === "beezie";
  const imgClass = isBeezie
    ? "absolute inset-0 m-auto max-h-full max-w-full scale-[1.5] object-contain drop-shadow-[0_8px_18px_rgba(0,0,0,0.55)]"
    : "absolute inset-0 m-auto max-h-full max-w-full object-contain px-4 py-5 drop-shadow-[0_8px_18px_rgba(0,0,0,0.55)]";

  return (
    <a
      href={cardLink}
      className="group flex flex-col overflow-hidden rounded-xl bg-bg-2 transition hover:-translate-y-0.5"
    >
      {/* Image area: slab placeholder always behind, img fades in on top */}
      <div
        className="relative aspect-[3/4] overflow-hidden"
        style={{
          background:
            "radial-gradient(circle at 50% 30%, rgba(255,255,255,0.04), transparent 65%), linear-gradient(180deg, #141414 0%, #0c0c0c 100%)",
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center px-4 py-5">
          <SlabPlaceholder color={sale.ipColor} />
        </div>
        {currentSrc && !failed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentSrc}
            alt=""
            className={imgClass}
            onError={() => {
              if (srcIdx + 1 < sources.length) {
                setSrcIdx(srcIdx + 1);
              } else {
                setFailed(true);
              }
            }}
            loading="lazy"
          />
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

function SlabPlaceholder({ color }: { color: string }) {
  return (
    <svg
      viewBox="0 0 64 96"
      className="h-full w-auto opacity-90"
      aria-hidden
      role="img"
    >
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
