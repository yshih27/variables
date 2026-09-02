/**
 * CardOS catalog + pricing — typed responses and a BUDGETED walker.
 *
 * ⚠️ SCOPE, because the name misleads: this is rip.fun's *card-data product*,
 * not rip.fun's marketplace. The catalog is every printing of every Pokémon /
 * One Piece card CardOS indexes (37,198 and 5,757 in English as of 2026-09-02),
 * and `pricing` is CardOS's own valuation blended from third-party sold comps —
 * `tcgplayer_id` rides along on the row. Nothing here says whether rip.fun holds,
 * tokenizes, lists or has ever sold a given card: no ownership field, no
 * inventory flag, no token id, and no listing route exists on this API. Treat
 * these rows as REFERENCE PRICES, never as platform inventory. See
 * docs/roadmap/ripfun-phase1-findings.md for the evidence and what it rules out.
 *
 * Grades: CardOS returns them STRUCTURED (`graded[].company` + `.grade`), not
 * inline in the card name the way our on-chain feeds do. `gradedLabel` below
 * still routes through src/lib/card/grade.ts so the BECKETT→BGS fold and the
 * 1–10 sanity range stay in the one parser rather than being re-implemented on
 * a shape that happens to arrive pre-split.
 */
import { parseGradeLabel, type ParsedGrade } from "@/lib/card/grade";
import {
  ripFunGet,
  RIPFUN_MAX_OFFSET,
  RIPFUN_PAGE_SIZE,
  type RipFunObject,
  type RipFunPage,
} from "./client";

/** Games sharing the same routes and response shapes. */
export type RipFunGame = "pokemon" | "onepiece" | "azuki";

/**
 * Games worth reading. `azuki` is on the same routes but the docs state it has
 * no market prices, so a pricing walk over it spends credits for nulls.
 */
export const RIPFUN_PRICED_GAMES: RipFunGame[] = ["pokemon", "onepiece"];

export type RipFunImage = { type: string; small?: string; medium?: string; large?: string };

export type RipFunExpansion = {
  id: string;
  name: string;
  /** Cards in the set including secret rares. */
  total: number;
  /** Number printed on the cards ("165" of 207). */
  printed_total?: number;
  language?: string;
  language_code?: string;
  series?: string;
  code?: string;
  /** "2023/09/22" — CardOS's own slashed format, not ISO. */
  release_date?: string;
  logo?: string;
  symbol?: string;
};

/** A per-condition raw price rung: NM / LP / MP / HP / DMG. */
export type RipFunCondition = {
  condition: string;
  price?: number | null;
  low?: number | null;
  high?: number | null;
  sold_count?: number | null;
};

/**
 * One company+grade valuation. `value_kind` says what it is built on: "sold"
 * (recent comps), "blended" (feed + a few comps) or "feed" (estimate only) —
 * load-bearing, because a "feed" value is an ESTIMATE and must never be
 * published as a realized price. `band` and `last_sold_at` only come back from
 * the dedicated /prices route, not from `include=prices`.
 */
export type RipFunGraded = {
  company: string;
  grade: string;
  value?: number | null;
  low?: number | null;
  high?: number | null;
  confidence?: "high" | "med" | "low" | null;
  value_kind?: "sold" | "blended" | "feed" | null;
  /** Recent (≤90d) sold comps behind the value. 0 ⇒ nothing sold, estimate only. */
  sold_count?: number | null;
  last_sold_at?: string | null;
  band?: {
    median?: number | null;
    recent_median?: number | null;
    p10?: number | null;
    p90?: number | null;
    count?: number | null;
  } | null;
  trend?: RipFunTrend | null;
};

export type RipFunTrend = { direction?: "up" | "down" | "flat" | null; percent?: number | null };

