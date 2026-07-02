/**
 * Trending cards (B3) — rank cards by trade velocity + scarcity ("trades < hunters").
 * The homepage/card discovery surface.
 *
 * DATA SOURCE: the spec assumed `entity_type:"card"` in the metric spine, but per-card
 * recording was deferred (series G) — the spine has no card rows. So we derive trending
 * from row-level SALES feeds that each reach back ≥2×window → REAL momentum (current
 * window vs the prior window) for every platform (R4-2):
 *   • Collector Crypt — 30d Dune secondary-sales feed (cached, fetchCCSecondarySales).
 *   • Beezie — 30d api.beezie.com/activity, cached by warm-secondary-sales (readSecondarySales).
 *   • Phygitals is absent — its /sales feed is 100% gacha (CLAW/BUY, no P2P sales); its
 *     real secondary trades live on Tensor/ME and need a Dune query (see secondarySalesCache).
 *
 * GROUPING: by card-TYPE (name × set × grade × IP × platform), not tokenId. The tracked
 * platforms hold 1-of-1 slabs, so a single tokenId trades ~once and has ≤1 listing —
 * "velocity" and huntPressure only mean something aggregated across copies of the same
 * physical card. Float = how many copies of the type are currently listed.
 *   momentum      = trades − tradesPrev   (null where there's no prior window)
 *   huntPressure  = trades / max(activeListings, 1)   — lots sold, thin float = hot
 *
 * PERF: one cached (unstable_cache, 30m) aggregation. Bounded reads — metadata only for
 * the windowed-traded tokens, and float only for the top candidate types. Runs in the
 * background (homepage is ISR), never per request.
 *
 * SLICE-AWARE: `opts.slice` filters to trending WITHIN an IP / platform / grade, so once
 * the slice engine lands "Pokémon trending" / "PSA-10 trending" is a free panel.
 */
import { unstable_cache } from "next/cache";
import { db } from "../db/client";
import { readListings } from "./listings";
import { fetchCCSecondarySales } from "./warmers/core";
import { readSecondarySales } from "./secondarySalesCache";
import { readCardMeta, type CardMeta } from "./cards";
import { buyLinks, type BuyLink } from "../links/buyLinks";
import { cardHref, cardSupported } from "../card/ids";
import type { Chain } from "../types";

export type TrendingCard = {
  cardId: string;
  href: string;
  name: string;
  ip: string;
  set: string | null;
  grade: string;
  /** "slab" = a graded single card; "sealed" = a sealed product (booster/box/ETB/…).
   *  Lets the frontend tab-split All | Slabs | Sealed (R4-2). */
  kind: "slab" | "sealed";
  platform: string;
  trades: number;
  tradesPrev: number | null;
  momentum: number | null; // trades − tradesPrev; null where there's no prior window
  activeListings: number;
  huntPressure: number; // trades / max(activeListings, 1)
  /** Realized volume in the current window — the visible tiebreak when trade
   *  counts tie (X6: thin 24h windows produce whole tables of "2 trades"). */
  volumeUsd: number;
  topPriceUsd: number;
  buyLinks: BuyLink[];
};

export type TrendingResult = {
  rows: TrendingCard[];
  /** When the listings snapshot behind `activeListings` was taken (X6: the
   *  float can lag the trades; the panel says so instead of implying live). */
  floatAsOf: string | null;
};

export type TrendingOpts = {
  window?: "24h" | "7d";
  limit?: number;
  /** Default "huntPressure" (scarcity); "momentum" ranks by velocity change (CC only). */
  sort?: "huntPressure" | "momentum";
  /** Filter to trending WITHIN a slice — none = the global list. */
  slice?: { ip?: string; platform?: string; grade?: string };
};

const DAY = 86_400_000;
const CHAIN_BY_PLATFORM: Record<string, Chain> = {
  "collector-crypt": "Solana",
  beezie: "Base",
  phygitals: "Solana",
  courtyard: "Polygon",
};

/** name × set × grade × IP, per platform — one physical card identity. */
function typeKey(platform: string, ip: string, set: string | null, grade: string, name: string): string {
  return `${platform}|${ip}|${set ?? ""}|${grade}|${name}`;
}
function nameOf(m: CardMeta | undefined, tokenId: string): string {
  return (m?.cardName || m?.name || `Card ${tokenId.slice(0, 6)}`).trim();
}

