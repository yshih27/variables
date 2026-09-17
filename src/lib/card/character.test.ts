/**
 * Unit table for the character extractor (src/lib/card/character.ts).
 *
 *   npm run test:character        (node's built-in runner through tsx; no
 *                                  framework, no CI job — see the PR)
 *
 * Every case is a string measured in the production identity index on
 * 2026-09-17 (see character.ts's header) or one of the awkward spellings the
 * brief lists. `partners` and `facets` are asserted where the case exists to
 * test them; a case that only names a key asserts the key and the name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { characterOf, characterKeysOf, characterHref, ONE_PIECE_ALIASES } from "./character";

type Expect =
  | null
  | {
      key: string;
      name?: string;
      partners?: string[];
      partnerKeys?: (string | null)[];
      owner?: string;
      form?: string;
      variant?: string;
    };

const CASES: [ip: string, name: string, expect: Expect][] = [
  // ── Pokémon: the measured shapes — year, set, number, grade, edition in the name
  ["pokemon", "CHARIZARD", { key: "charizard", name: "Charizard" }],
  ["pokemon", "CHARIZARD EX", { key: "charizard" }],
  ["pokemon", "CHARIZARD #6", { key: "charizard" }],
  ["pokemon", "2023 CHARIZARD EX #6 151", { key: "charizard" }],
  ["pokemon", "2024 PIKACHU PALDEAN FATES #018", { key: "pikachu", name: "Pikachu", form: undefined }],
  ["pokemon", "1999 POKEMON JUNGLE PIKACHU #60", { key: "pikachu" }],
  ["pokemon", "2004 #040 PIKACHU PSA 10", { key: "pikachu" }],
  ["pokemon", "2015 PIKACHU BREAKTHROUGH #48", { key: "pikachu" }],
  ["pokemon", "1ST EDITION CHARIZARD P", { key: "charizard" }],
  ["pokemon", "BASE SET HOLO CHARIZARD", { key: "charizard" }],
  ["pokemon", "Charizard ex", { key: "charizard" }],
  ["pokemon", "Charizard-Holo", { key: "charizard" }],
  ["pokemon", "UMBREON-GOLD STAR", { key: "umbreon", name: "Umbreon" }],
  ["pokemon", "GRENINJA GX", { key: "greninja" }],
  ["pokemon", "3RD PLACE PIKACHU", { key: "pikachu" }],
  // ── owner prefixes
  ["pokemon", "BLAINE'S CHARIZARD HOLO R ERR", { key: "charizard", owner: "Blaine" }],
  ["pokemon", "BLAINE'S CHARIZARD-HOLO", { key: "charizard", owner: "Blaine" }],
  ["pokemon", "ROCKET'S SCIZOR EX", { key: "scizor", owner: "Rocket" }],
  ["pokemon", "TEAM ROCKET'S MEWTWO EX", { key: "mewtwo", owner: "Team Rocket" }],
  ["pokemon", "LT. SURGE'S ELECTABUZZ", { key: "electabuzz", owner: "Lt. Surge" }],
  ["pokemon", "MISTY'S PSYDUCK", { key: "psyduck", owner: "Misty" }],
  ["pokemon", "ERIKA'S VILEPLUME", { key: "vileplume", owner: "Erika" }],
  ["pokemon", "GIOVANNI'S GYARADOS", { key: "gyarados", owner: "Giovanni" }],
  ["pokemon", "TEAM MAGMA'S GROUDON", { key: "groudon", owner: "Team Magma" }],
  ["pokemon", "ASH'S PIKACHU", { key: "pikachu", owner: "Ash" }],
  ["pokemon", "N's Zoroark ex", { key: "zoroark", owner: "N" }],
  // ── forms
  ["pokemon", "2025 MEGA CHARIZARD X EX #13 PHANTASMAL FLAMES", { key: "charizard", form: "Mega X" }],
  ["pokemon", "M CHARIZARD EX", { key: "charizard", form: "Mega" }],
  ["pokemon", "MEGA GENGAR EX", { key: "gengar", form: "Mega" }],
  ["pokemon", "DARK CHARIZARD", { key: "charizard", form: "Dark" }],
  ["pokemon", "LIGHT DRAGONITE", { key: "dragonite", form: "Light" }],
  ["pokemon", "SHINING MEW", { key: "mew", name: "Mew", form: "Shining" }],
  ["pokemon", "RADIANT CHARIZARD", { key: "charizard", form: "Radiant" }],
  ["pokemon", "GALARIAN PONYTA", { key: "ponyta", form: "Galarian" }],
  ["pokemon", "ALOLAN VULPIX", { key: "vulpix", form: "Alolan" }],
  ["pokemon", "HISUIAN ZOROARK VSTAR", { key: "zoroark", form: "Hisuian" }],
  ["pokemon", "PALDEAN TAUROS", { key: "tauros", form: "Paldean" }],
  // ── variants
  ["pokemon", "FLYING PIKACHU VMAX", { key: "pikachu", variant: "Flying" }],
  ["pokemon", "SURFING PIKACHU", { key: "pikachu", variant: "Surfing" }],
  ["pokemon", "BIRTHDAY PIKACHU", { key: "pikachu", variant: "Birthday" }],
  ["pokemon", "CAPTAIN PIKACHU", { key: "pikachu", variant: "Captain" }],
  ["pokemon", "DETECTIVE PIKACHU", { key: "pikachu", variant: "Detective" }],
  ["pokemon", "PIKACHU WITH GREY FELT HAT", { key: "pikachu", variant: "With Grey Felt Hat" }],
  ["pokemon", "DEOXYS EX TEAM PLASMA", { key: "deoxys", variant: "Team Plasma" }],
  // ── awkward spellings
  ["pokemon", "MR. MIME", { key: "mr-mime", name: "Mr. Mime" }],
  ["pokemon", "MR MIME EX", { key: "mr-mime" }],
  ["pokemon", "MIME JR.", { key: "mime-jr", name: "Mime Jr." }],
  ["pokemon", "FARFETCH'D", { key: "farfetchd", name: "Farfetch’d" }],
  ["pokemon", "FARFETCHD", { key: "farfetchd" }],
  ["pokemon", "SIRFETCH'D V", { key: "sirfetchd" }],
  ["pokemon", "HO-OH GX", { key: "ho-oh", name: "Ho-Oh" }],
  ["pokemon", "TYPE: NULL", { key: "type-null", name: "Type: Null" }],
  ["pokemon", "NIDORAN♀", { key: "nidoran-f", name: "Nidoran♀" }],
  ["pokemon", "NIDORAN F", { key: "nidoran-f" }],
  ["pokemon", "NIDORAN FEMALE", { key: "nidoran-f" }],
  ["pokemon", "NIDORAN♂", { key: "nidoran-m", name: "Nidoran♂" }],
  ["pokemon", "FLABÉBÉ", { key: "flabebe", name: "Flabébé" }],
  ["pokemon", "TAPU KOKO GX", { key: "tapu-koko", name: "Tapu Koko" }],
  ["pokemon", "JANGMO-O", { key: "jangmo-o" }],
  ["pokemon", "PORYGON-Z", { key: "porygon-z", name: "Porygon-Z" }],
  ["pokemon", "PORYGON", { key: "porygon", name: "Porygon" }],
  ["pokemon", "PORYGON2", { key: "porygon2" }],
  ["pokemon", "MEWTWO", { key: "mewtwo", name: "Mewtwo" }],
  ["pokemon", "MEW EX", { key: "mew" }],
  // ── multi-character
  ["pokemon", "BLASTOISE/CHARIZARD", { key: "blastoise", partners: ["Charizard"], partnerKeys: ["charizard"] }],
  ["pokemon", "CHARIZARD & BRAIXEN GX", { key: "charizard", partners: ["Braixen"], partnerKeys: ["braixen"] }],
  ["pokemon", "MEWTWO & MEW GX", { key: "mewtwo", partners: ["Mew"], partnerKeys: ["mew"] }],
  ["pokemon", "ARCEUS & DIALGA & PALKIA GX", { key: "arceus", partners: ["Dialga", "Palkia"], partnerKeys: ["dialga", "palkia"] }],
  ["pokemon", "ASH & PIKACHU-PRISM", { key: "pikachu", partners: [] }],
  // ── a set name that carries a species is not a partner
  ["pokemon", "UMBREON VMAX EEVEE HEROES", { key: "umbreon", partners: [] }],
  // ── nulls: trainers, items, energy
  ["pokemon", "PROFESSOR'S RESEARCH", null],
  ["pokemon", "BOSS'S ORDERS", null],
  ["pokemon", "IONO", null],
  ["pokemon", "RARE CANDY", null],
  ["pokemon", "MISTY'S TEARS", null],
  ["pokemon", "", null],
  // ── One Piece: strip, then the alias table
  ["one_piece", "MONKEY D. LUFFY", { key: "monkey-d-luffy", name: "Monkey D. Luffy" }],
  ["one_piece", "MONKEY D LUFFY PAR/(CHAMPIONSHIP SET 2022)", { key: "monkey-d-luffy" }],
  ["one_piece", "2025 MONKEY.D.LUFFY (FOIL) #14 EX GEAR 5", { key: "monkey-d-luffy", form: "Gear 5" }],
  ["one_piece", "MONKEY D. LUFFY (GEAR 5)", { key: "monkey-d-luffy", form: "Gear 5" }],
  ["one_piece", "MONKEY D. LUFFY P", { key: "monkey-d-luffy" }],
  ["one_piece", "MONKEY D. LUFFY S", { key: "monkey-d-luffy" }],
  ["one_piece", "MONKEY D. LUFFY AL", { key: "monkey-d-luffy" }],
  ["one_piece", "DON!! - MONKEY D. LUFFY", { key: "monkey-d-luffy", variant: "DON!!" }],
  ["one_piece", "LUFFY", { key: "monkey-d-luffy" }],
  ["one_piece", "LUFFY-TAROU ALT ART SP", { key: "monkey-d-luffy" }],
  ["one_piece", "LUFFY C/(CHAMPIONSHIP", { key: "monkey-d-luffy" }],
  ["one_piece", "\"SHIP DOCTOR\" CHOPPER", { key: "tony-tony-chopper", name: "Tony Tony Chopper", variant: "Ship Doctor" }],
  ["one_piece", "TONY TONY.CHOPPER", { key: "tony-tony-chopper" }],
  ["one_piece", "RORONOA ZORO", { key: "roronoa-zoro", name: "Roronoa Zoro" }],
  ["one_piece", "ZORO", { key: "roronoa-zoro" }],
  ["one_piece", "VINSMOKE SANJI", { key: "sanji", name: "Sanji" }],
  ["one_piece", "PORTGAS D. ACE", { key: "portgas-d-ace", name: "Portgas D. Ace" }],
  ["one_piece", "WHITEBEARD", { key: "edward-newgate", name: "Edward Newgate" }],
  ["one_piece", "BIG MOM", { key: "charlotte-linlin", name: "Charlotte Linlin" }],
  ["one_piece", "TRAFALGAR LAW", { key: "trafalgar-law" }],
  ["one_piece", "AKAINU", { key: "sakazuki", name: "Sakazuki" }],
  ["one_piece", "NEFELTARI VIVI", { key: "nefeltari-vivi" }],
  ["one_piece", "EUSTASS\"CAPTAIN\"KID", { key: "eustass-kid", name: "Eustass Kid", variant: "Captain" }],
  ["one_piece", "MR.2.BON.KUREI(BENTHAM)", { key: "bon-clay" }],
  // ── One Piece multi-character and crossovers
  ["one_piece", "ACE & SABO & LUFFY", { key: "portgas-d-ace", partners: ["Sabo", "Monkey D. Luffy"], partnerKeys: ["sabo", "monkey-d-luffy"] }],
  ["one_piece", "ANDROID 18/FRANKY", { key: "franky", partners: ["Android 18"], partnerKeys: [null] }],
  ["one_piece", "KUMAMON & LUFFY", { key: "monkey-d-luffy", partners: ["Kumamon"], partnerKeys: [null] }],
  // ── One Piece: an unaliased name keeps its own key, like an unaliased set
  ["one_piece", "CHARLOTTE OVEN", { key: "charlotte-oven", name: "Charlotte Oven" }],
  // ── One Piece nulls: an event card, a stage, a sentence
  ["one_piece", "LUFFY WILL BECOME KING OF THE PIRATES!!!", null],
  ["one_piece", "THOUSAND SUNNY", null],
  ["one_piece", "I WILL BE THE PIRATE KING", null],
  ["one_piece", "GUM-GUM PISTOL", null],
  // ── other IPs: no extractor yet
  ["yugioh", "BLUE-EYES WHITE DRAGON", null],
  ["basketball", "MICHAEL JORDAN", null],
  ["other", "CHARIZARD", null],
];

test(`characterOf: ${CASES.length} measured cases`, () => {
  assert.ok(CASES.length >= 50, "the unit table must hold at least 50 cases");
  for (const [ip, name, expect] of CASES) {
    const got = characterOf(ip, name);
    const label = `${ip} · ${JSON.stringify(name)}`;
    if (expect === null) {
      assert.equal(got, null, `${label} → expected null, got ${JSON.stringify(got)}`);
      continue;
    }
    assert.ok(got, `${label} → expected ${expect.key}, got null`);
    assert.equal(got.key, expect.key, `${label} key`);
    if (expect.name !== undefined) assert.equal(got.name, expect.name, `${label} name`);
    if (expect.partners !== undefined) assert.deepEqual(got.partners, expect.partners, `${label} partners`);
    if (expect.partnerKeys !== undefined) assert.deepEqual(got.partnerKeys, expect.partnerKeys, `${label} partnerKeys`);
    if ("owner" in expect) assert.equal(got.facets.owner, expect.owner, `${label} owner`);
    if ("form" in expect) assert.equal(got.facets.form, expect.form, `${label} form`);
    if ("variant" in expect) assert.equal(got.facets.variant, expect.variant, `${label} variant`);
    assert.equal(got.partners.length, got.partnerKeys.length, `${label} partners/partnerKeys aligned`);
    assert.match(got.key, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${label} key is a lowercase ASCII slug`);
  }
});

test("characterKeysOf: a multi-character card belongs to every character on it, guests excluded", () => {
  assert.deepEqual(characterKeysOf("pokemon", "CHARIZARD & BRAIXEN GX"), ["charizard", "braixen"]);
  assert.deepEqual(characterKeysOf("one_piece", "ANDROID 18/FRANKY"), ["franky"]);
  assert.deepEqual(characterKeysOf("pokemon", "IONO"), []);
});

test("characterHref follows the sets pattern", () => {
  assert.equal(characterHref("pokemon", "charizard"), "/ip/pokemon/characters/charizard");
  assert.equal(characterHref("one_piece", "monkey-d-luffy"), "/ip/one_piece/characters/monkey-d-luffy");
});

test("ONE_PIECE_ALIASES: keys unique, every alias folds to exactly one character", () => {
  const keys = new Set<string>();
  const aliases = new Map<string, string>();
  for (const [key, , ...as] of ONE_PIECE_ALIASES) {
    assert.ok(!keys.has(key), `duplicate key ${key}`);
    keys.add(key);
    for (const a of as) {
      assert.equal(aliases.get(a), undefined, `alias ${a} folds to both ${aliases.get(a)} and ${key}`);
      aliases.set(a, key);
    }
  }
});

test("characterOf never throws on junk", () => {
  for (const junk of [null, undefined, "", "   ", "!!!", "&", "/", "'S", "(", "\"\"", "♀", "2023 #"]) {
    assert.doesNotThrow(() => characterOf("pokemon", junk));
    assert.doesNotThrow(() => characterOf("one_piece", junk));
  }
});
