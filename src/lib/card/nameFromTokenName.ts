/**
 * THE CARD NAME FROM A TOKEN TITLE — the ONE read-time fallback for a row whose
 * `card_name` column is empty.
 *
 * ⚠️ TWO SHAPES, MEASURED (2026-09-23), AND THE OLD FALLBACK KNEW ONE.
 *
 *   Collector Crypt   `<year> #<number> <name> <grade> <tail>`
 *                     "2010 #96 Magnezone-Holo PSA 8 He" (the title is truncated
 *                     to 32 characters, so the tail can never be trusted)
 *   Beezie            `<year> <set> <name> #<number> <grade>`
 *                     "2024 Memorial Collection Mr. 2 Bon Clay #EB01-061 PSA 10"
 *
 * Beezie's One Piece and sports tokens carry no name attribute at all (only Set
 * Name / Card Number / Grader / Grade / Category), so `cards.card_name` is null
 * and the title is the only place the name lives. The old fallback took
 * "everything after the #number up to the grade" — right for Collector Crypt,
 * and on Beezie's shape the text after the number IS the grade, so it returned
 * "PSA 10" as the card's name. Measured on 2026-09-23: 587 identities named
 * after their grade — 572 Beezie, keyed `… | PSA 10 | PSA 10`, and 15 Collector
 * Crypt titles whose name sits before the number or is glued to it ("1952
 * Topps Yogi Berra #191 PSA 4", "1998 #NAKingler CGC 10 Pristine"), read as the
 * grade or the grade and a truncated tail ("PSA 10 POKEMO") — printed as rows
 * called "Psa 10" and unmappable to any character.
 *
 * WHAT THIS DOES:
 *   1. finds the `#<number>` token (the one matching the row's number when the
 *      title carries several; the row's number as a bare token when it carries
 *      none);
 *   2. takes the segment AFTER it the way Collector Crypt's shape has always
 *      been read — up to the first grader word — and then up to the first grade
 *      label (`parseGrade`), so a grader the old reading did not know ("CGA
 *      10") or a label it read whole ("CGC 10 AUTO 10") cannot ride into a name;
 *   3. only when that segment is empty or begins with a grade label, takes the
 *      segment BEFORE the number: drops a leading year (a season, "2021-22",
 *      included) and any language words, strips the set as a prefix (the row's
 *      raw set string, else the normalised set's display name) matched word by
 *      word, case-insensitive, punctuation folded — then any language or
 *      edition words, which the extractor lifts into their own identity parts.
 *
 * ⚠️ WHY STEP 2 KEEPS THE OLD READING VERBATIM. Every identity keyed before this
 * fix was keyed on it, so a title whose old reading was already a real name must
 * come out byte for byte the same, or its identity re-keys for nothing. And the
 * grader WORD, not the whole label, is where Collector Crypt's 32-character
 * truncation leaves most titles: "2016 #9 Mewtwo-Reverse Foil PSA" has lost the
 * grade's number, so `parseGrade` finds no grade there at all. Measured: a cut
 * at the grade LABEL alone re-keyed 1,967 identities (1,670 Pokémon, 206 comics)
 * to names ending in "… PSA" or "… CGC".
 *
 * ⚠️ NULL RATHER THAN A GUESS. It never returns a grade, nor anything that
 * begins with one (`startsWithGradeLabel`, over `parseGrade` — the only
 * definition of a grade label), never the set string alone, never the whole
 * title. When the set cannot be stripped as a prefix — or the row has no set
 * string to strip — there is no telling where the set ends and the name
 * begins, so the answer is null: the row is then unpooled, exactly as a
 * nameless row always was. Measured: 25 of the 587 identities stay nameless
 * this way (promo titles with a descriptor where the set would be, and
 * Collector Crypt titles with no set string).
 *
 * Pure. No I/O. Never throws.
 */
import { startsWithGradeLabel, locateGrade } from "./grade";
import { normalizeSetName, setDisplayName } from "./setName";
import { normalizeCardNumber } from "./cardNumber";

export type TokenNameRow = {
  /** The token's title — `cards.name`. */
  name: string | null | undefined;
  /** The row's raw set string — `cards.set_name`. */
  set?: string | null;
  /** The row's card number — `cards.card_number` (raw). */
  number?: string | null;
};

/** The `#<number>` token, as the identity extractor has always read it. */
const NUMBER_TOKEN = /#([A-Za-z0-9][A-Za-z0-9\-\/]*)/g;
const YEAR_WORD = /^(?:19|20)\d{2}$/;
/**
 * Language words that sit between the year and the set in a title ("2023
 * Japanese Scarlet ex Klawf #88 CGC 10"). The extractor lifts the language into
 * its own part from the title already; here it is only stepped over so the set
 * prefix can be found and the name comes out clean.
 */
