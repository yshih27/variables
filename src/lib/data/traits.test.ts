/**
 * The card name — a grade is never a name.
 *
 *   npm run test:names
 *
 * The title fallback on both measured shapes (Collector Crypt `<year> #<number>
 * <name> <grade>`, Beezie `<year> <set> <name> #<number> <grade>`), the guard
 * at the key and the URL, and the old URL a renamed identity keeps answering
 * at. Titles marked `m` were read off the production `cards` table on
 * 2026-09-23 (`backfill-card-identity-key.ts --report-names`); `b` are the
 * brief's own examples; `c` are constructed to pin one rule.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCardIdentity, identityKey, supersededCardName, type CardIdentityParts } from "./traits";
import { cardNameFromTokenName, legacyCardNameFromTokenName } from "@/lib/card/nameFromTokenName";
import { startsWithGradeLabel, locateGrade, parseGrade } from "@/lib/card/grade";
import { identitySlug, supersededIdentitySlug } from "@/lib/card/identity";

/** A `cards` row as the dims scan reads it — the name column empty, as on every grade-named row. */
const row = (name: string, set: string | null, number: string | null, grade = "PSA 10", cardName: string | null = null) => ({
  name,
  cardName,
  set,
  grade,
  year: null,
  cardNumber: number,
});

type Case = { src: "m" | "b" | "c"; title: string; set: string | null; number: string | null; expect: string | null; why: string };

