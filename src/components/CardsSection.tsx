"use client";

import { useState } from "react";
import { Section } from "./Section";
import { MetricInfo } from "./MetricInfo";
import { TopSalesPanel, TOP_SALES_NOTE, TOP_SALES_READ_ME } from "./TopSalesPanel";
import {
  TrendingCards,
  trendingSubtitle,
  TRENDING_READ_ME,
  type KindTab,
} from "./TrendingCards";
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
  const slabs = trending.filter((c) => c.kind === "slab").length;
  const sealed = trending.filter((c) => c.kind === "sealed").length;
  const activeKind: KindTab = slabs > 0 && sealed > 0 ? kind : "all";

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
      {/* ⚠️ ONE HEIGHT ACROSS THE TOGGLE. Both views occupy the SAME grid cell and
          the inactive one is `invisible` rather than unmounted, so the body is
          always as tall as the taller view and switching cannot resize the section
          under the cursor. This is the brief's min-height outcome without a magic
          number: no hardcoded px to go stale when the tile art, the column count
          or a breakpoint changes.
          `visibility: hidden` (not `hidden`/display:none) is load-bearing — it
          keeps the box in layout, which is the whole point, and it also drops the
          hidden panel out of the tab order, which display:none would do but
          opacity-0 would not. aria-hidden keeps it out of the a11y tree too. */}
      <div className="grid">
        <div
          className={`col-start-1 row-start-1 ${isSales ? "" : "invisible"}`}
          aria-hidden={!isSales}
        >
          <TopSalesPanel items={topSales} headless />
        </div>
        <div
          className={`col-start-1 row-start-1 ${isSales ? "invisible" : ""}`}
          aria-hidden={isSales}
        >
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
        </div>
      </div>
    </Section>
  );
}
