"use client";

import { useState } from "react";
import Link from "next/link";
import type { TrendingCard } from "@/lib/data/fetchTrending";
import { Section } from "./Section";
import { IPIcon } from "./IPIcon";
import { CardThumb } from "./CardThumb";
import { GradeChip } from "./GradeChip";
import { IP_CATALOG } from "@/lib/data/ipCatalog";
import { parseGradeLabel } from "@/lib/card/grade";
import { formatCompactUsd, formatInt } from "@/lib/format";

/**
 * TrendingCards (F6, relaid out R-launch) — the homepage's card-level discovery
 * surface: what's HOT by trade velocity, ranked by **hunt pressure = trades ÷
 * active listings** ("everyone wants it, few for sale").
 *
 * It used to render as a dense sortable table wedged directly under the image-led
 * Top Sales grid, which read as a jarring format switch. It now shares Top Sales'
 * CARD anatomy — a hero number, a grade chip via the SSOT, a two-line title, and
 * an IP + platform footer — laid out as a compact horizontal strip. These are
 * card TYPES (no single photo, no per-token image), so the hero is the trending
 * metric rather than a slab photo, which also keeps the strip visually distinct
 * from the Top Sales grid above it.
 *
 * Honesty carried over from the table:
 *   • hunt pressure is only shown as a ratio with 2+ listings; at 0–1 listed the
 *     ratio is noise, so the card shows the raw "N sold · M listed" instead and
 *     those cards sink to the end of the strip (R5-2).
 *   • All | Slabs | Sealed tabs split graded singles from sealed products when
 *     both are present (R4-2).
 *   • the subtitle states the window, momentum coverage, float age, and the
 *     sealed-float caveat.
 */
const PLATFORM_LABEL: Record<string, string> = {
  "collector-crypt": "Collector Crypt",
  beezie: "Beezie",
  phygitals: "Phygitals",
  courtyard: "Courtyard",
};

/** IP key → catalog metadata (icon, colour, name), for the footer IPIcon. The
 *  trending payload only carries the IP KEY, so we resolve display identity from
 *  the same catalog the backend classifies against. */
const IP_META_BY_KEY = new Map(IP_CATALOG.map((m) => [m.key, m]));

export type KindTab = "all" | "slab" | "sealed";

/** Hunt pressure is only a meaningful ratio with 2+ listings (R5-2) — at 0 or 1
 *  listed, `trades ÷ 1` is noise, so those cards show raw counts and rank last. */
function hpValue(c: TrendingCard): number {
  return c.activeListings >= 2 && Number.isFinite(c.huntPressure) ? c.huntPressure : NaN;
}

