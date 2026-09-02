/**
 * Platform-agnostic card identity — the join key between OUR tokens and CardOS's
 * catalog.
 *
 * ⚠️ A PRINTING, NOT A GRADED COPY. The key deliberately excludes the grade:
 * "Charizard ex #6 from 151" is ONE CardOS card id, and its `pricing.graded[]` is
 * the whole PSA/BGS/CGC ladder for it. Keying on the graded copy would map the
 * same printing once per grade — ten mappings, ten times the matching work, and
 * the same single comp payload behind all of them. Grade re-enters at READ time,
 * to pick a rung off the ladder.
 *
 * ⚠️ NEVER PARSE `cards.name`. Collector Crypt's is hard-capped at 32 characters —
 * measured max 32, p95 32 — so "2025 #231 Team Rocket's Mewtwo E" is what a real
 * row holds. Every field here comes from `card_name` and the `attributes` jsonb,
 * which are uncapped and already normalised at write time.
 *
 * Grades route through src/lib/card/grade.ts. CardOS returns a grading body as a
 * `company` label, and its labels are the same family ours are ("BECKETT" for
 * BGS) — folding them anywhere but the SSOT is how two spellings of one grader
 * become two rungs of one ladder.
 */
import { parseGradeLabel, type ParsedGrade } from "@/lib/card/grade";
import type { TokenMetadata } from "@/lib/onchain/tokenUri";

/** CardOS lists one language at a time; these are the two our inventory carries. */
export type CardLang = "en" | "ja";

export type PrintingIdentity = {
  /** ipCatalog key — "pokemon" | "one_piece" | … */
  ip: string;
  /** English is CardOS's default list, so an undetected language resolves to "en". */
  lang: CardLang;
  /** True when the language was actually stated rather than defaulted. */
  langStated: boolean;
  /** The platform's own set string, verbatim — the resolver's input, kept for audit. */
  setRaw: string | null;
  /** Printed card number, digits only, leading zeros stripped ("002" → "2"). */
  number: string | null;
  /** `card_name`, trimmed. Null when the platform never wrote one. */
  name: string | null;
  /** Canonical grade via the SSOT, or null for ungraded / unparseable. */
  grade: ParsedGrade | null;
};

type Attr = { trait_type: string; value: string | number };

/** Case-insensitive attribute lookup over the stored `attributes` jsonb. */
function attr(attrs: Attr[] | null | undefined, ...keys: string[]): string | null {
  if (!attrs?.length) return null;
  for (const key of keys) {
    const lower = key.toLowerCase();
    const hit = attrs.find((a) => String(a?.trait_type ?? "").toLowerCase() === lower);
    if (hit?.value != null && String(hit.value).trim()) return String(hit.value).trim();
  }
  return null;
}

/**
 * Card number from whichever trait the platform used.
 *
 * ⚠️ Collector Crypt calls it "Serial Number" and Beezie calls it "Card Number",
 * and CC ALSO has a "Serial" on some rows meaning the grader's cert — a 10-digit
 * number that is not a card number at all. So the lookup is by exact trait name in
 * priority order, never a substring match on "serial", and the result is range-
 * checked: printed numbers run to a few hundred, cert numbers to billions.
 */
export function cardNumber(attrs: Attr[] | null | undefined): string | null {
  const raw = attr(attrs, "Card Number", "Serial Number", "Number", "Card #");
  if (!raw) return null;
  // Keep the leading digit run: "88", "002", "6", and "14a" → "14".
  const m = /^\s*#?\s*(\d{1,4})/.exec(raw);
  if (!m) return null;
  const n = Number(m[1]);
  // A printed card number above ~1000 is a cert or a serial that leaked into the
  // wrong trait. Dropping it costs one unmatched printing; keeping it would match
  // the WRONG card, which is worse than no comp at all.
  if (!Number.isFinite(n) || n <= 0 || n > 1000) return null;
  return String(n);
}

const JA_MARKERS = /\bjapanese\b|\bjapan\b|\bjpn?\b/i;
const EN_MARKERS = /\benglish\b|\ben\b/i;

/**
 * Language for the printing. Japanese is the DISCRIMINATING signal: CardOS's
 * lists default to English, and every Japanese printing is a separate card id
 * with its own price — often an order of magnitude apart. So a stated "Japanese"
 * wins, a stated "English" confirms, and silence defaults to English while
 * recording that it was a default (`langStated: false`), because a silently
 * assumed language that turns out wrong maps a card to the wrong price.
 */
