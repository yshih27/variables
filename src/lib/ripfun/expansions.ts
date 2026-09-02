/**
 * Our platform set strings → CardOS expansion ids.
 *
 * ⚠️ THIS RESOLVER EXISTS SO THE MAPPING NEVER NAME-SEARCHES. `/cards?q=name:…`
 * costs 1 credit PER LOOKUP; at ~500 traded types that is the entire monthly
 * allowance to map one month's inventory once. Resolving sets first, then walking
 * each set's card list once (1 credit per 100 cards, prices included free), is
 * what turns that into ~65 credits — and the arithmetic only works because a
 * single expansion page maps every printing in it at once.
 *
 * The inputs are messy in a specific, learnable way. Real `set_name` values:
 *   "Pokemon Dri EN-Destined Rivals"          Collector Crypt, English  → code DRI
 *   "Pokemon Japanese Sv2a-Pokemon 151"       Collector Crypt, Japanese → id sv2a
 *   "Paradox Rift - PAR EN - English"         Beezie-style              → code PAR
 *   "VSTAR Universe - s12a - Japanese"        Beezie-style              → id s12a
 *   "Pokemon 151" / "Terastal Festival ex"    bare name
 *   "Pok<mojibake>mon Card 151 - sv2a - Japanese"  a set name that lost its é
 *
 * So three signals, in descending trustworthiness: the expansion ID embedded in
 * the string, the set CODE, then the NAME. Id and code are unique keys; a name is
 * not (there is a "Jungle 1st Edition" and a "Jungle Unlimited"), which is why a
 * name match must be unambiguous within the language before it is accepted.
 */
import { foldName, type CardLang } from "./identity";
import type { RipFunExpansion, RipFunGame } from "./catalog";

/** ipCatalog key → the CardOS game whose routes carry it. */
export const GAME_BY_IP: Record<string, RipFunGame> = {
  pokemon: "pokemon",
  one_piece: "onepiece",
};

export type ExpansionIndex = {
  game: RipFunGame;
  byId: Map<string, RipFunExpansion>;
  byCode: Map<string, RipFunExpansion[]>;
  byName: Map<string, RipFunExpansion[]>;
};

const langOf = (e: RipFunExpansion): CardLang => (e.language_code === "ja" ? "ja" : "en");

export function buildExpansionIndex(game: RipFunGame, rows: RipFunExpansion[]): ExpansionIndex {
  const byId = new Map<string, RipFunExpansion>();
  const byCode = new Map<string, RipFunExpansion[]>();
  const byName = new Map<string, RipFunExpansion[]>();
  const push = <K,>(m: Map<K, RipFunExpansion[]>, k: K, e: RipFunExpansion) => {
    const cur = m.get(k);
    if (cur) cur.push(e);
    else m.set(k, [e]);
  };
  for (const e of rows) {
    if (!e?.id) continue;
    byId.set(e.id.toLowerCase(), e);
    if (e.code) push(byCode, e.code.toUpperCase(), e);
    if (e.name) {
      const folded = foldName(e.name);
      push(byName, folded, e);
      // ⚠️ ALSO index the CORE name. CardOS's Japanese 151 is "Pokémon Card 151"
      // while our feeds call it "Pokemon 151" — one indexing word apart, and that
      // gap alone stranded the single most-traded Japanese set. Dropping the
      // leading qualifier words gives both sides a shared handle ("151").
      const core = coreName(e.name);
      if (core && core !== folded) push(byName, core, e);
    }
  }
  return { game, byId, byCode, byName };
}

/** Leading words that qualify a set rather than name it. */
const LEAD_NOISE_RE = /^\s*(pok[e\u00E9\uFFFD]?mon|one piece|japanese|english|chinese|card|tcg|the)\s+/i;

/**
 * A set name with its leading qualifier words stripped — "Pokémon Card 151" and
 * "Pokemon Japanese 151" both reduce to "151". Applied to BOTH the index and the
 * query so the two meet in the middle.
 */
