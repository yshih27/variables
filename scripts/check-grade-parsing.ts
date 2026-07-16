/**
 * Grade-parsing regression check — pins `src/lib/card/grade.ts` against the real
 * name shapes the feeds emit. Sits beside check-freshness / check-invariants;
 * exits non-zero on any failure so it can gate.
 *
 *   npx tsx scripts/check-grade-parsing.ts
 *
 * ⚠️ NOT yet wired into package.json — that file is held by the in-flight email
 * branch and staging it here would drag their diff along. Add
 *   "check-grade-parsing": "tsx scripts/check-grade-parsing.ts"
 * when that lands.
 *
 * Why this exists: the grade is inline in the card NAME (no feed gives a field),
 * and it's a primary price determinant — a parse miss silently drops the chip
 * that explains the price. This is also the third time the parsing has been
 * touched; the two regexes this replaced had already drifted apart, each missing
 * cases the other caught. Every case below is a shape that actually appears
 * upstream, and the four marked NEW are ones the old regexes got wrong.
 */
import { parseGrade, parseGradeLabel } from "../src/lib/card/grade";

type Case = [input: string, want: string | null, note?: string];

const NAMES: Case[] = [
  // Shapes the old regexes already handled — must not regress.
  ["2025 #161 Articuno PSA 9 Jtg EN-", "PSA 9", "mid-string + trailing junk (real CC name)"],
  ["Charizard CGC 9 MINT", "CGC 9", "qualifier as SUFFIX"],
  ["Pikachu BGS 9.5", "BGS 9.5", "half grade"],
  ["Blastoise PSA GEM MT 10", "PSA 10", "qualifier infix"],
  ["Umbreon SGC 8", "SGC 8"],
  ["Lugia TAG 10", "TAG 10"],
  ["Mew CGA 9", "CGA 9"],

  // NEW — the old regexes got these wrong.
  ["Rayquaza PSA GEM-MT 10", "PSA 10", "NEW: hyphenated GEM-MT matched NOTHING before"],
  ["Zapdos PSA GEM-MT 9.5", "PSA 9.5", "NEW: hyphenated + half grade"],
  ["Snorlax BECKETT 9.5", "BGS 9.5", "NEW: BECKETT folds to BGS (same grader, two names)"],
  ["Gengar CGC PRISTINE 10", "CGC 10", "NEW: PRISTINE qualifier (gachaHits' regex lacked it)"],

  // Must be null — a wrong chip is worse than no chip.
  ["Snom", null, "bare Beezie name — no grade anywhere"],
  ["Pokemon TCG: Prismatic Evolutions Booster Box", null, "sealed product"],
  ["", null],
  ["Sealed ETB 2024", null, "number without a grader"],
  ["PSA 2025 #161 Articuno", null, "a YEAR must not parse as a grade"],
  ["Mewtwo CGA 45", null, "out of the 1–10 range → not a grade"],
  ["Vaporeon PRISTINE 10", null, "qualifier alone ⇒ grader unknown, don't guess CGC"],
];

/** The tables hand us an already-formatted label rather than a raw name. */
const LABELS: Case[] = [
  ["PSA 10", "PSA 10"],
  ["BGS 9.5", "BGS 9.5"],
  ["Ungraded", null, "gradeLabel() degrades to this string, never null"],
  ["", null],
];

let failed = 0;
const run = (cases: Case[], fn: (s: string) => { label: string } | null, kind: string) => {
  for (const [input, want, note] of cases) {
    const got = fn(input)?.label ?? null;
    if (got === want) continue;
    failed++;
    console.error(
      `  ✗ ${kind}(${JSON.stringify(input)})\n      want ${want} · got ${got}${note ? `\n      (${note})` : ""}`,
    );
  }
};

run(NAMES, parseGrade, "parseGrade");
run(LABELS, parseGradeLabel, "parseGradeLabel");

const total = NAMES.length + LABELS.length;
if (failed) {
  console.error(`\ngrade parsing: ${total - failed}/${total} passed, ${failed} FAILED`);
  process.exit(1);
}
console.log(`grade parsing: ${total}/${total} passed`);