export function cardLang(attrs: Attr[] | null | undefined, setRaw: string | null): {
  lang: CardLang;
  stated: boolean;
} {
  const stated = attr(attrs, "Language", "Lang");
  if (stated) {
    if (JA_MARKERS.test(stated)) return { lang: "ja", stated: true };
    if (EN_MARKERS.test(stated)) return { lang: "en", stated: true };
  }
  if (setRaw && JA_MARKERS.test(setRaw)) return { lang: "ja", stated: true };
  if (setRaw && EN_MARKERS.test(setRaw)) return { lang: "en", stated: true };
  return { lang: "en", stated: false };
}

/** One row of the `cards` table, restricted to what identity needs. */
export type CardRowForIdentity = {
  card_name: string | null;
  set_name: string | null;
  grade_label: string | null;
  ip_key: string | null;
  attributes: TokenMetadata["attributes"] | null;
};

export function identityFromCardRow(row: CardRowForIdentity): PrintingIdentity {
  const attrs = (row.attributes as Attr[] | null) ?? null;
  const setRaw = row.set_name ?? attr(attrs, "Set Name", "Set");
  const { lang, stated } = cardLang(attrs, setRaw);
  return {
    ip: row.ip_key ?? "other",
    lang,
    langStated: stated,
    setRaw,
    number: cardNumber(attrs),
    // `card_name` first; the attribute is the same value the writer derived it
    // from, so it is a fallback for rows written before that column existed.
    name: (row.card_name ?? attr(attrs, "Card Name", "Pokemon Name", "Subject"))?.trim() || null,
    grade: parseGradeLabel(row.grade_label),
  };
}

// ── Normalisation ─────────────────────────────────────────────────────────

/**
 * Fold a card or set name to a comparison key.
 *
 * ⚠️ MOJIBAKE IS REAL IN THIS DATA — the live table holds "Pok�mon Card 151",
 * a set name that lost its é to a bad decode upstream. So U+FFFD is stripped
 * rather than treated as a letter, and accented characters are folded to ASCII,
 * so "Pokémon", "Pokemon" and the corrupted form all land on one key.
 */
export function foldName(s: string | null | undefined): string {
  if (!s) return "";
  const base = s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining accents
    .replace(/\uFFFD/g, "") // the replacement char from upstream mojibake
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  // ⚠️ Singular/plural is a real mismatch in this data, not a nicety: our feeds say
  // "Black Star Promo" where CardOS says "Black Star Promos", and that one letter
  // was the whole reason a 60-trade set resolved to nothing. Folding the trailing
  // "s" off the LAST word fixes it. It also mangles honest plurals ("skies" →
  // "skie"), which is harmless precisely because BOTH sides fold through here —
  // consistently wrong compares equal, and this key is never displayed.
  return base.replace(/(\w{4,})s$/, "$1");
}

/**
 * Card-name qualifiers our feeds prepend or append that CardOS does not carry on
 * the name. "Full Art/Mew" is CardOS's "Mew" (the art variant is a separate id,
 * not a different name), and "Rayquaza-Holo" is "Rayquaza". Stripping them is
 * what turns a 0% match on those rows into a hit; NOT stripping them was the
 * difference between a name matching and silently not.
 */
const NAME_PREFIX_RE = /^(full art|alt art|alternate art|secret rare|special art|sar|holo|reverse holo)\s*[/:-]\s*/i;
const NAME_SUFFIX_RE = /\s*[-/]\s*(holo|reverse holo|full art|alt art|1st edition|first edition|promo)\s*$/i;

export function foldCardName(name: string | null | undefined): string {
  if (!name) return "";
  let s = name.trim();
  // Repeat: real names carry stacked qualifiers ("Full Art/Charizard V-Holo").
  for (let i = 0; i < 3; i++) {
    const next = s.replace(NAME_PREFIX_RE, "").replace(NAME_SUFFIX_RE, "");
    if (next === s) break;
    s = next;
  }
  return foldName(s);
}

/**
 * The mapping store's key. Grade-free by design (see the header).
 *
 * Returns null when the row cannot identify a printing — no name, or no number.
 * ⚠️ BOTH ARE REQUIRED, and that is the honest choice: a name alone matches every
 * printing of "Pikachu" in a set that may hold four, and a number alone matches
 * the base card and its three variants. A printing we cannot pin simply gets no
 * comp — which is the stated contract — rather than a confident wrong one.
 */
export function printingKey(id: PrintingIdentity): string | null {
  const name = foldCardName(id.name);
  if (!name || !id.number) return null;
  return [id.ip, id.lang, foldName(id.setRaw), id.number, name].join("|");
}

/** The same key from an already-matched CardOS card, for the reverse direction. */
export function printingKeyParts(parts: {
  ip: string;
  lang: CardLang;
  setRaw: string | null;
  number: string;
  name: string;
}): string {
  return [parts.ip, parts.lang, foldName(parts.setRaw), parts.number, foldCardName(parts.name)].join("|");
}