const TABLE: Case[] = [
  // ── Beezie, `<year> <set> <name> #<number> <grade>` — the brief's four strings
  { src: "m", title: "2024 Memorial Collection Mr. 2 Bon Clay #EB01-061 PSA 10", set: "Memorial Collection", number: "EB01-061", expect: "Mr. 2 Bon Clay", why: "One Piece; periods inside the name survive" },
  { src: "m", title: "2020 Panini Prizm Tyrese Haliburton #90 PSA 10", set: "Panini Prizm", number: "90", expect: "Tyrese Haliburton", why: "basketball" },
  { src: "m", title: "2021 Topps Chrome Tarik Skubal #103 PSA 10", set: "Topps Chrome", number: "103", expect: "Tarik Skubal", why: "baseball" },
  { src: "b", title: "2020 Panini Obsidian Jordan Love #111 PSA 10", set: "Panini Obsidian", number: "111", expect: "Jordan Love", why: "football, as the brief quotes it" },
  { src: "m", title: "2020 Panini Obsidian Jordan Love Electric Etch Purple #111 PSA 10", set: "Panini Obsidian", number: "111", expect: "Jordan Love Electric Etch Purple", why: "football, as measured: the parallel is in the title" },
  // ── a variant is part of the name: a different card, rightly a different identity
  { src: "b", title: "2020 Panini Prizm Silver Tyrese Haliburton #90 PSA 10", set: "Panini Prizm", number: "90", expect: "Silver Tyrese Haliburton", why: "the parallel stays in the name" },
  { src: "m", title: "2016 Panini Prizm Jaylen Brown Silver Prizm #44 PSA 10", set: "Panini Prizm", number: "44", expect: "Jaylen Brown Silver Prizm", why: "parallel after the player" },
  { src: "m", title: "2024 Two Legends Manga Alt. Art Silvers Rayleigh #OP08-118 BGS 10", set: "Two Legends", number: "OP08-118", expect: "Manga Alt. Art Silvers Rayleigh", why: "One Piece parallel: not the base card's price" },
  // ── language and edition are their own parts, not the name's
  { src: "m", title: "2023 Japanese Awakening of the New Era Belo Betty #OP05-002 BGS 10", set: "Awakening of the New Era", number: "OP05-002", expect: "Belo Betty", why: "Japanese: language lifted, name clean" },
  { src: "m", title: "2002 Metal Raiders 1st Edition Kazejin #MRD-026 PSA 8", set: "Metal Raiders", number: "MRD-026", expect: "Kazejin", why: "edition lifted, name clean" },
  { src: "b", title: "2023 Japanese Scarlet ex Klawf #88 CGC 10", set: "Scarlet ex", number: "88", expect: "Klawf", why: "name before the number, language before the set" },
  { src: "c", title: "2023 Japanese Scarlet ex Klawf #88 CGC 10", set: "Japanese Scarlet ex", number: "88", expect: "Klawf", why: "language inside the set string" },
  // ── what trails the grade is not the name either
  { src: "m", title: "2022 Japanese Championship Qualifier Tournament Promo Trafalgar Law #ST03-008 BGS 10 Black Label", set: "Championship Qualifier Tournament Promo", number: "ST03-008", expect: "Trafalgar Law", why: "BGS Black Label" },
  { src: "m", title: "2018 Panini Prizm Shai Gilgeous-Alexander #184 PSA 8 Auto 9", set: "Panini Prizm", number: "184", expect: "Shai Gilgeous-Alexander", why: "card grade + autograph grade" },
  { src: "m", title: "2015-16 Panini Preferred Victor Oladipo #116 BGS 8.5", set: "Panini Preferred", number: "116", expect: "Victor Oladipo", why: "a season year comes off whole" },
  // ── Collector Crypt, `<year> #<number> <name> <grade> <tail>` (32-char truncation)
  { src: "b", title: "2010 #96 Magnezone-Holo PSA 8 He", set: null, number: "96", expect: "Magnezone-Holo", why: "the name AFTER the number, cut at the grade" },
  { src: "b", title: "2025 #161 Articuno PSA 9 Jtg EN-", set: null, number: "161", expect: "Articuno", why: "truncated tail after the grade" },
  { src: "c", title: "2016 #9 Mewtwo-Reverse Foil PSA", set: null, number: "9", expect: "Mewtwo-Reverse Foil", why: "the truncation took the grade's number: cut at the grader word, as always" },
  { src: "c", title: "2023 #6 Charizard ex CGA 10", set: null, number: "6", expect: "Charizard ex", why: "a grader the old reading did not know" },
  // ── no grade in the title
  { src: "c", title: "2016 #20 Charizard-Holo Evolut", set: null, number: "20", expect: "Charizard-Holo Evolut", why: "truncated before the grade: the old reading, unchanged" },
  { src: "c", title: "2024 Memorial Collection Mr. 2 Bon Clay #EB01-061", set: "Memorial Collection", number: "EB01-061", expect: "Mr. 2 Bon Clay", why: "ungraded Beezie: nothing after the number" },
  // ── null, never a guess
  { src: "c", title: "2024 Memorial Collection #EB01-061 PSA 10", set: "Memorial Collection", number: "EB01-061", expect: null, why: "only year + set + number" },
  { src: "c", title: "2021 #25 Celebrations PSA 10", set: "Celebrations", number: "25", expect: null, why: "the set alone is not a name" },
  { src: "m", title: "2026 Event Top Prize Boa Hancock #OP14-112 PSA 10", set: "Promo", number: "OP14-112", expect: null, why: "the set is not a prefix (a promo descriptor sits there)" },
  { src: "m", title: "2008 YU-GI-OH! RETRO PACK #EN021", set: null, number: "EN021", expect: null, why: "no set string, and the rest IS the set" },
  { src: "m", title: "2021 Lillie #090 PSA 10 Pokemon", set: null, number: "090", expect: null, why: "Collector Crypt, name before the number, no set string: null, not a guess" },
  { src: "m", title: "1998 #NAKingler CGC 10 Pristine", set: null, number: null, expect: null, why: "number glued to the name: nothing readable either side" },
  { src: "c", title: "Tyrese Haliburton PSA 10", set: "Panini Prizm", number: null, expect: null, why: "no number to split on" },
];

test(`cardNameFromTokenName: ${TABLE.length} titles`, () => {
  for (const c of TABLE) {
    const got = cardNameFromTokenName({ name: c.title, set: c.set, number: c.number });
    assert.equal(got, c.expect, `${JSON.stringify(c.title)} (set ${JSON.stringify(c.set)}) — ${c.why}`);
    if (got) {
      assert.ok(!startsWithGradeLabel(got), `never a grade: ${got}`);
      assert.notEqual(got.toLowerCase(), c.title.toLowerCase(), "never the whole title");
      if (c.set) assert.notEqual(got.toLowerCase(), c.set.toLowerCase(), "never the set alone");
    }
  }
});

