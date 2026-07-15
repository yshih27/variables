/**
 * Grading — the ONE parser and the ONE grader palette.
 *
 * Graded cards carry their grade inline in the card NAME ("2025 #161 Articuno
 * PSA 9 Jtg EN-"); no upstream feed gives us a separate field. Two private
 * regexes used to do this (gachaHits, warmers/gachaPacks) and had already
 * drifted — one knew BECKETT and PRISTINE, the other didn't — and three
 * components each carried their own GRADER_COLOR, two of which disagreed on CGC
 * and BGS (IPTraitTables' BGS was #fdff8c: the pre-rebrand yellow-2, a colour
 * that no longer exists in the system).
 *
 * The grade is a primary price determinant here, so a miss isn't cosmetic — it
 * silently drops the chip that explains why a card costs what it costs.
 */

/**
 * Graders we recognise. BECKETT is listed but PRISTINE is NOT: "PRISTINE" is a
 * CGC designation, so a bare "PRISTINE 10" tells us the grade but not the
 * grader, and guessing CGC there would be a fabrication. It stays a qualifier
 * only — "CGC PRISTINE 10" parses via CGC.
 */
const GRADERS = ["BECKETT", "PSA", "BGS", "CGC", "SGC", "TAG", "CGA", "AGS"] as const;

/**
 * Qualifier words that sit between the grader and the number ("PSA GEM MT 10")
 * or trail it ("CGC 9 MINT"). Matched with a flexible separator so the
 * hyphenated form ("GEM-MT", which appears in real trait data) parses too — the
 * old regexes used `GEM\s?MT` and silently failed on it.
 */
const QUALIFIER = "(?:GEM[\\s-]*MT|GEM|MINT|PRISTINE|PRIS|MT)";

/**
 * grader → optional qualifiers → the number. Deliberately NOT anchored: the
 * grade sits mid-string with trailing junk in real names.
 *
 * `\\d{1,2}(?:\\.\\d)?` and not `(?:\\.5)?` — BGS half-grades are the common
 * case but the feeds are not disciplined about it, and a 4-digit year can't
 * match `\\d{1,2}` followed by `\\b` anyway ("PSA 2025" won't parse as PSA 20).
 */
const GRADE_RE = new RegExp(
  `\\b(${GRADERS.join("|")})\\b[\\s:_·-]*(?:${QUALIFIER}[\\s-]*)*(\\d{1,2}(?:\\.\\d)?)\\b`,
  "i",
);

export type ParsedGrade = {
  /** Normalized, uppercase — e.g. "PSA". */
  grader: string;
  /** Numeric grade, e.g. 9 or 9.5. */
  grade: number;
  /** Display form, e.g. "PSA 9.5". */
  label: string;
};

/** Beckett Grading Services IS BGS — one grader, two names in the feeds. Folded
 *  so "BECKETT 9.5" and "BGS 9.5" can't render as two different chips. */
const GRADER_ALIAS: Record<string, string> = { BECKETT: "BGS" };

/**
 * Pull a grade out of a card name. Returns null for anything ungraded (sealed
 * boxes, bare names like "Snom") — the caller then omits the chip rather than
 * inventing one.
 */
export function parseGrade(name: string | null | undefined): ParsedGrade | null {
  if (!name) return null;
  const m = GRADE_RE.exec(name);
  if (!m) return null;
  const grade = parseFloat(m[2]);
  // Real grades are 1–10. Without this a stray "CGA 45" in a name would parse
  // as a grade; the number next to a grader token isn't automatically a grade.
  if (!Number.isFinite(grade) || grade < 1 || grade > 10) return null;
  const raw = m[1].toUpperCase();
  const grader = GRADER_ALIAS[raw] ?? raw;
  return { grader, grade, label: `${grader} ${grade}` };
}

/**
 * Parse an ALREADY-formatted label ("PSA 10", "Ungraded") back into its parts —
 * for the tables, which receive `gradeLabel` strings rather than raw card names.
 */
export function parseGradeLabel(label: string | null | undefined): ParsedGrade | null {
  if (!label) return null;
  const m = /^\s*([A-Za-z]+)\s*(\d{1,2}(?:\.\d)?)\s*$/.exec(label);
  if (!m) return null;
  const grade = parseFloat(m[2]);
  if (!Number.isFinite(grade) || grade < 1 || grade > 10) return null;
  const raw = m[1].toUpperCase();
  const grader = GRADER_ALIAS[raw] ?? raw;
  return { grader, grade, label: `${grader} ${grade}` };
}

/**
 * ONE grader palette. Values are the majority set (PlatformTables + IPTables);
 * IPTraitTables' divergent CGC/BGS are dropped — one of them was a dead
 * pre-rebrand colour. Distinct from `lib/gradeColor.ts`, which is a per-grade
 * RAMP for the dominance chart (grade 10 vivid → grade 6 dark); this is the flat
 * family hue used by chips.
 */
const GRADER_COLOR: Record<string, string> = {
  PSA: "#D62828",
  CGC: "#5b9bff",
  BGS: "#f5c451", // BECKETT folds into BGS before it reaches here.
  SGC: "#a18cff",
  AGS: "#6cf48a",
  TAG: "#a78bfa",
  CGA: "#2bd6a0",
};

export function graderColor(grader: string | null | undefined): string {
  if (!grader) return "#707070";
  return GRADER_COLOR[grader.toUpperCase()] ?? "#707070";
}
