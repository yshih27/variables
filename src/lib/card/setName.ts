/**
 * SET NAMES — the ONE normaliser from a platform's raw `set_name` to a canonical
 * set key, display name and language.
 *
 * ⚠️ THE RAW FIELD IS DIRTY, MEASURED NOT ASSUMED (2026-09-10, 152,419 cards).
 * Pokémon alone carries 2,102 distinct set strings for maybe 200 real sets. The
 * same set arrives as "Pokemon Sword and Shield Crown Zenith" (1,256) and
 * "Crown Zenith" (264); as "Pokemon Japanese Sv2a-Pokemon 151", "Pokemon Mew
 * EN-151", "Pokemon 151" and the mojibake "Pok<fffd>mon Card 151 - sv2a -
 * Japanese". Left alone, one set becomes four thin buckets and no set ever
 * clears an index floor.
 *
 * WHAT THIS DOES, IN ORDER: repair mojibake, lift the language out to its own
 * part, strip the IP prefix, strip set-code prefixes ("Svp EN-", "Sv2a-",
 * "OP13-"), strip trailing " - <code> - <language>" tails, then slugify and run
 * an explicit alias table.
 *
 * ⚠️ THE ALIASES ARE EXPLICIT ON PURPOSE. A generic "strip the era prefix" rule
 * would fold "SV Black Star Promo", "SWSH Black Star Promo" and "SM Black Star
 * Promo" into one key — three genuinely different promo sets, three different
 * price levels, one mix error of exactly the kind the identity index exists to
 * remove. So eras are PRESERVED, and only collapses that were verified against
 * the measured strings are listed. Anything not in the table keeps its own key:
 * an over-fragmented set publishes no index, which is honest; a wrongly merged
 * one publishes a wrong number.
 *
 * ⚠️ THIS DOES NOT FEED `identityKey`. The card identity still keys on the RAW
 * set string (src/lib/data/traits.ts), because changing it would silently move
 * every published index level. Set normalisation is used to GROUP sales into set
 * entities and to fill `cards.set_key`. Re-keying identities on `set_key` is a
 * separate change with its own before/after.
 */

export type SetIdentity = {
  /** Canonical slug, e.g. "crown-zenith". Null when the raw value is junk. */
  key: string | null;
  /** Display name, e.g. "Crown Zenith". Null when the key is null. */
  name: string | null;
  /** ISO-ish language tag lifted out of the string ("ja", "en", "zh", "ko"). */
  language: string | null;
};

/** Language markers, longest first so "Simplified Chinese" wins over "Chinese". */
const LANGUAGES: [RegExp, string][] = [
  [/\bsimplified chinese\b/i, "zh"],
  [/\btraditional chinese\b/i, "zh"],
  [/\bchinese\b/i, "zh"],
  [/\bjapanese\b/i, "ja"],
  [/\bkorean\b/i, "ko"],
  [/\benglish version\b/i, "en"],
  [/\benglish\b/i, "en"],
];

/** IP prefixes stripped from the head of the string, repeatedly. */
const IP_PREFIXES = [/^pok[eé]mon\s+/i, /^pokemon\s+/i, /^one\s+piece\s+/i, /^card\s+game\s+/i];

/**
 * Set-code prefixes: "Svp EN-", "Sv2a-", "OP13-", "EB02-", "PRB01-", "ST01-",
 * "s12a-", "M1l-". Two shapes, both anchored at the start so a hyphen inside a
 * real name ("Premium Booster -One Piece Card the Best-") is never eaten.
 */
const CODE_PREFIXES = [
  /^[A-Za-z]{1,6}\s?(?:EN|JP|JA)-\s*/, // "Svp EN-", "Mew EN-", "SV-P " handled below
  /^[A-Za-z]{1,4}\d{1,3}[a-z]?-\s*/, // "Sv2a-", "OP13-", "EB02-", "s12a-", "M2-"
];

/** Junk: no set can be recovered from these, so they become null, never a key. */
const JUNK = new Set([
  "",
  "-",
  "--",
  "n-a",
  "na",
  "none",
  "null",
  "unknown",
  "other",
  "misc",
  // Bare era/series codes with no set: "SV" (995 cards), "ME" (580), "S", "P".
  "sv",
  "me",
  "s",
  "p",
  "sm",
  "xy",
  "swsh",
  /**
   * "Game" / "Pokemon Game" (1,777 cards). A PSA label fragment, not a set: it
   * spans the 1999 base-era print runs and we hold no year in the identity to
   * separate them. Indexing it would price several sets as one. Dropped to null
   * with the count reported, rather than guessed into "Base Set".
   */
  "game",
]);

/**
 * Verified collapses. Left side is the slug AFTER mechanical normalisation;
 * right side is the canonical slug. Every entry here was read off the measured
 * top-60 strings, not inferred from set knowledge.
 */