export type RipFunPricing = {
  /** Always "USD" today; asserted rather than assumed by `usdPrice` below. */
  currency?: string | null;
  /** Ungraded market price, or null when CardOS has none. */
  market?: number | null;
  market_updated_at?: string | null;
  /** True when the sales window behind `market` is thin — treat as indicative. */
  is_stale?: boolean | null;
  trend_7d?: RipFunTrend | null;
  trend_30d?: RipFunTrend | null;
  trend_90d?: RipFunTrend | null;
  conditions?: RipFunCondition[] | null;
  graded?: RipFunGraded[] | null;
};

export type RipFunCard = {
  /** One printing, e.g. "sv3pt5-6". NOT an on-chain token id. */
  id: string;
  name: string;
  number?: string;
  printed_number?: string;
  images?: RipFunImage[];
  expansion?: RipFunExpansion;
  language?: string;
  language_code?: string;
  tcgplayer_id?: string | null;
  variants?: { name: string; images?: RipFunImage[] }[];
  supertype?: string;
  subtypes?: string[];
  types?: string[];
  rarity?: string | null;
  artist?: string | null;
  /** Present only with `include=prices` or on the /prices route. */
  pricing?: RipFunPricing | null;
};

export type RipFunCardPrices = { card_id: string; pricing: RipFunPricing };

/**
 * A sealed product (booster box, ETB, case). Same envelope and the same 1-credit
 * cost as cards; carried because a full catalog budget has to price it.
 */
export type RipFunSealed = {
  id: string;
  name: string;
  expansion?: RipFunExpansion;
  language?: string;
  language_code?: string;
  images?: RipFunImage[];
  pricing?: RipFunPricing | null;
};

// ── Reads ─────────────────────────────────────────────────────────────────

/** One page of a game's expansion index. 1 credit. */
export function fetchExpansionsPage(
  game: RipFunGame,
  opts: { page?: number; pageSize?: number; q?: string; orderBy?: string } = {},
): Promise<RipFunPage<RipFunExpansion>> {
  return ripFunGet<RipFunPage<RipFunExpansion>>(`/${game}/expansions`, {
    page: opts.page ?? 1,
    page_size: opts.pageSize ?? RIPFUN_PAGE_SIZE,
    q: opts.q,
    orderBy: opts.orderBy,
  });
}

/**
 * One page of cards. `include: "prices"` carries no credit surcharge, so a walk
 * that will want prices should always ask for them on the way past rather than
 * paying a second credit per card later.
 */
export function fetchCardsPage(
  game: RipFunGame,
  opts: {
    page?: number;
    pageSize?: number;
    q?: string;
    orderBy?: string;
    includePrices?: boolean;
    language?: string;
  } = {},
): Promise<RipFunPage<RipFunCard>> {
  return ripFunGet<RipFunPage<RipFunCard>>(`/${game}/cards`, {
    page: opts.page ?? 1,
    page_size: opts.pageSize ?? RIPFUN_PAGE_SIZE,
    q: opts.q,
    orderBy: opts.orderBy,
    include: opts.includePrices ? "prices" : undefined,
    language: opts.language,
  });
}

/** One page of a game's sealed products. 1 credit. */
export function fetchSealedPage(
  game: RipFunGame,
  opts: { page?: number; pageSize?: number; q?: string; includePrices?: boolean } = {},
): Promise<RipFunPage<RipFunSealed>> {
  return ripFunGet<RipFunPage<RipFunSealed>>(`/${game}/sealed`, {
    page: opts.page ?? 1,
    page_size: opts.pageSize ?? RIPFUN_PAGE_SIZE,
    q: opts.q,
    include: opts.includePrices ? "prices" : undefined,
  });
}

/** The full pricing payload for one card — adds `band` + `last_sold_at`. 1 credit. */
export async function fetchCardPrices(game: RipFunGame, cardId: string): Promise<RipFunCardPrices> {
  const res = await ripFunGet<RipFunObject<RipFunCardPrices>>(
    `/${game}/cards/${encodeURIComponent(cardId)}/prices`,
  );
  return res.data;
}

// ── Walking ───────────────────────────────────────────────────────────────