function humanizeIp(key: string): string {
  if (key === "pokemon") return "Pokémon";
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * The X6/R4-2 honesty notes, as one string. Exported because the combined "Cards"
 * section renders this component's subtitle in a header it does not own — and two
 * hand-copied versions of a coverage note is exactly how one of them goes stale.
 *
 * Depends on the ACTIVE KIND, which is why the combined section lifts that state:
 * the momentum-coverage and sealed-float clauses are only true of the rows on
 * screen, not of the whole set.
 */
export function trendingSubtitle(
  cards: TrendingCard[],
  activeKind: KindTab,
  windowLabel: string,
  floatAgeLabel?: string | null,
): string {
  const shown = activeKind === "all" ? cards : cards.filter((c) => c.kind === activeKind);
  const hasMomentum = shown.some((c) => c.momentum != null && Number.isFinite(c.momentum));
  const anyThinFloat = shown.some((c) => c.activeListings < 2);
  const notes = [
    `hunt pressure = ${windowLabel} trades ÷ listings (shown with 2+ listed)`,
    hasMomentum ? "Δ mom: Collector Crypt + Beezie" : null,
    floatAgeLabel ? `float ${floatAgeLabel}` : null,
    activeKind !== "slab" && anyThinFloat ? "sealed products rarely have marketplace float" : null,
  ].filter(Boolean);
  return `Selling faster than they're listed · ${notes.join(" · ")}`;
}

export const TRENDING_READ_ME =
  "demand outrunning supply — sales per listing, highest first";

export function TrendingCards({
  cards,
  windowLabel = "24h",
  floatAgeLabel,
  seeAllHref,
  headless,
  kind: kindProp,
  onKindChange,
  layout = "strip",
  maxTiles,
}: {
  cards: TrendingCard[];
  /** Which trade window ranked this list — "24h", or "7d" when 24h was tie-heavy (X6). */
  windowLabel?: string;
  /** Age of the listings snapshot behind Float, precomputed server-side ("3h old"). */
  floatAgeLabel?: string | null;
  seeAllHref?: string;
  /** Render the body only — the caller owns the <Section> and its header. Used by
   *  the combined "Cards" section on the homepage. */
  headless?: boolean;
  /** Controlled kind tab. Supplied by a headless caller that needs the active tab
   *  to build the subtitle it renders in its own header. */
  kind?: KindTab;
  onKindChange?: (k: KindTab) => void;
  /** "strip" = the standalone horizontal scroller. "grid" = the same 5-column grid
   *  Top Sales uses, so the two views of the combined Cards section occupy the
   *  same columns at the same widths instead of reading as unrelated surfaces. */
  layout?: "strip" | "grid";
  /** Cap the tiles DRAWN. The kind tabs and their counts still describe the whole
   *  set — this trims the strip, it does not filter the data. */
  maxTiles?: number;
}) {
  const [kindState, setKindState] = useState<KindTab>("all");
  const kind = kindProp ?? kindState;
  const setKind = onKindChange ?? setKindState;

  if (cards.length === 0) return null;

  const slabCount = cards.filter((c) => c.kind === "slab").length;
  const sealedCount = cards.filter((c) => c.kind === "sealed").length;
  // Only offer a split once both kinds are present — otherwise the tabs are noise.
  const showKindTabs = slabCount > 0 && sealedCount > 0;
  const activeKind = showKindTabs ? kind : "all";
  const shown = activeKind === "all" ? cards : cards.filter((c) => c.kind === activeKind);

  // Bar scale off the ratio'd cards only (2+ listed), so thin-float cards don't
  // inflate the axis.
  const maxHP = Math.max(
    1,
    ...shown.map((c) => (c.activeListings >= 2 && Number.isFinite(c.huntPressure) ? c.huntPressure : 0)),
  );

  // Fixed order (the strip isn't user-sortable): hunt pressure desc with
  // thin-float cards sinking (hpValue → NaN), then trades, then volume — the same
  // default the table led with, so the strip opens on the same "hottest" card.
  const sorted = [...shown].sort((a, b) => {
    const av = hpValue(a);
    const bv = hpValue(b);
    const an = !Number.isFinite(av);
    const bn = !Number.isFinite(bv);
    if (an && bn) return b.trades - a.trades || b.volumeUsd - a.volumeUsd;
    if (an) return 1;
    if (bn) return -1;
    return bv - av || b.trades - a.trades || b.volumeUsd - a.volumeUsd;
  });

  const kindTabs: { key: KindTab; label: string; n: number }[] = [
    { key: "all", label: "All", n: cards.length },
    { key: "slab", label: "Slabs", n: slabCount },
    { key: "sealed", label: "Sealed", n: sealedCount },
  ];

  // The window badge and "See all" live in the Section's `right` slot when this
  // component owns its header. HEADLESS, that slot belongs to the Cards toggle, so
  // they move into the body's control row — the window badge is an honesty note
  // (which window ranked this list) and may not be dropped to make room.
  const controls = (
    <div className="flex flex-wrap items-center gap-1 px-4 pb-1 pt-2 sm:px-5">
      <span className="rounded-md border border-line bg-bg-2 px-2 py-1 text-[11px] font-semibold tracking-[0.05em] text-ink-2">
        {windowLabel}
      </span>
      {showKindTabs &&
        kindTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setKind(t.key)}
            aria-pressed={activeKind === t.key}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] transition-colors ${
              activeKind === t.key ? "bg-bg-3 font-semibold text-ink" : "text-ink-3 hover:text-ink"
            }`}
          >
            {t.label}
            <span className="tabular text-[11px] text-ink-4">{t.n}</span>
          </button>
        ))}
      {seeAllHref && (
        <Link
          href={seeAllHref}
          className="ml-auto text-[12px] text-ink-3 transition-colors hover:text-yellow"
        >
          See all →
        </Link>
      )}
    </div>
  );

  const drawn = maxTiles != null ? sorted.slice(0, maxTiles) : sorted;
  const strip =
    layout === "grid" ? (
      <div className="grid grid-cols-2 gap-5 px-4 pb-4 pt-1 sm:px-5 sm:pb-5 md:grid-cols-3 lg:grid-cols-5">
        {drawn.map((c) => (
          <TrendingTile key={c.cardId} card={c} maxHP={maxHP} fluid />
        ))}
      </div>
    ) : (
      <div className="scroll-x flex items-stretch gap-3 px-4 pb-4 pt-2 sm:px-5 sm:pb-5">
        {drawn.map((c) => (
          <TrendingTile key={c.cardId} card={c} maxHP={maxHP} />
        ))}
      </div>
    );

  if (headless) {
    return (
      <>
        {controls}
        {strip}
      </>
    );
  }

  return (
    <Section
      title="Trending cards"
      readMe={TRENDING_READ_ME}
      subtitle={trendingSubtitle(cards, activeKind, windowLabel, floatAgeLabel)}
      right={
        <>
          <span className="rounded-md border border-line bg-bg-2 px-2 py-1 text-[11px] font-semibold tracking-[0.05em] text-ink-2">
            {windowLabel}
          </span>
          {seeAllHref && (
            <Link href={seeAllHref} className="text-[12px] text-ink-3 transition-colors hover:text-yellow">
              See all →
            </Link>
          )}
        </>
      }
      className="font-sans"
      flush
    >
      {showKindTabs && (
        <div className="flex gap-1 px-4 pb-1 pt-1 sm:px-5">
          {kindTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setKind(t.key)}
              aria-pressed={activeKind === t.key}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] transition-colors ${
                activeKind === t.key ? "bg-bg-3 font-semibold text-ink" : "text-ink-3 hover:text-ink"
              }`}
            >
              {t.label}
              <span className="tabular text-[11px] text-ink-4">{t.n}</span>
            </button>
          ))}
        </div>
      )}
      {/* Horizontal strip — fits several across on desktop and scrolls for the
          rest; two-ish per view on mobile. Cards stretch to a uniform height. */}
      <div className="scroll-x flex items-stretch gap-3 px-4 pb-4 pt-2 sm:px-5 sm:pb-5">
        {sorted.map((c) => (
          <TrendingTile key={c.cardId} card={c} maxHP={maxHP} />
        ))}
      </div>
    </Section>
  );
}