const ALIASES: Record<string, string> = {
  // Crown Zenith — "Pokemon Sword and Shield Crown Zenith" (1,256) vs "Crown Zenith" (264)
  "sword-&-shield-crown-zenith": "crown-zenith",
  // Evolving Skies — 519 vs 259
  "sword-&-shield-evolving-skies": "evolving-skies",
  // VSTAR Universe — "Pokemon Japanese Sword & Shield Vstar Universe" (775) vs
  // "VSTAR Universe - s12a - Japanese" (303)
  "sword-&-shield-vstar-universe": "vstar-universe",
  // Pokémon 151 — "Mew EN-151" → "151"; "Sv2a-Pokemon 151" → "151";
  // "Pokémon Card 151 - sv2a - Japanese" → "card-151"
  "card-151": "151",
  "pokemon-151": "151",
  // Hidden Fates — "Pokemon Sun & Moon Hidden Fates" (582)
  "sun-&-moon-hidden-fates": "hidden-fates",
  // Other Sword & Shield / Sun & Moon era sets that also appear bare.
  "sword-&-shield-brilliant-stars": "brilliant-stars",
  "sword-&-shield-silver-tempest": "silver-tempest",
  "sword-&-shield-lost-origin": "lost-origin",
  "sword-&-shield-fusion-strike": "fusion-strike",
  "sword-&-shield-astral-radiance": "astral-radiance",
  "sun-&-moon-cosmic-eclipse": "cosmic-eclipse",
  "celebrations-classic-collection": "classic-collection",
  // "Terastal Fest EX" (the Japanese Sv8a abbreviation) is "Terastal Festival ex".
  "terastal-fest-ex": "terastal-festival-ex",
  // "XY Evolutions" is the 2016 set usually written bare as "Evolutions".
  // ⚠️ NOT to be confused with "Prismatic Evolutions" (2025) or "Mega Evolution":
  // a token-overlap heuristic proposed folding all three together, which is why
  // this table is hand-verified and generic era-stripping was rejected.
  "xy-evolutions": "evolutions",
  // Black Star Promo, long form vs short — ERA IS PRESERVED, only the wording
  // collapses: "Black Star Promos - Scarlet & Violet SVP EN - English" is the
  // same set as "Pokemon Svp EN-SV Black Star Promo", and the Sword & Shield
  // pair likewise. The bare "Black Star Promo" (640) stays its OWN key: it names
  // no era, so folding it into one would price three promo sets as one.
  "black-star-promos-scarlet-&-violet-svp-en": "sv-black-star-promo",
  "black-star-promos-sword-&-shield": "swsh-black-star-promo",
  /**
   * One Piece — the game IS "One Piece Card Game", so its promo bucket and the
   * bare one are the same label. "Promotional Cards" and "Tournament Promos" are
   * NOT folded in: they are different labels and nothing in the data shows they
   * are the same set.
   *
   * A bare "Promos" is kept as its own key rather than nulled, for the same
   * reason bare "Black Star Promo" is: it is a coarse label, not junk, and
   * dropping it would delete 1,868 One Piece cards' set from the leaderboard.
   */
  "card-game-promos": "promos",
};

/** Words that keep their case in the display name. */
const UPPER = new Set(["ex", "gx", "vmax", "vstar", "v", "sv", "swsh", "sm", "xy", "op", "tcg"]);

function fixMojibake(s: string): string {
  return s
    .replace(/Pok[�éÃ©?]+mon/gi, "Pokémon")
    .replace(/�/g, "");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9&]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function titleize(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => (UPPER.has(w) ? w.toUpperCase() : w === "&" ? "&" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Raw `set_name` → canonical key, display name and language. Total: an
 * unrecognised string still yields a key (its own), and only genuine junk
 * yields null.
 */
export function normalizeSetName(raw: string | null | undefined): SetIdentity {
  if (raw == null) return { key: null, name: null, language: null };
  let s = fixMojibake(String(raw)).replace(/\s+/g, " ").trim();
  if (!s) return { key: null, name: null, language: null };

  // 1. Language out to its own part, removed from the name.
  let language: string | null = null;
  for (const [re, tag] of LANGUAGES) {
    if (re.test(s)) {
      language = tag;
      s = s.replace(re, " ");
    }
  }

  // 2. Trailing " - <code>" / " - <lang>" tails: "Carrying on His Will (OP13) - English",
  //    "VSTAR Universe - s12a - Japanese". Drop tail segments that are codes.
  const segs = s.split(" - ").map((x) => x.trim()).filter(Boolean);
  if (segs.length > 1) {
    const kept = segs.filter((seg, i) => i === 0 || !/^[A-Za-z]{1,4}\d{1,3}[a-z]?$/.test(seg));
    s = kept.join(" - ");
  }
  s = s.replace(/\s*\([A-Za-z]{1,4}\d{1,3}[a-z]?\)\s*/g, " "); // "(OP13)"

  // 3. IP prefix, then set-code prefix, then IP prefix again — "Sv2a-Pokemon 151"
  //    only reveals its IP prefix after the code comes off.
  for (let pass = 0; pass < 3; pass++) {
    const before = s;
    for (const re of IP_PREFIXES) s = s.replace(re, "");
    for (const re of CODE_PREFIXES) s = s.replace(re, "");
    s = s.replace(/\s+/g, " ").trim();
    if (s === before) break;
  }

  // 4. "and" → "&" so "Sword and Shield" and "Sword & Shield" reach one slug.
  s = s.replace(/\band\b/gi, "&").replace(/\s+/g, " ").trim();

  const slug0 = slugify(s);
  const key = ALIASES[slug0] ?? slug0;
  if (!key || JUNK.has(key)) return { key: null, name: null, language };
  return { key, name: titleize(key), language };
}

/** The set part of a studio/blob entity id: `set:<ip>:<key>`. */
export function setEntityId(ip: string, key: string): string {
  return `set:${ip}:${key}`;
}
