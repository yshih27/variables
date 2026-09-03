/**
 * The command palette's search — the existing indexes, grouped.
 *
 * ⚠️ THIS ADDS NO NEW SEARCH LOGIC. It composes three things that already exist
 * and are already used by /search:
 *   • `buildSearch(homepage, q)`   — IPs, platforms, and the payload's top cards
 *   • `searchCardsByName(q, 8)`    — the full ~137K-row cards table
 *   • the studio seed's item list  — metric names, metadata only
 * /search keeps calling the first two directly and is untouched. Anything that
 * changes how a match is scored belongs in searchIndex.ts, not here, or the page
 * and the palette start disagreeing about what "matches".
 *
 * The `metrics` group is the only genuinely new index, and it is free: the studio
 * seed snapshot already carries every catalog item's name for the picker, so this
 * reads NO points and performs no chart work.
 */
import { fetchHomepage } from "./fetchHomepage";
import { buildSearch, cardHitToResult, type SearchResult } from "./searchIndex";
import { searchCardsByName } from "./cards";
import { readStudioSeed } from "@/lib/studio/seed";
import type { GroupedSearchResponse, SearchGroup } from "@/lib/types";

/** Below this a query matches almost everything and ranks nothing. */
export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_CHARS = 64;
/** Per-group cap. The palette shows a few per section, not a leaderboard. */
const PER_GROUP = 8;

const EMPTY = (query: string): GroupedSearchResponse => ({ query, total: 0, groups: [] });

/** Same scoring ladder searchIndex uses, so metric hits rank alongside the rest. */
function scoreMatch(haystack: string, q: string): number {
  const h = haystack.toLowerCase();
  const n = q.toLowerCase();
  if (h === n) return 1;
  if (h.startsWith(n)) return 0.85;
  if (new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(h)) return 0.65;
  return h.includes(n) ? 0.4 : 0;
}

/**
 * Studio metrics whose ticker or name matches.
 *
 * The href deep-links the market studio straight to that metric: `#m=<id>` is the
 * studio's own hash contract and `sc=market` is the page tag it requires — a hash
 * without the matching tag is ignored by design (it is how a stale fragment from
 * another studio gets discarded), so omitting it would produce a link that
 * silently opens the default chart instead.
 */
async function metricGroup(q: string): Promise<SearchGroup | null> {
  const seed = await readStudioSeed().catch(() => null);
  const items = seed?.items ?? [];
  if (!items.length) return null;
  const hits = items
    .map((it) => ({
      label: it.name,
      sub: `${it.ticker} · ${it.group}`,
      href: `/ips#m=${encodeURIComponent(it.id)}&sc=market`,
      score: Math.max(scoreMatch(it.name, q), scoreMatch(it.ticker, q) * 0.9),
    }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, PER_GROUP);
  return hits.length ? { kind: "metric", label: "Metrics", items: hits } : null;
}

const toItems = (rs: SearchResult[]) =>
  rs.slice(0, PER_GROUP).map((r) => ({ label: r.label, sub: r.sub, href: r.href, score: r.score }));

export async function buildGroupedSearch(rawQuery: string): Promise<GroupedSearchResponse> {
  const query = (rawQuery ?? "").trim().slice(0, SEARCH_MAX_CHARS);
  if (query.length < SEARCH_MIN_CHARS) return EMPTY(query);

  // Every leg degrades to empty on its own. A palette that 500s because one index
  // hiccuped is worse than one that returns three groups instead of four.
  const [home, cardHits, metrics] = await Promise.all([
    fetchHomepage().catch(() => null),
    searchCardsByName(query, PER_GROUP).catch(() => []),
    metricGroup(query).catch(() => null),
  ]);
  const base = home ? buildSearch(home, query) : null;

  // Cards come from two places — the payload's top sales (via buildSearch) and
  // the full table — and they overlap. Dedupe on href so the same card is not
  // offered twice; the full-table hit wins because it carries set + grade.
  const fullTable = cardHits.map(cardHitToResult);
  const seenHref = new Set(fullTable.map((c) => c.href));
  const cards = [...fullTable, ...(base?.cards ?? []).filter((c) => !seenHref.has(c.href))].sort(
    (a, b) => b.score - a.score,
  );

  const groups: SearchGroup[] = [];
  const push = (kind: SearchGroup["kind"], label: string, rs: SearchResult[]) => {
    if (rs.length) groups.push({ kind, label, items: toItems(rs) });
  };
  push("ip", "IPs", base?.ips ?? []);
  push("platform", "Platforms", base?.platforms ?? []);
  push("card", "Cards", cards);
  if (metrics) groups.push(metrics);

  return { query, total: groups.reduce((s, g) => s + g.items.length, 0), groups };
}