export type WalkResult<T> = {
  rows: T[];
  /** `total_count` the server reported for the query. */
  total: number;
  pages: number;
  /** True when we stopped on `maxPages`/the offset wall rather than exhausting the query. */
  truncated: boolean;
};

/**
 * Page a card query to completion (or to `maxPages`, whichever comes first).
 *
 * ⚠️ `maxPages` is a CREDIT BOUND, not a sample size, and `truncated` is how the
 * caller finds out it bit. A partial catalog is fine — the catalog is reference
 * data and the next run continues — but a partial page set that a caller treats
 * as complete is how a wrong aggregate gets published, so the flag is returned
 * rather than logged and forgotten.
 *
 * The server also refuses `page × page_size` past 10,000. That wall is asserted
 * up front instead of walked into: discovering it at page 101 means 100 credits
 * already spent on a walk that cannot finish. Narrow with `q` (per expansion) or
 * sort by id and cursor on the last id, per the docs' own guidance.
 */
export async function walkCards(
  game: RipFunGame,
  opts: {
    q?: string;
    orderBy?: string;
    includePrices?: boolean;
    language?: string;
    maxPages: number;
    pageSize?: number;
    log?: (msg: string) => void;
  },
): Promise<WalkResult<RipFunCard>> {
  const pageSize = opts.pageSize ?? RIPFUN_PAGE_SIZE;
  const log = opts.log ?? (() => {});
  const pageCeiling = Math.floor(RIPFUN_MAX_OFFSET / pageSize);
  if (opts.maxPages > pageCeiling) {
    throw new Error(
      `[ripfun] walkCards asked for ${opts.maxPages} pages × ${pageSize}, past the server's ` +
        `page × page_size ≤ ${RIPFUN_MAX_OFFSET} wall (max ${pageCeiling} pages). ` +
        `Narrow with q (e.g. expansion.id:sv3pt5) or cursor on the last id.`,
    );
  }

  const rows: RipFunCard[] = [];
  let total = 0;
  let pages = 0;
  for (let page = 1; page <= opts.maxPages; page++) {
    const res = await fetchCardsPage(game, { ...opts, page, pageSize });
    pages = page;
    total = res.total_count ?? 0;
    const batch = res.data ?? [];
    rows.push(...batch);
    log(`  ${game} p${page} · ${batch.length} rows · ${rows.length}/${total}`);
    // Stop on the server's own count, not on an empty page — the docs are
    // explicit that `total_count` is the termination signal.
    if (!batch.length || rows.length >= total) break;
  }
  return { rows, total, pages, truncated: rows.length < total };
}

// ── Derivations ───────────────────────────────────────────────────────────

/** CardOS quotes USD today and says so on the payload. Anything else is not
 *  silently treated as dollars — the same rule as DYLI's non-USD listing skip. */
export function usdPrice(pricing: RipFunPricing | null | undefined, value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const cur = (pricing?.currency ?? "USD").trim().toUpperCase();
  return cur === "USD" ? value : null;
}

/**
 * `{company:"PSA", grade:"10"}` → the site's canonical ParsedGrade, via the ONE
 * parser. Returns null for a grade outside 1–10 or a company that doesn't parse,
 * so an unrecognised grading body surfaces as no chip rather than a made-up one.
 */
export function gradedLabel(g: RipFunGraded): ParsedGrade | null {
  return parseGradeLabel(`${g.company ?? ""} ${g.grade ?? ""}`.trim());
}

/**
 * The graded valuations that are actually backed by sales. `value_kind: "feed"`
 * is CardOS's own estimate with `sold_count: 0` behind it — real data, but a
 * model output, and publishing it beside our realized on-chain prices would put
 * an estimate and a settled trade in the same column.
 */
export function soldBackedGrades(pricing: RipFunPricing | null | undefined): RipFunGraded[] {
  return (pricing?.graded ?? []).filter((g) => (g.sold_count ?? 0) > 0 && g.value_kind !== "feed");
}
