/**
 * v4.2 identity: the number rule, one key ⇄ one URL, and the canonical-form
 * contract the proxy's 301 rests on.
 *
 *   npm run test:identity
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCardNumber } from "./cardNumber";
import { identitySlug, legacyIdentitySlug, canonicalIdentitySlug, parseIdentitySlug } from "./identity";
import { identityKey, legacyIdentityKey, parseIdentityKey, type CardIdentityParts } from "@/lib/data/traits";

const parts = (o: Partial<CardIdentityParts>): CardIdentityParts => ({
  year: null,
  set: null,
  number: null,
  cardName: null,
  grade: "Ungraded",
  edition: null,
  language: null,
  ...o,
});

test("normalizeCardNumber — the brief's four rules", () => {
  assert.equal(normalizeCardNumber("#TG01"), "TG1");
  assert.equal(normalizeCardNumber("025/102"), "25");
  assert.equal(normalizeCardNumber("006"), "6");
  assert.equal(normalizeCardNumber("TG16"), "TG16");
  assert.equal(normalizeCardNumber("SV049"), "SV49");
  assert.equal(normalizeCardNumber("  6 "), "6");
  assert.equal(normalizeCardNumber("tg16/tg30"), "TG16");
  assert.equal(normalizeCardNumber("H12/H32"), "H12");
  assert.equal(normalizeCardNumber(null), null);
  assert.equal(normalizeCardNumber("  "), null);
});

test("normalizeCardNumber — compound codes keep their printed form", () => {
  // One Piece: the leading "01" is a SET code, not padding.
  assert.equal(normalizeCardNumber("ST01-007"), "ST01-007");
  assert.equal(normalizeCardNumber("OP13-001"), "OP13-001");
  // Nothing understandable in a two-slash token: left alone, never guessed at.
  assert.equal(normalizeCardNumber("1/2/3"), "1/2/3");
  assert.equal(normalizeCardNumber("N/A"), "N/A");
});

test("normalizeCardNumber is idempotent", () => {
  for (const raw of ["#TG01", "025/102", "006", "SV049", "ST01-007", "0", "000", "005a", "N/A"]) {
    const once = normalizeCardNumber(raw);
    assert.equal(normalizeCardNumber(once), once, raw);
  }
});

test("one identity → one key and one URL (set-string and number variants fold)", () => {
  const a = parts({ set: "Pokemon Obf EN-Obsidian Flames", number: "006/197", cardName: "Charizard ex", grade: "PSA 10" });
  const b = parts({ set: "Obsidian Flames", number: "6", cardName: "Charizard ex", grade: "PSA 10" });
  assert.equal(identityKey("pokemon", a), identityKey("pokemon", b));
  assert.equal(identitySlug("pokemon", a), identitySlug("pokemon", b));
  assert.equal(identitySlug("pokemon", a), "pokemon/obsidian-flames/6/charizard-ex/psa-10");
  // v4.1 kept them apart — this is the fragmentation the re-key removes.
  assert.notEqual(legacyIdentityKey("pokemon", a), legacyIdentityKey("pokemon", b));
});

test("the key and the URL are built from the same parts", () => {
  const p = parts({ set: "Pokemon Sword and Shield Crown Zenith", number: "GG44/GG70", cardName: "Mewtwo VSTAR", grade: "PSA 9" });
  const key = identityKey("pokemon", p)!;
  const slug = identitySlug("pokemon", p)!;
  const back = parseIdentityKey(key)!;
  const parsed = parseIdentitySlug(slug)!;
  assert.equal(parsed.setKey, back.parts.set);
  assert.equal(parsed.number, back.parts.number!.toLowerCase());
  assert.equal(identitySlug(back.ip, back.parts), slug, "the key round-trips to its own URL");
});

test("a junk set keeps its own bucket instead of pooling into ABSENT", () => {
  const game = parts({ set: "Pokemon Game", number: "4", cardName: "Charizard", grade: "PSA 8" });
  const sv = parts({ set: "SV", number: "4", cardName: "Charizard", grade: "PSA 8" });
  assert.notEqual(identityKey("pokemon", game), identityKey("pokemon", sv));
  assert.notEqual(identitySlug("pokemon", game), identitySlug("pokemon", sv));
  // v4.1 gave both the SAME url (a fragment) and different keys.
  assert.equal(legacyIdentitySlug("pokemon", game), legacyIdentitySlug("pokemon", sv));
});

test("the set string's language keeps the Japanese card apart from the English one", () => {
  const ja = parts({ set: "Pokemon Japanese Sv2a-Pokemon 151", number: "006", cardName: "Charizard ex", grade: "PSA 10" });
  const en = parts({ set: "Pokemon 151", number: "6", cardName: "Charizard ex", grade: "PSA 10" });
  assert.notEqual(identityKey("pokemon", ja), identityKey("pokemon", en));
  assert.equal(identitySlug("pokemon", ja), "pokemon/151/6/charizard-ex/psa-10/jp");
  assert.equal(identitySlug("pokemon", en), "pokemon/151/6/charizard-ex/psa-10");
});

test("canonicalIdentitySlug: old forms, idempotence, and non-identities", () => {
  assert.equal(canonicalIdentitySlug("pokemon/151/006/charizard-ex/psa-10"), "pokemon/151/6/charizard-ex/psa-10");
  assert.equal(canonicalIdentitySlug("pokemon/151/025~102/charizard-ex/psa-10"), "pokemon/151/25/charizard-ex/psa-10");
  assert.equal(canonicalIdentitySlug("/i/pokemon/151/006/charizard-ex/psa-10"), "pokemon/151/6/charizard-ex/psa-10");
  // edition and language are re-emitted in canonical order
  assert.equal(canonicalIdentitySlug("pokemon/base-set/4/charizard/psa-9/jp/1st"), "pokemon/base-set/4/charizard/psa-9/1st/jp");
  // a `-` set is NOT invented back
  assert.equal(canonicalIdentitySlug("pokemon/-/6/charizard-ex/psa-10"), "pokemon/-/6/charizard-ex/psa-10");
  assert.equal(canonicalIdentitySlug("not-an-identity"), null);
  for (const s of ["pokemon/151/006/charizard-ex/psa-10", "pokemon/base-set/4/charizard/psa-9/jp/1st"]) {
    const once = canonicalIdentitySlug(s)!;
    assert.equal(canonicalIdentitySlug(once), once, `idempotent: ${s}`);
  }
});

test("every slug identitySlug emits is already canonical (no redirect loop)", () => {
  const cases: CardIdentityParts[] = [
    parts({ set: "Pokemon 151", number: "006/165", cardName: "Charizard ex", grade: "PSA 10" }),
    parts({ set: "One Piece Card Game Promos", number: "ST01-007", cardName: "Monkey D. Luffy", grade: "CGC 9.5" }),
    parts({ set: "Pokemon Game", number: "4", cardName: "Charizard", grade: "Ungraded" }),
    parts({ set: "Pokemon Japanese VSTAR Universe", number: "TG01", cardName: "Pikachu", grade: "PSA 9", edition: "1st Edition" }),
    parts({ number: "25", cardName: "Pikachu", grade: "PSA 10" }),
  ];
  for (const p of cases) {
    const slug = identitySlug("pokemon", p);
    assert.ok(slug, `slug for ${p.cardName}`);
    assert.ok(parseIdentitySlug(slug!), `parses: ${slug}`);
    assert.equal(canonicalIdentitySlug(slug!), slug, `already canonical: ${slug}`);
  }
});