test("the old fallback read Beezie's grade as the name — and still reads Collector Crypt the same", () => {
  // The defect, reproduced by the frozen cut the slug index keeps for aliases.
  assert.equal(legacyCardNameFromTokenName("2024 Memorial Collection Mr. 2 Bon Clay #EB01-061 PSA 10"), "PSA 10");
  assert.equal(legacyCardNameFromTokenName("2020 Panini Prizm Tyrese Haliburton #90 PSA 10"), "PSA 10");
  // Where the old cut was right, the new one returns the identical string.
  for (const t of ["2010 #96 Magnezone-Holo PSA 8 He", "2025 #161 Articuno PSA 9 Jtg EN-", "2016 #20 Charizard-Holo Evolut", "2016 #9 Mewtwo-Reverse Foil PSA", "1982 #1 Topps Nolan Ryan TAG TEAM PSA 10"]) {
    assert.equal(cardNameFromTokenName({ name: t, set: null, number: null }), legacyCardNameFromTokenName(t), t);
  }
});

test("extractCardIdentity: the column wins; the title is read shape-aware; language is lifted", () => {
  const p = extractCardIdentity(row("2024 Memorial Collection Mr. 2 Bon Clay #EB01-061 PSA 10", "Memorial Collection", "EB01-061"));
  assert.equal(p.cardName, "Mr. 2 Bon Clay");
  assert.equal(p.number, "EB01-061");
  assert.equal(identitySlug("one_piece", p), "one-piece/memorial-collection/eb01-061/mr-2-bon-clay/psa-10");
  assert.equal(identityKey("one_piece", p), "one_piece|memorial-collection|EB01-061|MR. 2 BON CLAY|PSA 10||");

  const cc = extractCardIdentity(row("2010 #96 Magnezone-Holo PSA 8 He", null, null, "PSA 8"));
  assert.equal(cc.cardName, "Magnezone-Holo");
  assert.equal(cc.number, "96");

  const klawf = extractCardIdentity(row("2023 Japanese Scarlet ex Klawf #88 CGC 10", "Scarlet ex", "88", "CGC 10"));
  assert.equal(klawf.cardName, "Klawf");
  assert.equal(klawf.language, "Japanese");

  // The column is still preferred when it holds a name.
  const col = extractCardIdentity(row("2020 Panini Prizm Tyrese Haliburton #90 PSA 10", "Panini Prizm", "90", "PSA 10", "Tyrese Haliburton RC"));
  assert.equal(col.cardName, "Tyrese Haliburton RC");
});

test("a variant in the title is a different card: a different key and URL", () => {
  const base = extractCardIdentity(row("2020 Panini Prizm Tyrese Haliburton #90 PSA 10", "Panini Prizm", "90"));
  const silver = extractCardIdentity(row("2020 Panini Prizm Silver Tyrese Haliburton #90 PSA 10", "Panini Prizm", "90"));
  assert.notEqual(identityKey("basketball", base), identityKey("basketball", silver));
  assert.equal(identitySlug("basketball", silver), "basketball/panini-prizm/90/silver-tyrese-haliburton/psa-10");
});

test("the guard: a name never begins with a grade label, at the key and at the URL", () => {
  const graded: CardIdentityParts = { year: null, set: "Memorial Collection", number: "EB01-061", cardName: "PSA 10", grade: "PSA 10", edition: null, language: null };
  assert.equal(identityKey("one_piece", graded), null);
  assert.equal(identitySlug("one_piece", graded), null);
  // Whichever feed produces it — here the name COLUMN itself — the row is unpooled.
  const col = extractCardIdentity(row("2024 Memorial Collection Mr. 2 Bon Clay #EB01-061 PSA 10", "Memorial Collection", "EB01-061", "PSA 10", "PSA 10"));
  assert.equal(col.cardName, "PSA 10", "the column is taken as given");
  assert.equal(identityKey("one_piece", col), null);
  for (const g of ["BGS 10 BLACK LABEL", "CGC 10", "TAG 9", "BGS 9.5", "PSA GEM MT 10", "PSA 8 AUTO 9", "PSA 10 POKEMO"]) {
    assert.equal(identityKey("basketball", { ...graded, cardName: g }), null, g);
  }
  // A name that merely CONTAINS a grade is still a name.
  assert.ok(identityKey("pokemon", { ...graded, cardName: "Pikachu PSA 10 Promo" }));
});

