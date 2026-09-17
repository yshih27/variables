"use client";

import type { TopSale } from "@/lib/types";
import { TILE_PRICE_ROW, TILE_STAT_ROW } from "./TrendingCards";
import { Section } from "./Section";
import { MetricInfo } from "./MetricInfo";
import { CardSlabGlyph } from "./CardImage";
import { IPIcon } from "./IPIcon";
import { useTrimmedArt } from "@/lib/img/autoTrim";
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

type Props = { items: TopSale[] };

export const TOP_SALES_NOTE = (n: number) => `top ${n} cards · 24h`;

/** How to read the Top-sales view — the house readMe line (lowercase, mono,
 *  states the conclusion). "realized" and "cleared" are the load-bearing words:
 *  these are settled trades, not listings, bids or appraisals — the same claim
 *  the salePrice ⓘ beside it makes. */
export const TOP_SALES_READ_ME =
  "the largest realized sales today — price is what cleared";

export function TopSalesPanel({ items, headless }: Props & { headless?: boolean }) {
  if (items.length === 0) return null;

  const grid = (
    <div className="grid grid-cols-2 gap-5 px-4 pb-4 pt-1 sm:px-5 sm:pb-5 md:grid-cols-3 lg:grid-cols-5">
      {items.map((s, i) => (
        <SaleCard key={`${s.platform}:${s.cardName}:${i}`} sale={s} />
      ))}
    </div>
  );

  // Body only — the combined "Cards" section owns the header. The salePrice ⓘ and
  // the "top N cards · 24h" note move up with it (see CardsSection); neither is
  // dropped, they just render in a header this component no longer owns.
  if (headless) return grid;

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
      readMe={TOP_SALES_READ_ME}
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
  const platformLabel = PLATFORM_LABELS[sale.platform] ?? sale.platform;
  // Link to the card detail page when we can render it; else fall back to the IP.
  const cardLink =
    sale.tokenId && cardSupported(sale.platform)
      ? cardHref(sale.platform, sale.tokenId)
      : `/ip/${sale.ipKey}`;

  // The trim and its load escalation (direct → /api/img proxied → plain) live in
  // `useTrimmedArt` — src/lib/img/autoTrim.ts — where every card-art surface
  // shares them. What this tile keeps is its own last-resort rule: an
  // un-trimmable plain load renders object-cover so the subject fills the tile
  // height instead of sitting tiny in its padding.
  const art = useTrimmedArt(sale.image, sale.imageFallback);
  const { displaySrc, trimmed, canTrim, loaded, failed, imgRef } = art;

  // Sealed products (booster boxes, ETBs) are near-square white-bg shots — give
  // them a squarer frame so they aren't letterboxed into a slab's portrait (R6-1).
  const sealed = isSealed(sale.cardName);
  // The grade is inline in the card name — no feed gives us a separate field.
  const grade = parseGrade(sale.cardName);

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
              {...art.imgProps}
              alt=""
              // Trimmable loads get object-contain (whole slab, uniform); the
              // un-trimmable last resort gets object-cover so the subject fills
              // the tile height instead of sitting tiny in its padding.
              className={`absolute inset-0 h-full w-full transition-opacity duration-200 ${
                canTrim ? "object-contain p-3" : "object-cover"
              } ${loaded ? "opacity-100" : "opacity-0"}`}
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
        <div className={`flex justify-between gap-2 ${TILE_PRICE_ROW}`}>
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

        {/* ⚠️ PARITY ROW — deliberately empty. The Trending tile carries its signals
            (hunt pressure / sold, float, volume) on a row in this position; drawing
            the same row here, with the same metrics and no content, is what keeps
            the two tiles — and therefore the Cards section across its toggle — the
            same height. It is a real row, not a reserved min-height, and it holds
            nothing because a top sale has no equivalent signal to state: every row
            in this list cleared within the same 24h window, so a date line would be
            the same string five times. Fill it the moment there is something true
            to put here. */}
        <div className={`mt-2 font-mono ${TILE_STAT_ROW}`} aria-hidden>
          &nbsp;
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