const LANGUAGE_WORDS = new Set(["japanese", "korean", "chinese", "german", "french", "spanish", "italian", "english"]);
/**
 * Edition phrases the extractor lifts into the identity's own `edition` part
 * (traits.ts EDITIONS). A title that carries one between the set and the name
 * ("2002 Metal Raiders 1st Edition Kazejin") must not repeat it in the name.
 */
const EDITION_PHRASES: string[][] = [["1st", "edition"], ["unlimited"], ["shadowless"], ["reverse", "foil"], ["holo"]];

type Word = { w: string; start: number; end: number };

/** Case, diacritics and apostrophes folded; `&` reads as `and`. */
function foldWord(raw: string): string {
  const w = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’`]/g, "");
  return w === "&" ? "and" : w;
}

/** The words of a string with their offsets — punctuation is a separator. */
function words(s: string): Word[] {
  const out: Word[] = [];
  for (const m of s.matchAll(/[\p{L}\p{N}]+(?:['’`][\p{L}\p{N}]+)*|&/gu)) {
    const start = m.index ?? 0;
    out.push({ w: foldWord(m[0]), start, end: start + m[0].length });
  }
  return out;
}

const folded = (s: string | null | undefined): string => (s ? words(s).map((x) => x.w).join(" ") : "");

/**
 * Where the row's number sits in the title. The `#` token that normalises to
 * the row's number wins; else the first `#` token (the extractor's historical
 * reading); else, when the title has no `#` at all, the row's number as a bare
 * token — only if it occurs exactly once and is neither the year nor part of a
 * grade label.
 */
function locateNumber(title: string, rowNumber: string | null | undefined): { start: number; end: number } | null {
  const hashes = [...title.matchAll(NUMBER_TOKEN)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, value: m[1] }));
  const want = normalizeCardNumber(rowNumber ?? null);
  if (hashes.length) {
    const match = want ? hashes.find((h) => normalizeCardNumber(h.value) === want) : undefined;
    const h = match ?? hashes[0];
    return { start: h.start, end: h.end };
  }
  if (!rowNumber) return null;
  const raw = String(rowNumber).trim().replace(/^#/, "");
  if (!raw || YEAR_WORD.test(raw)) return null;
  const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bare = [...title.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "giu"))];
  if (bare.length !== 1) return null;
  const start = bare[0].index ?? 0;
  const end = start + bare[0][0].length;
  const g = locateGrade(title);
  if (g && start < g.end && end > g.start) return null;
  return { start, end };
}

/** The set's candidate spellings as folded word lists, most literal first. */
function setPrefixes(set: string | null | undefined): string[][] {
  if (!set || !set.trim()) return [];
  const raw = words(set).map((x) => x.w);
  const display = setDisplayName(normalizeSetName(set).key);
  const cands = [raw, display ? words(display).map((x) => x.w) : []];
  // A set string that itself leads with a year ("2023 Topps Chrome") is also
  // tried without it — the title's own year has already been stepped over.
  for (const c of [...cands]) if (c.length > 1 && YEAR_WORD.test(c[0])) cands.push(c.slice(1));
  const seen = new Set<string>();
  return cands.filter((c) => c.length && !seen.has(c.join(" ")) && (seen.add(c.join(" ")), true));
}

/** Index of the first word AFTER the set prefix starting at word `at`, or -1. */
function afterPrefix(ws: Word[], at: number, prefixes: string[][]): number {
  for (const p of prefixes) {
    if (at + p.length > ws.length) continue;
    if (p.every((w, k) => ws[at + k].w === w)) return at + p.length;
  }
  return -1;
}

/**
 * Collector Crypt's reading of the text after the number — up to the first
 * grader word — VERBATIM from the extractor as it stood until 2026-09-23. See
 * the header for why it is not re-derived from `parseGrade`: the vocabulary and
 * the case-sensitivity are exactly what every current key was built on.
 */
function afterNumberReading(after: string): string {
  const cut = after.match(/^\s*(.+?)(\s+(?:PSA|BGS|CGC|SGC|AGS|Beckett|TAG)\b.*)?$/);
  return cut?.[1]?.trim() ?? "";
}

/** Separators a name segment never starts or ends with. Periods stay ("Mime Jr."). */
function trimSeparators(s: string): string {
  return s.replace(/^[\s\-–—/:;,|]+|[\s\-–—/:;,|]+$/g, "");
}

