import { unstable_cache } from "next/cache";
import type { IPRow, PlatformRow, RailModel, RailNode } from "@/lib/types";
import { GACHA_ENABLED } from "@/lib/flags";
import { tickerOf } from "@/lib/indices/naming";
import { categoryOf, type IPCategory } from "./ipCatalog";
import { fetchHomepage } from "./fetchHomepage";

/**
 * The left rail's taxonomy + its live micro-sparks (SHELL_V2 S1).
 *
 * ZERO new reads: everything comes off the precomputed `homepage-payload`
 * snapshot that `fetchHomepage()` already serves — the same one row the market
 * strip reads. The taxonomy itself is derived from the SSOTs, never hand-listed:
 * categories from `categoryOf` over the IP catalog, platforms from the payload
 * (which is built from PLATFORM_SOURCES), so adding an IP or a platform upstream
 * grows the rail with no edit here.
 *
 * Ordering is the payload's, not ours: IPs by 24h volume within their category,
 * platforms by the payload's rank (total 24h activity).
 */

/** Category display names + rail order. Keyed by IPCategory so adding a category
 *  to the catalog is a compile error here until it is named. */
const CATEGORY_NAME: Record<IPCategory, string> = {
  tcg: "TCG",
  sports: "Sports",
  other: "Other",
};
const CATEGORY_ORDER: IPCategory[] = ["tcg", "sports", "other"];

/** A spark we actually have, or null. An empty/all-zero series is NOT a spark:
 *  drawing it would assert "flat", which is a different claim from "unknown". */
function sparkOf(values: number[] | undefined): number[] | null {
  if (!values?.length) return null;
  if (!values.some((v) => Number.isFinite(v) && v !== 0)) return null;
  return values;
}

/** Element-wise Σ of same-length hourly spark arrays. The homepage builds every
 *  IPRow.spark in one pass over the same 24 hourly buckets, so summing them IS
 *  the category's hourly volume — not an interpolation. Shorter arrays are
 *  right-aligned to the longest (they share the newest bucket). */
function sumSparks(sparks: number[][]): number[] | null {
  const usable = sparks.filter((s) => s.length > 0);
  if (!usable.length) return null;
  const n = Math.max(...usable.map((s) => s.length));
  const out = new Array<number>(n).fill(0);
  for (const s of usable) {
    const offset = n - s.length;
    for (let i = 0; i < s.length; i++) {
      const v = s[i];
      if (Number.isFinite(v)) out[offset + i] += v;
    }
  }
  return sparkOf(out);
}

/** Icon-rail code from the naming SSOT — "V-PKM" → "PKM". Never hand-listed, so
 *  a catalog rename moves the rail with it. */
function shortOf(entity: "market" | "category" | "ip", key: string): string {
  return tickerOf(entity, key).replace(/^V-/, "");
}

function pct(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

function ipNode(r: IPRow): RailNode {
  return {
    key: r.key,
    name: r.name,
    short: shortOf("ip", r.key),
    href: `/ip/${r.key}`,
    spark: sparkOf(r.spark),
    // Market-cap 1d from the spine. Already a PERCENT (unlike hero.mcapPct24h).
    deltaPct: pct(r.pct1d),
    deltaWindow: "24h",
    deltaLabel: "market cap",
  };
}

function platformNode(r: PlatformRow): RailNode {
  return {
    key: r.key,
    name: r.name,
    short: r.short,
    href: `/platform/${r.key}`,
    spark: sparkOf(r.spark),
    // ⚠️ 7d, not 24h — PlatformRow carries no 24h volume delta, and `deltaWindow`
    // exists precisely so this can be stated rather than rounded off to "24h".
    deltaPct: pct(r.pct7d),
    deltaWindow: "7d",
    deltaLabel: "volume",
  };
}

async function build(): Promise<RailModel> {
  const data = await fetchHomepage();

  // IPs by 24h volume desc — the payload's `ips` is mcap-ranked, so re-sort here
  // rather than inheriting an order the rail doesn't want.
  const ipsByVolume = [...data.ips].sort((a, b) => {
    const av = Number.isFinite(a.vol24Usd) ? a.vol24Usd : -Infinity;
    const bv = Number.isFinite(b.vol24Usd) ? b.vol24Usd : -Infinity;
    return bv - av;
  });

  const byCategory = new Map<IPCategory, IPRow[]>();
  for (const r of ipsByVolume) {
    const c = categoryOf(r.key);
    const list = byCategory.get(c);
    if (list) list.push(r);
    else byCategory.set(c, [r]);
  }

  const categories = CATEGORY_ORDER.filter((c) => (byCategory.get(c)?.length ?? 0) > 0).map((c) => {
    const rows = byCategory.get(c)!;
    return {
      key: c,
      name: CATEGORY_NAME[c],
      short: shortOf("category", c),
      href: "/ips",
      spark: sumSparks(rows.map((r) => r.spark ?? [])),
      // No per-category 24h delta exists in the payload, and a cap-weighted mean
      // of the members' mcap moves would be a number we invented. "—" is the
      // honest cell; the members below carry their own.
      deltaPct: null,
      deltaWindow: "24h" as const,
      ips: rows.map(ipNode),
    };
  });

  return {
    market: {
      key: "market",
      name: "Market",
      short: shortOf("market", "total"),
      href: "/",
      spark: sparkOf(data.hero.volSpark),
      // ⚠️ hero.mcapPct24h is a FRACTION (0.012 = +1.2%) while every other delta
      // on the payload is already a percent. ×100 here is the conversion.
      deltaPct: data.hero.mcapPct24h == null ? null : data.hero.mcapPct24h * 100,
      deltaWindow: "24h",
      deltaLabel: "market cap",
    },
    categories,
    platforms: data.platforms.map(platformNode),
    generatedAt: data.hero.updatedAt,
  };
}

/** Empty model — what a failed read degrades to. The rail then renders its static
 *  links with no sparks rather than taking the whole shell down. */
const EMPTY: RailModel = {
  market: { key: "market", name: "Market", href: "/", spark: null, deltaPct: null, deltaWindow: "24h" },
  categories: [],
  platforms: [],
  generatedAt: "",
};

/**
 * Cached, total accessor. 30 min / `platform-buckets`, matching the page-level
 * caches around it, so mounting the shell in the layout costs one snapshot read
 * per window rather than one per page.
 *
 * NEVER THROWS — the shell is chrome on every route; it must not be able to take
 * a page down.
 */
export const buildRailModel: () => Promise<RailModel> = unstable_cache(
  async () => {
    try {
      return await build();
    } catch {
      return EMPTY;
    }
  },
  ["shell-rail-model:v1"],
  { revalidate: 1800, tags: ["platform-buckets"] },
);

/** Whether the rail should offer the Gacha node. Kept here so the component
 *  doesn't import the flag directly and the rule stays with the model. */
export const RAIL_SHOWS_GACHA = GACHA_ENABLED;
