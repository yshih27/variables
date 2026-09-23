/**
 * IDENTITY URL — the ONE source of truth for how a card identity becomes a path
 * and how a path becomes a lookup key.
 *
 *   /i/pokemon/151/6/charizard-ex/psa-10
 *   /i/<ip>/<set_key>/<number>/<name-slug>/<grade-slug>[/<edition>][/<lang>]
 *
 * ⚠️ DETERMINISTIC, LOWERCASE, ASCII, and built from the SAME parts the index
 * chains on (`extractCardIdentity` → `CardIdentityParts`). Nothing else may
 * assemble an identity URL: the palette, the rail, the card page's "every slab"
 * link, the grade ladder and the API all call `identitySlug`, so a change here
 * moves every surface at once and none of them can drift into a second scheme.
 *
 * Absent parts are the literal `-` segment (a URL segment cannot be empty, and
 * `identityKey` allows a missing set OR a missing number, never both). Edition
 * and language are appended only when present, in that order; `parseIdentitySlug`
 * tells them apart by vocabulary (a language is one of the two-letter codes
 * below, an edition is anything else), so a lone trailing `/jp` is unambiguous.
 *
 * `nameSlug` is the ONE function that derives a slug from `cardName`. It is
 * deliberately not exported for reuse elsewhere.
 */
import type { CardIdentityParts } from "@/lib/data/traits";
import { normalizeSetName } from "./setName";
import { normalizeCardNumber } from "./cardNumber";
import { canonicalIdentityParts } from "./identityParts";
import { startsWithGradeLabel } from "./grade";

export const IDENTITY_PATH_PREFIX = "/i";
/** The literal segment for an absent set or number. */
const ABSENT = "-";

const LANGUAGE_CODE: Record<string, string> = {
  japanese: "jp",
  korean: "kr",
  chinese: "cn",
  german: "de",
  french: "fr",
  spanish: "es",
  italian: "it",
};
/** setName.ts tags ("ja", "ko", "zh") → the display language the parts use. */
const LANGUAGE_BY_TAG: Record<string, string> = { ja: "Japanese", ko: "Korean", zh: "Chinese" };
const LANGUAGE_BY_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(LANGUAGE_CODE).map(([k, v]) => [v, k.charAt(0).toUpperCase() + k.slice(1)]),
);

const EDITION_SLUG: Record<string, string> = {
  "1st edition": "1st",
  unlimited: "unlimited",
  shadowless: "shadowless",
  "reverse foil": "reverse-foil",
  holo: "holo",
};
const EDITION_BY_SLUG: Record<string, string> = {
  "1st": "1st Edition",
  unlimited: "Unlimited",
  shadowless: "Shadowless",
  "reverse-foil": "Reverse Foil",
  holo: "Holo",
};

/** ASCII-fold + slugify. "Charizard EX" → "charizard-ex", "Pokémon" → "pokemon". */
function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The card-name slug. ONE function; used by identitySlug and nothing else. */
function nameSlug(cardName: string): string {
  return slugify(cardName) || ABSENT;
}

/** "PSA 10" → "psa-10" · "CGC 9.5" → "cgc-9-5" · "Ungraded" → "ungraded". */
export function gradeSlug(grade: string): string {
  return slugify(grade) || "ungraded";
}

/** "TG16" → "tg16" · "ST01-007" → "st01-007" · "25/102" → "25~102" (a slash
 *  would split the path; `~` is URL-safe and reversible). */