/**
 * The name from the text BEFORE the number: year, language, set — then the rest.
 *
 * ⚠️ THE SET MUST COME OFF AS A PREFIX, OR THE ANSWER IS NULL — and a row with
 * no set string at all is null too. Either way nothing says where the set ends
 * and the name begins, and "never the set" cannot be honoured. Measured on the
 * set-less Collector Crypt titles when the rest was taken as the name: "2008
 * YU-GI-OH! RETRO PACK #EN021" read "YU-GI-OH! RETRO PACK" (the set) and "2020
 * PANINI PRIZM ROOKIE CARD #3" read a name with no name in it. A set string
 * that is present but not a prefix is the same case seen from the other side:
 * "2026 Event Top Prize Boa Hancock" for set "Promo".
 */
function nameBeforeNumber(before: string, set: string | null | undefined): string | null {
  const ws = words(before);
  let i = 0;
  if (ws[0] && YEAR_WORD.test(ws[0].w)) {
    i = 1;
    // A season year, "2021-22" / "2021/22": the second half goes with the first.
    if (ws[1] && /^\d{2}$/.test(ws[1].w) && /^[-/]$/.test(before.slice(ws[0].end, ws[1].start))) i = 2;
  }
  const prefixes = setPrefixes(set);
  if (!prefixes.length) return null;
  let j = afterPrefix(ws, i, prefixes);
  if (j < 0) {
    let k = i;
    while (k < ws.length && LANGUAGE_WORDS.has(ws[k].w)) k++;
    if (k > i) j = afterPrefix(ws, k, prefixes);
  }
  if (j < 0) return null;
  // Language and edition words right after the set come off too ("… Awakening
  // of the New Era Japanese Roronoa Zoro", "… Metal Raiders 1st Edition
  // Kazejin"): the extractor lifts both into their own identity parts.
  for (let moved = true; moved && j < ws.length; ) {
    moved = false;
    if (LANGUAGE_WORDS.has(ws[j].w)) { j++; moved = true; continue; }
    const ed = EDITION_PHRASES.find((p) => p.every((w, k) => ws[j + k]?.w === w));
    if (ed) { j += ed.length; moved = true; }
  }
  if (j >= ws.length) return null; // year + set and nothing else
  return trimSeparators(before.slice(ws[j].start)) || null;
}

/**
 * The final gate every candidate passes: never a grade, never the set, never the
 * title. Trimmed only — internal whitespace is left exactly as the title has it,
 * because the old fallback left it so, and a name that changed by one space
 * would re-key a card for nothing.
 */
function acceptable(candidate: string | null, title: string, set: string | null | undefined): string | null {
  const c = candidate?.trim();
  if (!c) return null;
  if (startsWithGradeLabel(c)) return null;
  const f = folded(c);
  if (!f) return null;
  if (setPrefixes(set).some((p) => p.join(" ") === f)) return null;
  if (f === folded(title)) return null;
  return c;
}

/**
 * The card's name recovered from its token title, or null. See the header for
 * the two shapes and the order the segments are tried in.
 */
export function cardNameFromTokenName(row: TokenNameRow): string | null {
  try {
    // The RAW title: positions and spacing exactly as stored (see `acceptable`).
    const title = row.name ?? "";
    if (!title.trim()) return null;
    const at = locateNumber(title, row.number);
    if (!at) return null;

    // 2. After the number: Collector Crypt's reading, then cut at a grade label.
    let seg = afterNumberReading(title.slice(at.end));
    const g = locateGrade(seg);
    if (g) seg = seg.slice(0, g.start).trim();
    if (seg && !startsWithGradeLabel(seg)) return acceptable(seg, title, row.set);

    // 3. Before the number, less year, language and set (Beezie).
    return acceptable(nameBeforeNumber(title.slice(0, at.start), row.set), title, row.set);
  } catch {
    return null;
  }
}

/**
 * THE PRE-2026-09-23 FALLBACK, VERBATIM — "everything after the first #number up
 * to the first grader word".
 *
 * ⚠️ FROZEN, AND READ ONLY FOR THE CUTOVER. It exists so the slug index can
 * register the URL a row answered at before this fix as an alias of the row's
 * new identity (the "…/psa-10/psa-10" pages keep answering, `canonical: false`),
 * and so `backfill-card-identity-key.ts --report-names` can print old → new.
 * Nothing may call it to NAME a card.
 */
export function legacyCardNameFromTokenName(title: string | null | undefined): string | null {
  const name = title ?? "";
  const numFromName = name.match(/#([A-Za-z0-9][A-Za-z0-9\-\/]*)/);
  if (!numFromName) return null;
  return afterNumberReading(name.slice(name.indexOf(numFromName[0]) + numFromName[0].length)) || null;
}
