/**
 * The shared pass engine: choose expansions, walk them, match printings, and turn
 * a card page into stored comps. Both the mapping pass and the weekly refresh run
 * on this, so the two can never disagree about what a walk costs or what a match
 * means.
 */
import { fetchExpansionCardsPage, type RipFunCard, type RipFunGame } from "./catalog";
import { chargeMonthly } from "./meter";
import { foldCardName, type CardLang } from "./identity";
import { parseMoney } from "./oracle";
import type { MappedExpansion, PrintingMapping, StoredPrinting } from "./oracleStore";
import type { ExpansionIndex, ExpansionMatch } from "./expansions";
import { resolveExpansion, GAME_BY_IP } from "./expansions";
import type { TradedPrinting } from "./demand";
import { RIPFUN_PAGE_SIZE } from "./client";

/**
 * ⚠️ AN EXPANSION'S `total` IS THE PRINTED SET SIZE, NOT ITS CARD-ROW COUNT.
 * The `/expansions` index reports 207 for "151"; the `/expansions/{id}/cards`
 * route returns 371 rows for it, because CardOS models every art and finish
 * variant as its own card. Measured across the first mapping pass the ratio ran
 * ~1.6-1.8×, so planning off `total` under-declares by nearly half — which is
 * exactly how the second real run halted at credit 78 against a 77-credit plan
 * it had already reserved.
 *
 * 2.0 is deliberately above the observed ratio. A plan is an UPPER BOUND that a
 * budget gate reserves against; over-declaring costs a few expansions deferred to
 * the next run, while under-declaring costs a halt with the credits already gone.
 */
export const VARIANT_FACTOR = 2;

/** Pages a walk of `cards` rows will cost, at 1 credit each. */
export const pagesFor = (cards: number) => Math.max(1, Math.ceil(cards / RIPFUN_PAGE_SIZE));

/** Planning cost for an expansion whose index `total` is a printed-set size. */
export const plannedPagesFor = (total: number) => pagesFor(Math.ceil((total || 0) * VARIANT_FACTOR));

export type PlannedExpansion = MappedExpansion & {
  /** The traded printings that resolved here — the matcher's input. */
  members: TradedPrinting[];
};

export type Plan = {
  chosen: PlannedExpansion[];
  /** Credits the chosen set will cost if every page is walked. */
  credits: number;
  /** Resolved but left out because the budget ran first, biggest-demand first. */
  deferred: { expansionId: string; name: string; trades: number; pages: number }[];
  /** Already mapped recently and skipped — work a resumed run does not re-buy. */
  alreadyMapped: { expansionId: string; name: string; trades: number; pages: number }[];
  /** Our set strings that resolved to nothing, by 30d trades. */
  unresolvedSets: { setRaw: string; ip: string; lang: CardLang; trades: number }[];
  /** Printings whose IP has no CardOS game (sports, yugioh, …). */
  outOfScope: number;
};

/**
 * Choose which expansions to walk, GREEDILY BY OUR OWN DEMAND.
 *
 * ⚠️ THE ORDER IS THE BUDGET. Sorting by 30d trades and taking until the credits
 * run out means the credits buy the most-traded printings first; any other order
 * spends the same money on cards nobody here trades. `maxCredits` is a hard stop,
 * and what it excluded is RETURNED rather than dropped — a silent truncation
 * reads downstream as "these sets have no comps", which is a different and wrong
 * statement from "we have not bought them yet".
 */