function numberSlug(number: string): string {
  return number.toLowerCase().replace(/\//g, "~");
}

/**
 * The path segments for an identity, or null when the parts cannot name one
 * (the same rule as `identityKey`: a name, a grade, and a set or a number).
 *
 * ⚠️ FROM v4.2 THE SET KEY, THE NUMBER AND THE LANGUAGE COME FROM
 * `canonicalIdentityParts` — the same function `identityKey` calls. One identity
 * therefore has exactly one key and exactly one URL, and the two cannot drift.
 * (Language from the SET STRING as well as the name lives in that function; it
 * is what keeps the Japanese and the English 151 Charizard apart once the
 * canonical set key folds their set strings together.)
 */
export function identitySlug(ip: string, p: CardIdentityParts): string | null {
  // A name never begins with a grade label — the same refusal as
  // `identityKey`, so a card cannot have a URL without a key or a key without a URL.
  if (startsWithGradeLabel(p.cardName)) return null;
  return slugOfParts(ip, p);
}

/** The v4.2 slug from parts, without the name guard. Private but for the one export below. */
function slugOfParts(ip: string, p: CardIdentityParts): string | null {
  if (!p.cardName) return null;
  const c = canonicalIdentityParts(p);
  if (!c.setKey && !c.number) return null;
  const segs = [
    slugify(ip) || ABSENT,
    c.setKey ?? ABSENT,
    c.number ? numberSlug(c.number) : ABSENT,
    nameSlug(p.cardName),
    gradeSlug(p.grade),
  ];
  if (p.edition) segs.push(EDITION_SLUG[p.edition.toLowerCase()] ?? slugify(p.edition));
  if (c.language) segs.push(LANGUAGE_CODE[c.language.toLowerCase()] ?? slugify(c.language));
  return segs.join("/");
}

/**
 * The URL an identity answered at under a SUPERSEDED name — the v4.2 slug built
 * without the grade-name guard.
 *
 * ⚠️ FROZEN, AND READ ONLY BY THE SLUG INDEX (and the name-fix probe, which
 * must find the URL of a pre-fix identity to count it). Until 2026-09-23 the name
 * fallback cut titles at the wrong segment and 587 identities were named after
 * their grade, so their pages lived at "…/eb01-061/psa-10/psa-10".
 * The fix gives them their real names and therefore new URLs; nothing in the
 * old path says what the name should have been, so the proxy cannot 301 it.
 * The builder registers this slug as an ALIAS of the identity's new key (the
 * `legacyIdentitySlug` mechanism) and the old link keeps answering, with the
 * API reporting `canonical: false`. Nothing else may build a URL from a
 * grade-label name.
 */
export function supersededIdentitySlug(ip: string, p: CardIdentityParts): string | null {
  return slugOfParts(ip, p);
}

/**
 * The v4.1 slug — canonical set key OR the ABSENT segment, and the RAW number.
 *
 * ⚠️ FROZEN, AND READ ONLY BY THE SLUG INDEX. Two classes of v4.1 URL do not
 * survive the re-key: a number that normalises ("…/025~102/…" → "…/25/…") and a
 * set the normaliser judged junk, which used to slug as `-` and now slugs as its
 * own bucket. The first class is recoverable from the URL alone, so `proxy.ts`
 * 301s it; the second is NOT (nothing in "…/-/…" says which junk set it was), so
 * the builder registers the old slug as an alias of the same keys and the page
 * keeps answering. The API then reports `canonical: false` with the canonical
 * slug beside it.
 */
export function legacyIdentitySlug(ip: string, p: CardIdentityParts): string | null {
  if (!p.cardName) return null;
  if (!p.set && !p.number) return null;
  const setId = p.set ? normalizeSetName(p.set) : null;
  const language = p.language ?? (setId?.language ? LANGUAGE_BY_TAG[setId.language] ?? null : null);
  const segs = [
    slugify(ip) || ABSENT,
    setId?.key ?? ABSENT,
    p.number ? numberSlug(p.number) : ABSENT,
    nameSlug(p.cardName),
    gradeSlug(p.grade),
  ];
  if (p.edition) segs.push(EDITION_SLUG[p.edition.toLowerCase()] ?? slugify(p.edition));
  if (language) segs.push(LANGUAGE_CODE[language.toLowerCase()] ?? slugify(language));
  return segs.join("/");
}

/** Full href for an identity page. */
export function identityHref(slug: string): string {
  return `${IDENTITY_PATH_PREFIX}/${slug}`;
}

/**
 * Display case for a card name — the feeds store most of them in caps
 * ("CHARIZARD EX", "PIKACHU WITH GREY FELT HAT"). ONE function, so the palette
 * row, the page title, the crumb and the share card spell a card the same way.
 * Deliberately naive (every word capitalised, nothing else): a list of tokens
 * that "should" stay upper-case (EX, GX, V…) would be a second vocabulary to
 * keep, and a wrong guess there reads worse than a plain title case.
 */
export function identityDisplayName(cardName: string): string {
  // An apostrophe is not a word boundary: "GIOVANNI'S PINSIR" is "Giovanni's
  // Pinsir" and "FARFETCH'D" is "Farfetch'd" (measured on the character
  // rollups: 2,000+ owner-prefixed identities printed "Giovanni'S").
  return cardName.toLowerCase().replace(/(^|[\s\-\/])(\w)/g, (m, sep: string, c: string) => sep + c.toUpperCase());
}

export type ParsedIdentitySlug = {
  ip: string;
  /** Canonical set key, or null when the segment was `-`. */
  setKey: string | null;
  /** Card number as written in the slug (lowercased, `~` for `/`), or null. */
  number: string | null;
  nameSlug: string;
  gradeSlug: string;
  edition: string | null; // display form, e.g. "1st Edition"
  language: string | null; // display form, e.g. "Japanese"
  /** The normalised slug, re-joined — what the lookup compares against. */
  slug: string;
};

/**
 * Parse a path (with or without the `/i/` prefix) back into the lookup key.
 * Null for anything that is not five to seven well-formed segments. Never throws
 * — a malformed URL must 404, not 500.
 */
export function parseIdentitySlug(input: string): ParsedIdentitySlug | null {
  let s = input.trim();
  if (s.startsWith(IDENTITY_PATH_PREFIX + "/")) s = s.slice(IDENTITY_PATH_PREFIX.length + 1);
  s = s.replace(/^\/+|\/+$/g, "");
  let segs: string[];
  try {
    segs = s.split("/").map((x) => decodeURIComponent(x).toLowerCase());
  } catch {
    return null;
  }
  if (segs.length < 5 || segs.length > 7) return null;
  // ⚠️ `&` IS A LEGAL SEGMENT CHARACTER HERE. Set keys keep it ("sword-&-shield-promos",
  // "sun-&-moon-unbroken-bonds"), `identitySlug` emits it, and a parser that
  // rejected it made 3,474 identities (6.4%, every Scarlet & Violet and Sword &
  // Shield card) unreachable: the reader returned null and the proxy 404'd the
  // palette's own top hit. RFC 3986 allows `&` in a path segment unencoded.
  if (segs.some((x) => !x || !/^[a-z0-9~._&-]+$/.test(x))) return null;
  const [ip, setKey, number, name, grade, ...rest] = segs;
  if (name === ABSENT || setKey === ABSENT && number === ABSENT) return null;
  let edition: string | null = null;
  let language: string | null = null;
  for (const r of rest) {
    if (LANGUAGE_BY_CODE[r] && language == null) language = LANGUAGE_BY_CODE[r];
    else if (EDITION_BY_SLUG[r] && edition == null) edition = EDITION_BY_SLUG[r];
    else return null; // an unknown trailing segment is not an identity
  }
  return {
    ip,
    setKey: setKey === ABSENT ? null : setKey,
    number: number === ABSENT ? null : number,
    nameSlug: name,
    gradeSlug: grade,
    edition,
    language,
    slug: segs.join("/"),
  };
}

/**
 * The canonical form of an identity path — the ONE answer to "is this URL the
 * card's URL, and if not, which is?".
 *
 * Total over anything `parseIdentitySlug` accepts, and IDEMPOTENT
 * (`canonicalIdentitySlug(canonicalIdentitySlug(x)) === canonicalIdentitySlug(x)`),
 * which is what makes it safe to 301 to: a proxy that redirected to a form this
 * function would move again is a redirect loop. Null for anything that is not an
 * identity path at all — the caller 404s those, it does not redirect them.
 *
 * It canonicalises exactly what a URL carries enough information to canonicalise:
 *   • the NUMBER segment, through `normalizeCardNumber` (`025~102` → `25`);
 *   • the trailing optional segments, re-emitted edition-then-language, so
 *     `/jp/1st` and `/1st/jp` are one URL;
 *   • case and percent-encoding, via the parser.
 * It does NOT touch the set segment: a `-` there says only that v4.1 could not
 * place the set string, and nothing in the path says which string it was. Those
 * URLs keep working through the slug index's aliases instead (see
 * `legacyIdentitySlug`).
 */
export function canonicalIdentitySlug(input: string): string | null {
  const p = parseIdentitySlug(input);
  if (!p) return null;
  const number = p.number ? normalizeCardNumber(p.number.replace(/~/g, "/")) : null;
  const segs = [
    p.ip,
    p.setKey ?? ABSENT,
    number ? numberSlug(number) : ABSENT,
    p.nameSlug,
    p.gradeSlug,
  ];
  if (p.edition) segs.push(EDITION_SLUG[p.edition.toLowerCase()] ?? slugify(p.edition));
  if (p.language) segs.push(LANGUAGE_CODE[p.language.toLowerCase()] ?? slugify(p.language));
  return segs.join("/");
}