export function coreName(name: string): string {
  let s = name.trim();
  for (let i = 0; i < 4; i++) {
    const next = s.replace(LEAD_NOISE_RE, "");
    if (next === s) break;
    s = next;
  }
  return foldName(s);
}

/**
 * Tokens pulled out of a set string that might be an expansion id or a set code.
 *
 * ⚠️ The two CANNOT be told apart by shape — "sv2a" is an id and "SVP" is a code,
 * both alphanumeric and short — so every candidate is tried against BOTH lookups
 * and the id wins where both hit. Guessing by casing would break the moment a
 * platform normalised its set names.
 */
function candidateTokens(setRaw: string): string[] {
  const out: string[] = [];
  const s = setRaw.trim();

  // ⚠️ "Pokemon <Code> EN-<Name>" is Collector Crypt's English pattern, and the
  // naive "token before the hyphen" reads it as "EN" — not a set code, which is
  // how the single biggest English set in our book ("Pokemon Svp EN-SV Black Star
  // Promo", 95 trades) resolved to nothing. Match the language marker explicitly
  // so the token BEFORE it is the one taken.
  const beforeLang = /(?:^|\s)([A-Za-z0-9]{1,8})\s+(?:EN|JP|JA|ENG|JPN)\s*-/i.exec(s);
  if (beforeLang) out.push(beforeLang[1]);

  // "Pokemon Japanese <Id>-<Name>" — the token immediately before the hyphen that
  // introduces the human name.
  const dash = /(?:^|\s)([A-Za-z0-9]{1,8})\s*-\s*\S/.exec(s);
  if (dash) out.push(dash[1]);

  // "<Name> - <code> - <Language>" — the middle segment of a 3-part split, with
  // its trailing language marker stripped ("PAR EN" → "PAR").
  const parts = s.split(/\s+-\s+/);
  if (parts.length >= 2) {
    for (const mid of parts.slice(1)) {
      const tok = mid.trim().replace(/\s+(EN|JP|JA|ENG|JPN)$/i, "").trim();
      if (tok && /^[A-Za-z0-9]{1,10}$/.test(tok)) out.push(tok);
    }
  }
  return [...new Set(out.filter(Boolean))];
}

/** Name candidates: the whole string, the parts around the separators, and the
 *  progressively de-prefixed forms. */
function candidateNames(setRaw: string): string[] {
  const s = setRaw.trim();
  const out = [s];

  // "Pokemon Dri EN-Destined Rivals" → "Destined Rivals".
  //
  // ⚠️ ONLY WHEN THE HYPHEN IS ACTUALLY A SEPARATOR. Some set strings hyphenate
  // the CODE itself — "Pokemon Japanese SV-P Promo" — and blindly taking the text
  // after the first hyphen yields "P Promo", which folds onto the real Japanese
  // expansion "P Promos" and resolves the Scarlet & Violet promos to a completely
  // different set. That was a live 38-trade mis-mapping, and a wrong comp is worse
  // than none. So the after-dash name is trusted only when what precedes the
  // hyphen ends in a language marker ("… Dri EN-") or in a token carrying a digit
  // ("… Sv2a-", "… M2-"), which is what a real set id or code looks like. A bare
  // "SV-" or "M-" is a hyphenated code and gets no name candidate.
  const cut = s.indexOf("-");
  if (cut > 0) {
    const before = s.slice(0, cut).trim();
    const lastTok = before.split(/\s+/).pop() ?? "";
    const isSeparator = /^(EN|JP|JA|ENG|JPN)$/i.test(lastTok) || (/\d/.test(lastTok) && lastTok.length <= 6);
    if (isSeparator) {
      const after = s.slice(cut + 1).trim();
      if (after) out.push(after);
    }
  }
  // "<Name> - <code> - <Language>" → "<Name>"
  const parts = s.split(/\s+-\s+/);
  if (parts.length >= 2) out.push(parts[0]);

  // ⚠️ PROGRESSIVELY DROP LEADING WORDS. Our feeds prefix the SERIES onto the set
  // ("Pokemon Sword & Shield Evolving Skies") where CardOS names only the set
  // ("Evolving Skies"), and the series vocabulary is open-ended — Sword & Shield,
  // Sun & Moon, XY, Scarlet & Violet, and whatever ships next. Enumerating them
  // goes stale; dropping up to five leading words does not ("Pokemon Japanese\n  // Sword & Shield Vstar Universe" needs all five). This is only safe
  // because the other side matches EXACTLY on the folded name, so a shortened
  // candidate either hits one real set or nothing at all.
  for (const v of [...out]) {
    const words = v.split(/\s+/);
    for (let drop = 1; drop <= 5 && drop < words.length; drop++) {
      const rest = words.slice(drop).join(" ");
      // Two chars would let "ex" or "gx" match a set; require a real remainder.
      if (rest.length >= 3) out.push(rest);
    }
  }
  return [...new Set(out.map((v) => v.trim()).filter(Boolean))];
}