export function planExpansions(
  printings: TradedPrinting[],
  indexes: Partial<Record<RipFunGame, ExpansionIndex>>,
  opts: {
    maxCredits: number;
    /**
     * Expansions already bought recently. RESUME IS THE DEFAULT because a halted
     * pass is the normal case, not the exception: the budget gate exists to stop
     * runs mid-way, and a resume that re-walks what it already stored spends the
     * whole month re-buying the same first ten sets and never reaches the tail.
     */
    skip?: (expansionId: string) => boolean;
  },
): Plan {
  type Bucket = {
    game: "pokemon" | "onepiece";
    match: ExpansionMatch;
    lang: CardLang;
    trades: number;
    setRaws: Set<string>;
    members: TradedPrinting[];
  };
  const buckets = new Map<string, Bucket>();
  const unresolved = new Map<string, { setRaw: string; ip: string; lang: CardLang; trades: number }>();
  let outOfScope = 0;

  for (const p of printings) {
    const game = GAME_BY_IP[p.ip] as "pokemon" | "onepiece" | undefined;
    const index = game ? indexes[game] : undefined;
    if (!game || !index) { outOfScope += p.trades; continue; }
    const match = resolveExpansion(index, p.setRaw, p.lang);
    // A cross-language hit is NOT used. CardOS prices each language printing
    // separately and they routinely differ by an order of magnitude, so pricing a
    // Japanese card off the English set is a wrong number, not an approximate one.
    if (!match || !match.langAgrees) {
      const k = `${p.ip}|${p.lang}|${p.setRaw ?? ""}`;
      const cur = unresolved.get(k) ?? { setRaw: p.setRaw ?? "", ip: p.ip, lang: p.lang, trades: 0 };
      cur.trades += p.trades;
      unresolved.set(k, cur);
      continue;
    }
    const key = `${game}:${match.expansion.id}`;
    const b = buckets.get(key) ?? {
      game, match, lang: p.lang, trades: 0, setRaws: new Set<string>(), members: [],
    };
    b.trades += p.trades;
    if (p.setRaw) b.setRaws.add(p.setRaw);
    b.members.push(p);
    buckets.set(key, b);
  }

  const ranked = [...buckets.values()].sort((a, b) => b.trades - a.trades);
  const chosen: PlannedExpansion[] = [];
  const deferred: Plan["deferred"] = [];
  const skipped: Plan["deferred"] = [];
  let credits = 0;
  for (const b of ranked) {
    if (opts.skip?.(b.match.expansion.id)) {
      skipped.push({
        expansionId: b.match.expansion.id,
        name: b.match.expansion.name,
        trades: b.trades,
        pages: plannedPagesFor(b.match.expansion.total ?? 0),
      });
      continue;
    }
    const cards = b.match.expansion.total ?? 0;
    const pages = plannedPagesFor(cards);
    if (credits + pages > opts.maxCredits) {
      deferred.push({ expansionId: b.match.expansion.id, name: b.match.expansion.name, trades: b.trades, pages });
      continue;
    }
    credits += pages;
    chosen.push({
      game: b.game,
      expansionId: b.match.expansion.id,
      name: b.match.expansion.name,
      lang: b.lang,
      setRaws: [...b.setRaws],
      trades: b.trades,
      cards,
      pages,
      members: b.members,
    });
  }
  return {
    chosen,
    credits,
    alreadyMapped: skipped.sort((a, b) => b.trades - a.trades),
    deferred: deferred.sort((a, b) => b.trades - a.trades),
    unresolvedSets: [...unresolved.values()].sort((a, b) => b.trades - a.trades),
    outOfScope,
  };
}

/**
 * Every card in one expansion, prices included.
 *
 * `include=prices` carries NO credit surcharge, so a walk that will ever want a
 * price takes it on the way past; fetching prices separately would double the
 * cost of the whole plan for nothing.
 *
 * ⚠️ Charges the monthly meter PER PAGE, before the next one. A pass killed
 * mid-walk has still spent every page it fetched, and a meter that only recorded
 * on success would authorise the next run against credits that are already gone.
 */
export async function walkExpansionCards(
  source: string,
  game: RipFunGame,
  expansionId: string,
  opts: { maxPages?: number; log?: (m: string) => void } = {},
): Promise<{ cards: RipFunCard[]; pages: number; total: number; truncated: boolean }> {
  const log = opts.log ?? (() => {});
  const maxPages = opts.maxPages ?? 40;
  const cards: RipFunCard[] = [];
  let total = 0;
  let pages = 0;
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchExpansionCardsPage(game, expansionId, { page, includePrices: true });
    await chargeMonthly(source, 1);
    pages = page;
    total = res.total_count ?? 0;
    const batch = res.data ?? [];
    cards.push(...batch);
    if (!batch.length || cards.length >= total) break;
  }
  const truncated = cards.length < total;
  if (truncated) log(`    ⚠ ${expansionId}: ${cards.length}/${total} cards after ${pages} page(s) — walk truncated`);
  return { cards, pages, total, truncated };
}

// ── Matching ──────────────────────────────────────────────────────────────

/**
 * Prefer the BASE printing when several CardOS cards share a number.
 *
 * CardOS models art and finish variants as separate ids off one number — `pl2-88`
 * is the normal card and `pl2-88vrh` its reverse holo, and the docs warn that the
 * suffix pattern is "a storage detail, not a contract". We cannot tell which
 * variant our slab is (our feeds carry no finish), so we take the base id: the
 * plain printing is the common case, and its price is the conservative one.
 * `matchedOn` records the ambiguity so a caller can weigh it.
 */
function preferBase(cands: RipFunCard[], number: string): RipFunCard {
  const exact = cands.filter((c) => (c.id ?? "").toLowerCase().endsWith(`-${number.toLowerCase()}`));
  if (exact.length) return exact[0];
  return [...cands].sort((a, b) => (a.id ?? "").length - (b.id ?? "").length)[0];
}