// Sealed-product name heuristic (R4-2 + R5). A card is "sealed" only when it's
// UNGRADED (no PSA/CGC/BGS number) AND its name reads like a sealed product;
// anything graded is a "slab" (a single card). \b word-boundaries avoid matching
// e.g. "Boxer". Two signals:
//   • prefix — Pokémon sealed products list as "Pokemon TCG: …" (R5).
//   • keywords — product-type words. Added R5: upc / ultra premium / premium
//     collection / display / collection box (tin + collection already matched).
const SEALED_PREFIX_RE = /^\s*pokemon tcg:/i;
const SEALED_RE =
  /\b(booster|bundle|box|etb|elite trainer|pack|case|lot|tin|blister|collection|upc|ultra premium|premium collection|display|collection box)\b/i;
function classifyKind(name: string, grade: string): "slab" | "sealed" {
  const graded = !!grade && grade !== "Ungraded";
  if (graded) return "slab";
  if (SEALED_PREFIX_RE.test(name)) return "sealed";
  return SEALED_RE.test(name) ? "sealed" : "slab";
}

type Group = {
  platform: string;
  key: string;
  name: string;
  ip: string;
  set: string | null;
  grade: string;
  kind: "slab" | "sealed";
  trades: number;
  tradesPrev: number | null;
  volumeUsd: number;
  topPriceUsd: number;
  repToken: string;
};