test("startsWithGradeLabel: parseGrade's own match, at the start of the string", () => {
  // Measured as whole card names in the identity index, 2026-09-23: a grade, a
  // grade with its qualifiers or autograph grade, a grade with a truncated tail.
  const yes = [
    "PSA 10", "BGS 9.5", "CGC 10", "TAG 9", "CGC 5", "BGS 10 BLACK LABEL", "CGC 10 PRISTINE", "CGC 10 AUTO 10",
    "PSA 8 AUTO 9", "BGS 9 AUTO", "PSA 7 (MC)", "PSA 10 POKEMO", "PSA 10 HOLO GIOVANNI'S P", "PSA 5 E",
    "PSA GEM MT 10", "Beckett 9.5", " PSA 10 ", "psa 10",
  ];
  // A name that contains a grade later on, a grader with no number, words that only look like one.
  const no = ["Pikachu PSA 10", "Pikachu PSA 10 Promo", "PSA", "PSA AUTHENTIC", "PSA 2025", "PSA 45", "AGS 10th Anniversary", "TAG TEAM", "Arda Guler Autograph", "Mr. 2 Bon Clay", "10", "GEM MINT 10", "", "Charizard ex"];
  for (const s of yes) assert.equal(startsWithGradeLabel(s), true, s);
  for (const s of no) assert.equal(startsWithGradeLabel(s), false, s);
  assert.equal(startsWithGradeLabel(null), false);
});

test("parseGrade keeps its shape; locateGrade adds only the span", () => {
  assert.deepEqual(parseGrade("2025 #161 Articuno PSA 9 Jtg EN-"), { grader: "PSA", grade: 9, label: "PSA 9" });
  assert.deepEqual(parseGrade("BECKETT 9.5"), { grader: "BGS", grade: 9.5, label: "BGS 9.5" });
  const at = locateGrade("2010 #96 Magnezone-Holo PSA 8 He");
  assert.ok(at);
  assert.equal("2010 #96 Magnezone-Holo PSA 8 He".slice(at.start, at.end), "PSA 8");
});

test("a renamed identity keeps its old URL: the superseded name and slug", () => {
  const r = row("2024 Memorial Collection Mr. 2 Bon Clay #EB01-061 PSA 10", "Memorial Collection", "EB01-061");
  const p = extractCardIdentity(r);
  const was = supersededCardName(r, p);
  assert.equal(was, "PSA 10");
  assert.equal(supersededIdentitySlug("one_piece", { ...p, cardName: was }), "one-piece/memorial-collection/eb01-061/psa-10/psa-10");
  // Nothing to keep when the column named the card, or when the reading did not change.
  assert.equal(supersededCardName(row("x #1 y PSA 10", "s", "1", "PSA 10", "Real Name"), p), null);
  const cc = row("2010 #96 Magnezone-Holo PSA 8 He", null, null, "PSA 8");
  assert.equal(supersededCardName(cc, extractCardIdentity(cc)), null);
});

test("never throws on junk", () => {
  for (const name of [null, undefined, "", "   ", "#", "##", "#/", "2024", "PSA 10", "#EB01-061 PSA 10", "((( #1 )))"]) {
    for (const set of [null, "", "   ", "#", "PSA 10"]) {
      assert.doesNotThrow(() => cardNameFromTokenName({ name, set, number: "1" }));
      const got = cardNameFromTokenName({ name, set, number: "1" });
      assert.ok(got === null || !startsWithGradeLabel(got), `${JSON.stringify(name)} / ${JSON.stringify(set)} → ${JSON.stringify(got)}`);
    }
  }
});
