"use client";

import { useState } from "react";
import { Section } from "./Section";
import { MetricInfo } from "./MetricInfo";
import { TopSalesPanel, TOP_SALES_NOTE, TOP_SALES_READ_ME } from "./TopSalesPanel";
import {
  TrendingCards,
  trendingKindTabs,
  trendingSubtitle,
  TRENDING_READ_ME,
  type KindTab,
} from "./TrendingCards";
import Link from "next/link";
import type { TopSale } from "@/lib/types";
import type { TrendingCard } from "@/lib/data/fetchTrending";

/**
 * Cards — Top Sales and Trending in ONE section, switched in the header.
 *
 * Both answer the same question ("which cards matter today"), so per the terminal
 * UX doctrine they belong in one zone with the depth behind a switcher, not as two
 * stacked sections competing for the same slot.
 *
 * ⚠️ THE HEADER IS MODE-AWARE AND EVERY NOTE SURVIVES THE MOVE. Each view keeps
 * exactly the copy it had standing alone:
 *   • Top sales — the salePrice ⓘ (these are REALIZED sales, not listings or
 *     appraisals) and the "top N cards · 24h" note, both of which lived in the
 *     old header's title and `right` slot; `right` now holds the toggle, so they
 *     render as the subtitle.
 *   • Trending — its readMe and its full honesty subtitle (window, momentum
 *     coverage, float age, sealed-float caveat), rebuilt from `trendingSubtitle`
 *     rather than copied, so the two callers cannot drift.
 *
 * ⚠️ THE KIND TAB IS LIFTED. Trending's subtitle depends on which of All/Slabs/
 * Sealed is active — the momentum and sealed-float clauses describe the rows ON
 * SCREEN. The header lives here, so the state it reads has to live here too; the
 * tabs themselves still render inside Trending's own body.
 */
/** Trending draws the same number of tiles as Top sales, so the two views fill the
 *  same 5-up grid. The kind tabs keep counting the WHOLE set — this caps what is
 *  drawn, not what is measured. */
const TRENDING_TILES = 5;

/**
 * ⚠️ ONE SET OF VERTICAL METRICS FOR EVERY CONTROL IN THE BAND. The band's height
 * must not depend on WHICH controls are in it, or the section grows a row on one
 * side of the toggle — which is exactly the 77px jump this replaced (Trending drew
 * a kind-tabs row; Top sales drew nothing). Same padding, same text size, same line
 * box for the window badge and the tabs, so any combination measures the same.
 */
const CTRL = "px-2.5 py-1 text-[12px] leading-[16px]";

/** Top Sales is a 24h list — its badge states the same window its note does. */
const TOP_SALES_WINDOW = "24h";

export function CardsSection({
  topSales,
  trending,
  trendingWindow = "24h",
  floatAgeLabel,
  seeAllHref,
}: {
  topSales: TopSale[];
  trending: TrendingCard[];
  trendingWindow?: string;
  floatAgeLabel?: string | null;
  seeAllHref?: string;
}) {
  const [view, setView] = useState<"sales" | "trending">("sales");
  const [kind, setKind] = useState<KindTab>("all");

  const hasSales = topSales.length > 0;
  const hasTrending = trending.length > 0;
  if (!hasSales && !hasTrending) return null;

  // A view with no rows is not offered — the toggle never lands on an empty panel.
  const views = [
    { key: "sales" as const, label: "Top sales", enabled: hasSales },
    { key: "trending" as const, label: "Trending", enabled: hasTrending },
  ].filter((v) => v.enabled);

  const active = views.some((v) => v.key === view) ? view : views[0].key;

  // Trending's tabs only appear when both kinds are present; mirror that here so
  // the subtitle describes the set the body is actually showing.
  const kinds = trendingKindTabs(trending);
  const activeKind: KindTab = kinds.show ? kind : "all";

  const isSales = active === "sales";

  return (
    <Section
      title="Cards"
      readMe={isSales ? TOP_SALES_READ_ME : TRENDING_READ_ME}
      subtitle={
        isSales ? (
          <span className="inline-flex items-center gap-1.5">
            {TOP_SALES_NOTE(topSales.length)}
            <MetricInfo metric="salePrice" />
          </span>
        ) : (
          trendingSubtitle(trending, activeKind, trendingWindow, floatAgeLabel)
        )
      }
      right={
        views.length > 1 ? (
          <div className="flex gap-1 rounded-lg border border-line bg-bg-2 p-0.5">
            {views.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                aria-pressed={active === v.key}
                className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                  active === v.key ? "bg-bg-3 font-semibold text-ink" : "text-ink-3 hover:text-ink"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        ) : undefined
      }
      className="font-sans"
      flush
    >
      {/* ⚠️ NO RESERVED HEIGHT. Both views now draw five tiles on the SAME
          anatomy (large art frame, price + grade, name, stat lines, IP · platform
          footer), so the section is the same height in either view because the
          TILES match — not because a min-height was propping the shorter one up.
          The old approach kept both panels mounted with the inactive one
          `invisible`; that held the height but left a void under Trending, and
          paid for it with a second full panel in the DOM. Only the active view
          renders now. */}
      {/* ⚠️ THE CONTROL BAND IS DRAWN BY BOTH VIEWS. It is a real row with real
          content either way — the window badge always (Top Sales is a 24h list;
          Trending's badge names its ranking window), plus Trending's kind tabs and
          "See all". No reserved height and no magic number: the band is the same
          element with the same metrics in both views, so the section measures the
          same whichever is showing. */}
      <div className="flex flex-wrap items-center gap-1 px-4 pb-1 pt-2 sm:px-5">
        <span
          className={`rounded-md border border-line bg-bg-2 font-semibold tracking-[0.05em] text-ink-2 ${CTRL}`}
        >
          {isSales ? TOP_SALES_WINDOW : trendingWindow}
        </span>
        {!isSales && kinds.show
          ? kinds.tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setKind(t.key)}
                aria-pressed={activeKind === t.key}
                className={`flex items-center gap-1.5 rounded-lg transition-colors ${CTRL} ${
                  activeKind === t.key ? "bg-bg-3 font-semibold text-ink" : "text-ink-3 hover:text-ink"
                }`}
              >
                {t.label}
                <span className="tabular text-[11px] text-ink-4">{t.n}</span>
              </button>
            ))
          : null}
        {!isSales && seeAllHref && (
          <Link
            href={seeAllHref}
            className="ml-auto text-[12px] leading-[16px] text-ink-3 transition-colors hover:text-yellow"
          >
            See all →
          </Link>
        )}
      </div>

      {isSales ? (
        <TopSalesPanel items={topSales} headless />
      ) : (
        <TrendingCards
          cards={trending}
          windowLabel={trendingWindow}
          floatAgeLabel={floatAgeLabel}
          seeAllHref={seeAllHref}
          kind={kind}
          onKindChange={setKind}
          headless
          layout="grid"
          maxTiles={TRENDING_TILES}
        />
      )}
    </Section>
  );
}
