/**
 * Lightweight search index built on-demand from the homepage payload +
 * static catalogs. Returns categorized matches for /search.
 *
 * v1 covers: IPs, platforms, top-traded card names (from the homepage's
 * topSales feed). Set + grade + per-card-detail search will require a
 * pre-built card index — that's the next step.
 */
import type { HomepagePayload } from "@/lib/types";
import { IP_CATALOG, OTHER_IP } from "./ipCatalog";
import { PLATFORM_SOURCES } from "./sources";

export type SearchResult = {
  kind: "ip" | "platform" | "card";
  /** Display label */
  label: string;
  /** Optional sub-label (e.g. "on Beezie · $1,200" for a card) */
  sub?: string;
  href: string;
  /** 0-1 score (higher = better). Used to rank within a category. */
  score: number;
};

export type GroupedResults = {
  query: string;
  total: number;
  ips: SearchResult[];
  platforms: SearchResult[];
  cards: SearchResult[];
};

/**
 * Score a match: starts-with > word-start > contains.
 * Returns 0 for no match.
 */
function scoreMatch(haystack: string, q: string): number {
  const h = haystack.toLowerCase();
  const needle = q.toLowerCase();
  if (h === needle) return 1.0;
  if (h.startsWith(needle)) return 0.85;
  const wordStart = new RegExp(`\\b${escapeRegExp(needle)}`);
  if (wordStart.test(h)) return 0.65;
  if (h.includes(needle)) return 0.4;
  return 0;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildSearch(home: HomepagePayload, rawQuery: string): GroupedResults {
  const query = rawQuery.trim();
  if (query.length === 0) {
    return { query, total: 0, ips: [], platforms: [], cards: [] };
  }

  // ─── IPs (catalog + Other) ────────────────────────────────
  const ipPool = [...IP_CATALOG, OTHER_IP];
  const ips: SearchResult[] = [];
  for (const ip of ipPool) {
    const score = Math.max(
      scoreMatch(ip.name, query),
      scoreMatch(ip.key, query) * 0.8,
      scoreMatch(ip.short, query) * 0.75,
      ...ip.patterns.map((p) => scoreMatch(p, query) * 0.6),
    );
    if (score > 0) {
      const row = home.ips.find((r) => r.key === ip.key);
      const sub = row
        ? `${row.cards} cards · ${row.holders} holders`
        : "no 24h activity";
      ips.push({
        kind: "ip",
        label: ip.name,
        sub,
        href: `/ip/${ip.key}`,
        score,
      });
    }
  }
  ips.sort((a, b) => b.score - a.score);

  // ─── Platforms ───────────────────────────────────────────
  const platforms: SearchResult[] = [];
  for (const p of PLATFORM_SOURCES) {
    const score = Math.max(
      scoreMatch(p.name, query),
      scoreMatch(p.key, query) * 0.8,
      scoreMatch(p.short, query) * 0.7,
    );
    if (score > 0) {
      const row = home.platforms.find((r) => r.key === p.key);
      const sub = row
        ? `${row.chain} · ${row.cards} cards 24h`
        : p.chain;
      platforms.push({
        kind: "platform",
        label: p.name,
        sub,
        href: `/platform/${p.key}`,
        score,
      });
    }
  }
  platforms.sort((a, b) => b.score - a.score);

  // ─── Cards (from topSales feed) ──────────────────────────
  // Cheap MVP — only searches the 5 cards we already have in the
  // homepage payload. Real card search will need an index of every
  // tracked card (~125K).
  const cards: SearchResult[] = [];
  for (const sale of home.topSales) {
    const score = scoreMatch(sale.cardName, query);
    if (score > 0) {
      cards.push({
        kind: "card",
        label: sale.cardName,
        sub: `${sale.ipName} · sold $${sale.priceUsd.toFixed(0)}`,
        href: `/ip/${sale.ipKey}`,
        score,
      });
    }
  }
  // Also surface top cards across all IPs from the home table
  for (const ip of home.ips) {
    if (!ip.topCard) continue;
    const score = scoreMatch(ip.topCard, query);
    if (score > 0) {
      cards.push({
        kind: "card",
        label: ip.topCard,
        sub: `top card in ${ip.name}`,
        href: `/ip/${ip.key}/cards`,
        score: score * 0.9,
      });
    }
  }
  // Dedupe by label
  const seen = new Set<string>();
  const dedupedCards = cards
    .sort((a, b) => b.score - a.score)
    .filter((c) => {
      const key = c.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);

  return {
    query,
    total: ips.length + platforms.length + dedupedCards.length,
    ips,
    platforms,
    cards: dedupedCards,
  };
}