export type MatchResult = {
  mapping: Record<string, PrintingMapping>;
  unmatched: string[];
  /** Per-signal counts, for the hit-rate line in the PR. */
  bySignal: Record<PrintingMapping["matchedOn"], number>;
};

/** Match our traded printings against one expansion's card list. */
export function matchPrintings(
  game: "pokemon" | "onepiece",
  expansionId: string,
  cards: RipFunCard[],
  members: TradedPrinting[],
): MatchResult {
  const byNumber = new Map<string, RipFunCard[]>();
  const byNumberName = new Map<string, RipFunCard[]>();
  const byName = new Map<string, RipFunCard[]>();
  const push = (m: Map<string, RipFunCard[]>, k: string, c: RipFunCard) => {
    const cur = m.get(k);
    if (cur) cur.push(c);
    else m.set(k, [c]);
  };
  for (const c of cards) {
    // CardOS gives both a catalog `number` and the `printed_number` on the card;
    // our feeds copy whatever the grader's label said, which is the printed one.
    for (const raw of [c.number, c.printed_number]) {
      const num = raw != null ? String(raw).replace(/^0+(?=\d)/, "") : null;
      if (!num) continue;
      push(byNumber, num, c);
      push(byNumberName, `${num}|${foldCardName(c.name)}`, c);
    }
    const n = foldCardName(c.name);
    if (n) push(byName, n, c);
  }

  const mapping: Record<string, PrintingMapping> = {};
  const unmatched: string[] = [];
  const bySignal: MatchResult["bySignal"] = { "number+name": 0, number: 0, name: 0 };

  for (const p of members) {
    const nameKey = foldCardName(p.name);
    const hit =
      byNumberName.get(`${p.number}|${nameKey}`) ??
      byNumber.get(p.number) ??
      // Name alone is accepted ONLY when it is unique in the expansion. A set can
      // hold four Pikachus; picking one of them at random would be a confident
      // wrong price, which is worse than the honest "no comp" this else-branch
      // produces.
      (byName.get(nameKey)?.length === 1 ? byName.get(nameKey) : undefined);
    if (!hit?.length) { unmatched.push(p.key); continue; }
    const matchedOn: PrintingMapping["matchedOn"] = byNumberName.has(`${p.number}|${nameKey}`)
      ? "number+name"
      : byNumber.has(p.number)
        ? "number"
        : "name";
    const card = preferBase(hit, p.number);
    bySignal[matchedOn]++;
    mapping[p.key] = {
      cardosId: card.id,
      expansionId,
      game,
      matchedOn,
      cardosName: card.name ?? "",
      cardosNumber: card.number != null ? String(card.number) : null,
    };
  }
  return { mapping, unmatched, bySignal };
}

// ── Price extraction ──────────────────────────────────────────────────────

/**
 * A card page row → the stored comp row.
 *
 * ⚠️ USD IS ASSERTED, NOT ASSUMED. CardOS quotes USD today and says so on the
 * payload; a payload that ever says otherwise is skipped rather than silently
 * treated as dollars, which is the same rule the DYLI listings aggregate follows.
 */
export function toStoredPrinting(card: RipFunCard, expansionId: string, fetchedAt: string): StoredPrinting | null {
  const p = card.pricing;
  if (!card.id) return null;
  const currency = (p?.currency ?? "USD").trim().toUpperCase();
  const usd = currency === "USD";
  const market = usd ? parseMoney(p?.market) : null;

  const graded: StoredPrinting["graded"] = [];
  for (const g of p?.graded ?? []) {
    if (!usd) break;
    const value = parseMoney(g.value);
    if (value == null || !g.company || g.grade == null) continue;
    graded.push({
      company: String(g.company),
      grade: String(g.grade),
      valueUsd: value,
      basis: g.value_kind ?? null,
      confidence: g.confidence ?? null,
      soldCount: Number.isFinite(g.sold_count as number) ? (g.sold_count as number) : null,
      lastSoldAt: g.last_sold_at ?? null,
    });
  }
  // A row with neither a market price nor a single graded rung carries no comp —
  // storing it would just be a null that later reads as "we looked and it is free".
  if (market == null && !graded.length) return null;

  return {
    cardosId: card.id,
    expansionId,
    marketUsd: market,
    currency: p?.currency ?? null,
    updated: p?.market_updated_at ?? null,
    isStale: p?.is_stale ?? null,
    basis: null,
    confidence: null,
    soldCount: null,
    graded,
    fetchedAt,
  };
}