async function buildTrending(opts: TrendingOpts): Promise<TrendingResult> {
  const window = opts.window ?? "24h";
  const limit = opts.limit ?? 12;
  const w = window === "7d" ? 7 * DAY : DAY;
  const { slice } = opts;

  const [listings, ccSales, beezieSales] = await Promise.all([
    readListings().catch(() => null),
    fetchCCSecondarySales({ cachedOnly: true }).catch(() => []),
    readSecondarySales("beezie"),
  ]);

  const groups = new Map<string, Group>();

  // Row-level feeds that reach back ≥2×window, so BOTH the current and prior windows
  // are real → momentum for EVERY platform here (no longer CC-only, R4-2):
  //   • collector-crypt — 30d Dune secondary sales (fetchCCSecondarySales).
  //   • beezie — 30d api.beezie.com/activity, cached by warm-secondary-sales.
  // Phygitals is intentionally absent: its /sales feed is 100% gacha (no P2P), pending
  // a Tensor/ME Dune query (see secondarySalesCache.ts).
  const feeds: { platform: "collector-crypt" | "beezie"; sales: typeof ccSales }[] = [
    { platform: "collector-crypt", sales: ccSales },
    { platform: "beezie", sales: beezieSales },
  ];

  for (const { platform, sales } of feeds) {
    if (!cardSupported(platform)) continue;
    if (slice?.platform && slice.platform !== platform) continue;
    if (!sales.length) continue;
    // Anchor the windows to THIS feed's newest sale — feeds lag independently and a
    // cached snapshot can trail wall-clock (same rationale as spark24h).
    let end = -Infinity;
    for (const s of sales) {
      const t = Date.parse(s.date);
      if (Number.isFinite(t) && t > end) end = t;
    }
    if (!Number.isFinite(end)) continue;
    const curFrom = end - w;
    const prevFrom = end - 2 * w;
    const windowed = sales.filter((s) => {
      const t = Date.parse(s.date);
      return Number.isFinite(t) && t >= prevFrom && t <= end;
    });
    const meta = await readCardMeta(platform, [...new Set(windowed.map((s) => s.tokenId))]);
    for (const s of windowed) {
      const t = Date.parse(s.date);
      const m = meta.get(s.tokenId);
      const ip = m?.ip ?? "other";
      const grade = m?.grade ?? "Ungraded";
      if (slice?.ip && slice.ip !== ip) continue;
      if (slice?.grade && slice.grade !== grade) continue;
      const name = nameOf(m, s.tokenId);
      const key = typeKey(platform, ip, m?.set ?? null, grade, name);
      let g = groups.get(key);
      if (!g) {
        g = { platform, key, name, ip, set: m?.set ?? null, grade, kind: classifyKind(name, grade), trades: 0, tradesPrev: 0, volumeUsd: 0, topPriceUsd: 0, repToken: s.tokenId };
        groups.set(key, g);
      }
      if (t >= curFrom) {
        g.trades += 1;
        g.volumeUsd += s.priceUsd;
        if (s.priceUsd > g.topPriceUsd) { g.topPriceUsd = s.priceUsd; g.repToken = s.tokenId; }
      } else {
        g.tradesPrev = (g.tradesPrev ?? 0) + 1;
      }
    }
  }

  if (groups.size === 0) return { rows: [], floatAsOf: listings?.generatedAt ?? null };

  // ── Float (active listings per type) — bounded to the strongest candidates so it's
  //    a couple of cards queries, not a scan of every listed token. ──
  const listedByPlatform = new Map<string, Set<string>>();
  for (const it of Object.values(listings?.byItem ?? {})) {
    const tid = it.itemId.includes(":") ? it.itemId.slice(it.itemId.lastIndexOf(":") + 1) : it.itemId;
    if (tid) (listedByPlatform.get(it.platform) ?? listedByPlatform.set(it.platform, new Set()).get(it.platform)!).add(tid);
  }
  const candidates = [...groups.values()]
    .sort((a, b) => b.trades - a.trades || b.volumeUsd - a.volumeUsd || b.topPriceUsd - a.topPriceUsd)
    .slice(0, Math.max(limit * 3, 40));
  const candNames = [...new Set(candidates.map((g) => g.name))];
  const float = new Map<string, number>();
  for (let i = 0; i < candNames.length; i += 100) {
    const { data, error } = await db()
      .from("cards")
      .select("platform,token_id,card_name,name,ip_key,set_name,grade_label")
      .in("card_name", candNames.slice(i, i + 100));
    if (error) continue;
    for (const r of data ?? []) {
      const rr = r as { platform: string; token_id: string; card_name: string | null; name: string | null; ip_key: string; set_name: string | null; grade_label: string | null };
      const nm = (rr.card_name || rr.name || "").trim();
      const key = typeKey(rr.platform, rr.ip_key || "other", rr.set_name, rr.grade_label || "Ungraded", nm);
      if (!groups.has(key)) continue;
      if (listedByPlatform.get(rr.platform)?.has(rr.token_id)) float.set(key, (float.get(key) ?? 0) + 1);
    }
  }

  // ── Shape + rank ──
  const rows: TrendingCard[] = candidates.map((g) => {
    const activeListings = float.get(g.key) ?? 0;
    const chain = CHAIN_BY_PLATFORM[g.platform] ?? "Solana";
    return {
      cardId: `${g.platform}:${g.repToken}`,
      href: cardHref(g.platform, g.repToken),
      name: g.name,
      ip: g.ip,
      set: g.set,
      grade: g.grade,
      kind: g.kind,
      platform: g.platform,
      trades: g.trades,
      tradesPrev: g.tradesPrev,
      momentum: g.tradesPrev == null ? null : g.trades - g.tradesPrev,
      activeListings,
      huntPressure: g.trades / Math.max(activeListings, 1),
      volumeUsd: g.volumeUsd,
      topPriceUsd: g.topPriceUsd,
      buyLinks: buyLinks({ platform: g.platform, chain, tokenId: g.repToken }),
    };
  });

  const sort = opts.sort ?? "huntPressure";
  // Window volume is the deterministic (and now visible) tiebreak — thin windows
  // tie on trades/huntPressure constantly, and ranking must not read arbitrary (X6).
  rows.sort((a, b) =>
    sort === "momentum"
      ? (b.momentum ?? -Infinity) - (a.momentum ?? -Infinity) || b.trades - a.trades || b.volumeUsd - a.volumeUsd
      : b.huntPressure - a.huntPressure || b.volumeUsd - a.volumeUsd || b.trades - a.trades || b.topPriceUsd - a.topPriceUsd,
  );
  return { rows: rows.slice(0, limit), floatAsOf: listings?.generatedAt ?? null };
}

/**
 * Trending cards, cached per (window, limit, sort, slice). Default sort = huntPressure.
 * Cached 30m + tagged "homepage" so it refreshes with the rest of the homepage data.
 */
export function getTrendingCards(opts: TrendingOpts = {}): Promise<TrendingResult> {
  const norm = { window: opts.window ?? "24h", limit: opts.limit ?? 12, sort: opts.sort ?? "huntPressure", slice: opts.slice ?? null };
  return unstable_cache(
    () => buildTrending(opts),
    ["trending-cards:v3", JSON.stringify(norm)],
    { revalidate: 1800, tags: ["homepage", "platform-buckets"] },
  )();
}