export type ExpansionMatch = {
  expansion: RipFunExpansion;
  /** Which signal resolved it — carried into the mapping store for audit. */
  matchedOn: "id" | "code" | "name";
  /** True when the resolved expansion's language equals the printing's. */
  langAgrees: boolean;
};

/**
 * Resolve one set string to a CardOS expansion.
 *
 * Language is a FILTER, not a tiebreak: a Japanese printing priced against the
 * English expansion is not a near-miss, it is a different card that often trades
 * an order of magnitude apart. So candidates are restricted to the printing's
 * language first, and only a lone cross-language hit is returned — flagged
 * `langAgrees: false` so the caller can decline it.
 */
export function resolveExpansion(
  index: ExpansionIndex,
  setRaw: string | null,
  lang: CardLang,
): ExpansionMatch | null {
  if (!setRaw) return null;

  const pick = (hits: RipFunExpansion[] | undefined, matchedOn: ExpansionMatch["matchedOn"]): ExpansionMatch | null => {
    if (!hits?.length) return null;
    const sameLang = hits.filter((e) => langOf(e) === lang);
    if (sameLang.length === 1) return { expansion: sameLang[0], matchedOn, langAgrees: true };
    // Several same-language hits: only an id/code is authoritative enough to pick
    // one blind. An ambiguous NAME ("Jungle 1st Edition" vs "Jungle Unlimited") is
    // refused — mapping to the wrong printing prices a card off the wrong scarcity.
    if (sameLang.length > 1) {
      return matchedOn === "name" ? null : { expansion: sameLang[0], matchedOn, langAgrees: true };
    }
    if (hits.length === 1) return { expansion: hits[0], matchedOn, langAgrees: false };
    return null;
  };

  for (const tok of candidateTokens(setRaw)) {
    const byId = index.byId.get(tok.toLowerCase());
    const hit = pick(byId ? [byId] : undefined, "id");
    if (hit?.langAgrees) return hit;
  }
  for (const tok of candidateTokens(setRaw)) {
    const hit = pick(index.byCode.get(tok.toUpperCase()), "code");
    if (hit?.langAgrees) return hit;
  }
  for (const nm of candidateNames(setRaw)) {
    const hit = pick(index.byName.get(foldName(nm)), "name") ?? pick(index.byName.get(coreName(nm)), "name");
    if (hit?.langAgrees) return hit;
  }
  // Nothing agreed on language. A lone cross-language hit is returned so the
  // caller can log it as a near-miss; the mapping pass declines to use it.
  for (const tok of candidateTokens(setRaw)) {
    const byId = index.byId.get(tok.toLowerCase());
    const hit = pick(byId ? [byId] : undefined, "id") ?? pick(index.byCode.get(tok.toUpperCase()), "code");
    if (hit) return hit;
  }
  return null;
}
