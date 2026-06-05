/**
 * Trait normalization across Beezie + Collector Crypt metadata.
 * Beezie keys: Set Name | Grader | Grade | Pokemon Name | Year | Card Number
 * CC keys:     Set      | Grading Company | The Grade / GradeNum | Card Name | Year | Insured Value
 */
import type { TokenMetadata } from "@/lib/onchain/tokenUri";

export type NormalizedTraits = {
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

/** Display-friendly label for "PSA 10", "CGC 9.5", or "Ungraded". */
export function gradeLabel(t: NormalizedTraits): string {
  if (!t.grader && !t.gradeRaw) return "Ungraded";
  if (t.grader && t.gradeNum != null) return `${t.grader} ${t.gradeNum}`;
  if (t.grader) return t.grader;
  if (t.gradeRaw) return t.gradeRaw;
  return "Ungraded";
}
