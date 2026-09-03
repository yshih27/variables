/**
 * The navigation rail's data model — market → categories → IPs, plus platforms.
 *
 * Pure derivation of the homepage payload (one snapshot row), so the rail costs a
 * page render nothing beyond what it already pays. No new external reads.
 *
 * ⚠️ THE DELTA UNITS ARE THE TRAP HERE. The payload mixes them: `IPRow.pct7d`,
 * `PlatformRow.pct7d` and `hero.vol24Pct` are already PERCENT (-6.95 means
 * -6.95%), while `hero.mcapPct24h` is a FRACTION. `RailNode.deltaPct` is percent
 * throughout, so the one fraction is converted here and nowhere else. Getting this
 * backwards renders a -7% move as -0.07% — small enough to look plausible, which
 * is what makes it dangerous.
 */
import { unstable_cache } from "next/cache";
import { fetchHomepage } from "./fetchHomepage";
import { categoryOf, type IPCategory } from "./ipCatalog";
import { indexDisplayName } from "@/lib/indices/naming";
import type { HomepagePayload, RailModel, RailNode } from "@/lib/types";

/**
 * A spark array, or null.
 *
 * ⚠️ NULL IS NOT `[]` AND NOT `[0,0,0]`. A flat line at zero is a CLAIM — "we
 * measured, and there was no activity" — and it is the wrong claim for a series
 * we simply do not hold. An all-zero array is treated as absent for the same
 * reason: it is what an empty spine read degrades into, not a real quiet week.
 */
function spark(values: number[] | undefined | null): number[] | null {
  if (!Array.isArray(values) || values.length < 2) return null;
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return null;
  return clean.some((v) => v !== 0) ? clean : null;
}

/** Percent passthrough — null for a missing or non-finite delta, never 0. */
function pct(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

const CATEGORY_LABEL: Record<IPCategory, string> = { tcg: "TCG", sports: "Sports", other: "Other" };

export function buildRailModelFrom(home: HomepagePayload): RailModel {
  // ── Market ───────────────────────────────────────────────────────────────
  // The market node reports 24h VOLUME, matching the window its spark covers
  // (hero.volSpark is hourly volume over the last 24h). Pairing that spark with
  // the market-cap delta would put a 24h volume line under a market-cap number.
  const market: RailNode = {
    key: "market",
    name: indexDisplayName("market", "total"),
    href: "/ips",
    spark: spark(home.hero.volSpark),
    deltaPct: pct(home.hero.vol24Pct),
    deltaWindow: "24h",
  };

  // ── IPs, bucketed by category ────────────────────────────────────────────
  // Ordered by 24h volume within each category: the rail answers "what is moving",
  // and market cap ordering pins dormant IPs to the top (the same reason IPTable's
  // default sort moved to volume).
  const byCategory = new Map<IPCategory, RailNode[]>();
  for (const ip of [...home.ips].sort((a, b) => (b.vol24Usd || 0) - (a.vol24Usd || 0))) {
    const cat = categoryOf(ip.key);
    const node: RailNode = {
      key: ip.key,
      name: ip.name,
      href: `/ip/${ip.key}`,
      spark: spark(ip.spark),
      // IPRow carries no 24h delta — pct7d is the honest one it does carry, and
      // `deltaWindow` exists so the rail can SAY that rather than imply 24h.
      deltaPct: pct(ip.pct7d),
      deltaWindow: "7d",
    };
    const cur = byCategory.get(cat);
    if (cur) cur.push(node);
    else byCategory.set(cat, [node]);
  }

  // A category node has no series of its own in the payload — the spine records
  // per-IP, not per-category — so its spark is null rather than a synthesised sum.
  const categories = (["tcg", "sports", "other"] as IPCategory[])
    .filter((c) => (byCategory.get(c)?.length ?? 0) > 0)
    .map((c) => ({
      key: c,
      name: CATEGORY_LABEL[c],
      href: `/ips?cat=${c}`,
      spark: null,
      deltaPct: null,
      deltaWindow: "7d" as const,
      ips: byCategory.get(c) ?? [],
    }));

  // ── Platforms, in payload rank order ─────────────────────────────────────
  // `rank` is already the payload's own ordering (total 24h activity), so the
  // rail agrees with the platform table instead of proposing a second opinion.
  const platforms: RailNode[] = [...home.platforms]
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map((p) => ({
      key: p.key,
      name: p.name,
      href: `/platform/${p.key}`,
      spark: spark(p.spark),
      deltaPct: pct(p.pct7d),
      deltaWindow: "7d" as const,
    }));

  return { market, categories, platforms, generatedAt: new Date().toISOString() };
}

export async function buildRailModel(): Promise<RailModel> {
  return buildRailModelFrom(await fetchHomepage());
}

/** Cached 30 min on `platform-buckets`, so a warm sweeps the rail with the page. */
export const getRailModel = unstable_cache(buildRailModel, ["shell-rail:v1"], {
  revalidate: 1800,
  tags: ["platform-buckets"],
});