/**
 * A trending tile, on the Top-Sales tile anatomy: large art frame, then price +
 * grade, then the name, then this panel's OWN signals as stat lines.
 *
 * ⚠️ THE SHARED FOOTPRINT IS THE POINT. Both views of the Cards section now draw
 * five tiles of the same shape, so the section is the same height in either view
 * as a CONSEQUENCE of the tiles rather than a reserved min-height propping up a
 * short one — which is what left a void under Trending before.
 *
 * ⚠️ ART IS DECORATION; THE TILE IS THE DATA. A trending row is a card TYPE, and a
 * type has no single photo — the frame shows its REPRESENTATIVE token (the window's
 * top sale). Where that token has no cached art, CardThumb's neutral frame fills
 * the slot; the tile is never dropped for missing art, because the trade counts are
 * the reason it is on screen.
 */
function TrendingTile({ card: c, maxHP, fluid }: { card: TrendingCard; maxHP: number; fluid?: boolean }) {
  const ipMeta = IP_META_BY_KEY.get(c.ip);
  const ipName = ipMeta?.name ?? humanizeIp(c.ip);
  // Grade lives inline in the type identity; only chip it when it parses (the SSOT
  // degrades "Ungraded"/blank to nothing, exactly like Top Sales).
  const graded = !!parseGradeLabel(c.grade);
  const ratioable = c.activeListings >= 2 && Number.isFinite(c.huntPressure);

  return (
    <Link
      href={c.href}
      className={`group flex flex-col overflow-hidden rounded-xl bg-bg-2 transition duration-200 ease-out hover:bg-bg-3 motion-safe:hover:-translate-y-0.5 ${
        fluid ? "w-full" : "w-[186px] shrink-0"
      }`}
    >
      {/* Same frame + ground as a Top Sales tile, so the two views' art reads as
          one system rather than two treatments. */}
      <div
        className="relative aspect-[3/4] overflow-hidden"
        style={{
          background:
            "radial-gradient(circle at 50% 30%, rgba(255,255,255,0.04), transparent 65%), linear-gradient(180deg, #141414 0%, #0c0c0c 100%)",
        }}
      >
        <CardThumb src={c.image} fill />
      </div>

      <div className="flex flex-1 flex-col border-t border-line px-4 pb-3.5 pt-3">
        {/* Price + grade on Top Sales' baseline. This is the type's TOP realized
            sale in the window — a price, like its neighbour's, not a sum. */}
        <div className="flex items-baseline justify-between gap-2">
          <span className="tabular text-[16px] font-bold leading-none text-yellow">
            {c.topPriceUsd > 0 ? formatCompactUsd(c.topPriceUsd) : "—"}
          </span>
          {graded ? <GradeChip label={c.grade} /> : null}
        </div>

        <div className="mt-2 line-clamp-2 min-h-[34px] text-[12.5px] font-semibold leading-[1.35] group-hover:text-yellow">
          {c.name}
        </div>

        {/* The trending signals, folded down into stat lines: the sort key first
            (hunt pressure where the float supports a ratio, the raw sold count
            where it does not — the same honest split the hero used), then the
            window's trades and realized volume. */}
        <div className="mt-2 flex items-baseline justify-between gap-2 font-mono text-[11px] tabular">
          <span className="text-ink-3">
            {ratioable ? "hunt pressure" : "sold"}
          </span>
          <span className="font-semibold text-ink">
            {ratioable ? `${c.huntPressure.toFixed(1)}×` : formatInt(c.trades)}
          </span>
        </div>
        {ratioable && (
          <span className="mt-1.5 block h-1 w-full overflow-hidden bg-bg-3" aria-hidden>
            <span
              className="block h-full bg-yellow"
              style={{ width: `${Math.max(6, (c.huntPressure / maxHP) * 100)}%` }}
            />
          </span>
        )}
        <div className="mt-1.5 font-mono text-[10.5px] tabular text-ink-4">
          {[
            `${formatInt(c.trades)} sold`,
            `${c.activeListings === 0 ? "none" : formatInt(c.activeListings)} listed`,
            c.volumeUsd > 0 ? formatCompactUsd(c.volumeUsd) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>

        {/* mt-auto pins the footer to the bottom so a short name can't raise it
            out of line with the tile beside it. */}
        <div className="mt-auto flex items-center gap-1.5 border-t border-line/60 pt-2 text-[11px] leading-none text-ink-3">
          {ipMeta ? (
            <IPIcon
              name={ipMeta.name}
              short={ipMeta.short}
              color={ipMeta.color}
              logo={ipMeta.logo}
              iconBlendMode={ipMeta.iconBlendMode}
              emoji={ipMeta.emoji}
              size={14}
            />
          ) : null}
          <span className="truncate text-ink-2">{ipName}</span>
          <span className="text-ink-4">·</span>
          <span className="truncate">{PLATFORM_LABEL[c.platform] ?? c.platform}</span>
        </div>
      </div>
    </Link>
  );
}
