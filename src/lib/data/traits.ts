/**
 * Trait normalization across Beezie + Collector Crypt metadata.
 * Beezie keys: Set Name | Grader | Grade | Pokemon Name | Year | Card Number
 * CC keys:     Set      | Grading Company | The Grade / GradeNum | Card Name | Year | Insured Value
 */
import type { TokenMetadata } from "@/lib/onchain/tokenUri";

export type NormalizedTraits = {
  cardNumber: string | null;
  edition: string | null;
  language: string | null;
  category: string | null;
  set: string | null;
  grader: string | null; // PSA, CGC, BGS, SGC, AGS …
  gradeRaw: string | null; // raw value e.g. "10", "GEM-MT 10"
  gradeNum: number | null; // numeric, e.g. 10, 9.5
  cardName: string | null;
  year: number | null;
  insuredValueUsd: number | null;
  fullName: string | null; // meta.name (the card's full display name)
};

function findAttr(
  meta: TokenMetadata,
  ...keys: string[]
): string | null {
  if (!meta.attributes) return null;
  for (const key of keys) {
    const lower = key.toLowerCase();
    const a = meta.attributes.find((x) => x.trait_type?.toLowerCase() === lower);
    if (a?.value != null) return String(a.value);
  }
  return null;
}

function parseGradeNum(raw: string | null): number | null {
  if (!raw) return null;
  // "10", "GEM-MT 10", "9.5", "MINT 9", "BGS 9.5" — extract first number.
  const m = raw.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function parseYear(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.match(/\b(19\d{2}|20\d{2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

function parseUsd(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function normalizeTraits(meta: TokenMetadata): NormalizedTraits {
  const set = findAttr(meta, "Set Name", "Set", "Set/Series", "Set Series");
  const grader = findAttr(meta, "Grader", "Grading Company", "Grading", "Grading Service");
  const gradeRaw =
    findAttr(meta, "GradeNum", "Grade", "The Grade", "Grade Numeric", "Final Grade") ?? null;
  const cardName = findAttr(
    meta,
    "Card Name",
    "Pokemon Name",
    "Title/Subject",
    "Player",
    "Subject",
    "Character",
  );
  const yearRaw = findAttr(meta, "Year", "Print Year", "Release Year");

  return {
    cardNumber: normalizeNumber(findAttr(meta, "Card Number", "Number", "Card No", "No")),
    edition: findAttr(meta, "Edition", "Print Run"),
    language: findAttr(meta, "Language"),
    category: findAttr(meta, "Category", "Sport", "Type"),
    set,
    grader,
    gradeRaw,
    gradeNum: parseGradeNum(gradeRaw),
    cardName,
    year: parseYear(yearRaw),
    insuredValueUsd: parseUsd(findAttr(meta, "Insured Value", "Insured", "Value")),
    fullName: meta.name ?? null,
  };
}

/**
 * CARD IDENTITY — the parts that make two different tokens the SAME comparable.
 *
 * ⚠️ This is the input to the v3 price index (src/lib/data/identityIndex.ts). A
 * "2023 Pokemon 151 Charizard EX #6 PSA 9" is the same product whoever owns it, so
 * every sale of any token carrying that identity is one observation of one price.
 * That is what removes the resale-selection bias v2 had: v2 could only see cards
 * somebody chose to flip.
 *
 * The parts are extracted from what each platform actually stores — measured
 * 2026-09-08 against live rows, NOT assumed:
 *
 *  • Beezie   `name` is the full display string, e.g.
 *             "2023 Japanese Scarlet ex Klawf #88 CGC 10", and `card_name`,
 *             `set_name`, `grade_label` are already populated columns.
 *  • CC       `name` is TRUNCATED TO 32 CHARS, e.g. "2010 #96 Magnezone-Holo PSA 8 He"
 *             (the set name is cut off mid-word). Year and number lead the string so
 *             they survive the truncation; the tail never can be trusted. `card_name`
 *             and `set_name` are populated on some rows and null on others.
 *  • Courtyard / DYLI  have NO rows in `cards` at all, so they yield no identity.
 *
 * Hence: year and number are parsed from `name`, while set / cardName / grade are
 * taken from their columns when present and only fall back to the name pattern.
 */
export type CardIdentityParts = {
  year: number | null;
  set: string | null;
  number: string | null;
  cardName: string | null;
  grade: string;
  edition: string | null;
  language: string | null;
};

/** "#TG01" / "022" / "6" → a comparable token. Leading zeros are NOT stripped:
 *  "#022" and "#22" are different cards in some sets. */
function normalizeNumber(raw: string | null): string | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^#?([A-Za-z0-9][A-Za-z0-9\-\/]*)$/);
  return m ? m[1].toUpperCase() : null;
}

const LANGUAGES = ["Japanese", "Korean", "Chinese", "German", "French", "Spanish", "Italian"];
const EDITIONS = ["1st Edition", "Unlimited", "Shadowless", "Reverse Foil", "Holo"];

/**
 * Identity parts for one `cards` row. Platform quirks live HERE, never in the
 * consumer — see the header for what each platform actually stores.
 */
export function extractCardIdentity(row: {
  name?: string | null;
  cardName?: string | null;
  set?: string | null;
  grade?: string | null;
  year?: number | null;
  cardNumber?: string | null;
}): CardIdentityParts {
  const name = row.name ?? "";
  // Year: leading 4-digit on both platforms' name strings, else the column.
  const yearFromName = name.match(/^\s*(19\d{2}|20\d{2})\b/);
  const year = row.year ?? (yearFromName ? parseInt(yearFromName[1], 10) : null);
  // Number: the "#NNN" token. Both platforms put it before the grade.
  const numFromName = name.match(/#([A-Za-z0-9][A-Za-z0-9\-\/]*)/);
  const number = normalizeNumber(row.cardNumber ?? (numFromName ? numFromName[1] : null));

  const language = LANGUAGES.find((l) => name.includes(l)) ?? null;
  const edition = EDITIONS.find((e) => name.includes(e)) ?? null;

  // cardName: the column is cleaner than the truncated CC name, so prefer it.
  let cardName = row.cardName?.trim() || null;
  if (!cardName && numFromName) {
    // "2010 #96 Magnezone-Holo PSA 8 He" → everything between the number and the
    // grade. CC truncation can eat the tail, so this is a fallback, not the rule.
    const after = name.slice(name.indexOf(numFromName[0]) + numFromName[0].length);
    const cut = after.match(/^\s*(.+?)(\s+(?:PSA|BGS|CGC|SGC|AGS|Beckett|TAG)\b.*)?$/);
    cardName = cut?.[1]?.trim() || null;
  }

  return {
    year,
    set: row.set?.trim() || null,
    number,
    cardName,
    grade: row.grade?.trim() || "Ungraded",
    edition,
    language,
  };
}

/**
 * The identity KEY, or null when the row is too thin to be a comparable.
 *
 * Requires a card name, a grade, and at least one of set / number: without one of
 * those, "Charizard | PSA 10" would pool every Charizard ever printed into a single
 * "price", which is the mix error v1 died of, re-introduced through the back door.
 */
export function identityKey(ip: string, p: CardIdentityParts): string | null {
  if (!p.cardName) return null;
  if (!p.set && !p.number) return null;
  return [
    ip,
    p.set ?? "",
    p.number ?? "",
    p.cardName.toUpperCase(),
    p.grade,
    p.edition ?? "",
    p.language ?? "",
  ].join("|");
}

/** Display-friendly label for "PSA 10", "CGC 9.5", or "Ungraded". */
export function gradeLabel(t: NormalizedTraits): string {
  if (!t.grader && !t.gradeRaw) return "Ungraded";
  if (t.grader && t.gradeNum != null) return `${t.grader} ${t.gradeNum}`;
  if (t.grader) return t.grader;
  if (t.gradeRaw) return t.gradeRaw;
  return "Ungraded";
}
