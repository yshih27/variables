import { unstable_cache } from "next/cache";
import type { TickerItem } from "@/components/NavBar";
import type { IPRow } from "@/lib/types";
import { formatCompactNumber, formatCompactUsd } from "@/lib/format";
import { tickerOf } from "@/lib/indices/naming";
import { fetchHomepage } from "./fetchHomepage";
import { readIndexSeries, weeklyChangePct } from "./indices";

/**
 * The market context strip (P1-C) — one line of market state carried under the nav
 * on every detail page, the way a terminal keeps its tape on every screen.
 *
 * ZERO new reads: everything here comes off the precomputed homepage payload
 * (`homepage-payload` snapshot, one row) plus the market price-index series the
 * homepage headline already reads. The numbers are therefore the SAME numbers the
 * homepage hero shows — built from the same payload by the same calls, not
 * re-derived — so the two surfaces can never disagree.
 *
 * The homepage does NOT get this strip: its hero IS this line at 64px, and repeating
 * it 200px above would be the two-surfaces-one-number smell the one-question doctrine
 * forbids.
 */

/** Build the five items. Never throws — see `buildMarketTicker`. */
async function buildItems(): Promise<TickerItem[]> {
  const [data, marketIdx] = await Promise.all([
    fetchHomepage(),
    // Same call as src/app/page.tsx's getMarketIndexSeries.
    readIndexSeries("market", "total", { kind: "price", from: "2000-01-01" }).catch(() => []),
  ]);
  const hero = data.hero;
  const items: TickerItem[] = [];

  // 1 — V-MKT. Level and Δ1w are built EXACTLY as the homepage headline builds
  // them: rebase to the first finite point, read the newest level, and take the
  // week-over-week move between the last two COMPLETE weeks (the price index is
  // weekly and stamped at week-end, so the running week is a partial and
  // `weeklyChangePct` drops it internally).
  const idxBase = marketIdx.find((p) => Number.isFinite(p.value) && p.value > 0)?.value ?? null;
  const level =
    idxBase && marketIdx.length ? (marketIdx[marketIdx.length - 1].value / idxBase) * 100 : null;
  items.push({
    label: tickerOf("market", "total"),
    value: level != null && Number.isFinite(level) ? level.toFixed(2) : "—",
    delta: weeklyChangePct(marketIdx),
    deltaWindow: "1w",
    href: "/ips",
    title: "The Varible Market Index — constant-quality price level, rebased to 100 at inception",
    priority: true,
  });

  // 2 — Market cap. ⚠️ `mcapPct24h` is a FRACTION (0.012 = +1.2%) while `vol24Pct`
  // below is already a PERCENT; ×100 here is the conversion, not a bug.
  items.push({
    label: "Cap",
    value: formatCompactUsd(hero.totalMcapUsd),
    delta: hero.mcapPct24h == null ? null : hero.mcapPct24h * 100,
    deltaWindow: "24h",
    href: "/ips",
    title: "Total tracked market capitalisation",
    priority: true,
  });

  // 3 — 24h marketplace volume. The label carries the window, so the delta needs no
  // suffix of its own.
  items.push({
    label: "24h vol",
    value: formatCompactUsd(hero.vol24Usd),
    delta: hero.vol24Pct,
    href: "/platforms",
    title: "Marketplace resale volume over the last 24h",
  });

  // 4 — Leading IP by market cap, and its share of the total. Only when BOTH the
  // IP's cap and the market total are real: a share of an unknown total is noise.
  // ⚠️ `data.ips` is sorted by 24h VOLUME (fetchHomepage), not by market cap. This
  // item is a market-cap SHARE, so the top IP must be picked by cap explicitly —
  // the first row with a cap would be the busiest IP, labelled as the biggest.
  const topIp = data.ips.reduce<IPRow | null>(
    (best, r) =>
      Number.isFinite(r.mcapUsd) && r.mcapUsd > 0 && (best == null || r.mcapUsd > best.mcapUsd) ? r : best,
    null,
  );
  if (topIp && Number.isFinite(hero.totalMcapUsd) && hero.totalMcapUsd > 0) {
    const dom = (topIp.mcapUsd / hero.totalMcapUsd) * 100;
    items.push({
      label: topIp.name,
      value: `${dom.toFixed(1)}%`,
      href: `/ip/${topIp.key}`,
      title: `${topIp.name}'s share of total market cap`,
    });
  }

  // 5 — Holders. `holdersPct7d` is null until the backend fills it; the delta simply
  // doesn't render until then (never a fabricated 0).
  items.push({
    label: "Holders",
    value: formatCompactNumber(hero.holders),
    delta: hero.holdersPct7d,
    deltaWindow: "7d",
    href: "/ips",
    title: "Unique wallets holding a tracked collectible, deduped across platforms",
  });

  return items;
}

/**
 * Cached, total accessor for the context strip. 30 min / `platform-buckets`, matching
 * the page-level caches around it, so no page pays for it twice.
 *
 * NEVER THROWS: any failure returns `[]` and the NavBar renders without a strip. A
 * decorative tape must not be able to take a page down.
 */
export const buildMarketTicker: () => Promise<TickerItem[]> = unstable_cache(
  async () => {
    try {
      return await buildItems();
    } catch {
      return [];
    }
  },
  ["market-context-strip:v1"],
  { revalidate: 1800, tags: ["platform-buckets"] },
);
