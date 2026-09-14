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
 */
export function identitySlug(ip: string, p: CardIdentityParts): string | null {
  if (!p.cardName) return null;
  if (!p.set && !p.number) return null;
  const setId = p.set ? normalizeSetName(p.set) : null;
  const setKey = setId?.key ?? ABSENT;
  // ⚠️ Language from the SET STRING as well as the name. The identity parts
  // only read language off the card name, so "Pokemon Japanese Sv2a-Pokemon 151"
  // with a plain "Charizard ex" name carried language=null and its slug was
  // indistinguishable from the English 151 Charizard. The set normaliser lifts
  // the language out of the set string; use it, so the URL says /jp when the
  // card is Japanese whichever field said so. (Measured 2026-09-14: the hero
  // slug resolved to the Japanese card without this.)
  const language = p.language ?? (setId?.language ? LANGUAGE_BY_TAG[setId.language] ?? null : null);
  const segs = [
    slugify(ip) || ABSENT,
    setKey,
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
