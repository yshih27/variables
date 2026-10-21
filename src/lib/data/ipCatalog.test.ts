/**
 * American football vs soccer, and short codes as whole words.
 *
 *   npm run test:ip-catalog
 *
 * Hints are built the way cardRowFromMeta builds them: the token name, then
 * every attribute value. Rows marked `m` were read off the production `cards`
 * table on 2026-10-20 (the three that were misfiled, and typical rows from each
 * side); `c` are constructed to pin one rule.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { IP_CATALOG } from "./ipCatalog";
import { classifyIP } from "./ipClassify";

const ip = (...hints: string[]) => classifyIP(hints).key;

test("m: a soccer card whose set says 'Footballers' is soccer, not NFL", () => {
  assert.equal(
    ip("2023 #PF8 Lamine Yamal PSA 10 To", "Card", "Soccer", "2023", "Topps Finest UEFA Club Competitions Prized Footballers"),
    "soccer",
  );
});

test("m: 'nfl' inside a word is not the NFL", () => {
  assert.equal(ip("2019 #NA Brent Spiner PSA 9 Star", "Card", "Non-Sport", "Star Trek Inflexions Other Autographs"), "other");
});

test("m: the venue's own 'Football' label on NFL cards stays American football", () => {
  assert.equal(ip("2021 #GM3 Tom Brady PSA 9 Panini", "Card", "Football", "2021", "Panini Prizm"), "football");
  assert.equal(ip("1984 Topps John Elway #63 PSA 7", "Topps", "1984", "PSA", "7", "John Elway", "Football"), "football");
});

test("m: soccer rows from both venues stay soccer", () => {
  assert.equal(ip("2023 #54 Lamine Yamal PSA 9 Pani", "Card", "Soccer", "2023", "Panini Donruss FIFA"), "soccer");
  assert.equal(ip("2019 Topps Chrome UCL Erling Haaland #74 PSA 10", "Topps Chrome UCL", "Erling Haaland", "Soccer"), "soccer");
});

test("c: a soccer card a venue labels 'Football' is soccer when a soccer marker is present", () => {
  assert.equal(ip("2022 Panini Prizm Premier League Bukayo Saka #10 PSA 10", "Football"), "soccer");
  assert.equal(ip("2023 Topps Chrome UEFA Jude Bellingham", "Football"), "soccer");
  assert.equal(ip("2022-23 Merlin Chrome UCC Arda Guler Autograph", "Football"), "soccer");
});

test("c: short codes match whole words only", () => {
  assert.equal(ip("2020 Panini NFL Contenders"), "football");
  assert.equal(ip("UCLA Bruins College Football"), "football"); // "ucl" inside UCLA is not the Champions League
  assert.equal(ip("2019 Panini NBA Hoops"), "basketball");
  assert.equal(ip("MLS Next Pro"), "soccer");
});

test("m: a named F1 driver is F1 whatever sport the venue filed him under", () => {
  assert.equal(ip("2010 #129 Michael Schumacher PSA", "Card", "Soccer", "2010"), "f1");
  assert.equal(ip("2020 #163 Charles Leclerc PSA 9", "Card", "Misc Sports", "2020", "Topps Chrome Formula 1 Sapphire Edition"), "f1");
});

test("c: a surname alone is not a driver, and a card code is not 'F1'", () => {
  assert.equal(ip("1982 Panini Toni Schumacher", "Soccer"), "soccer"); // the German goalkeeper
  assert.equal(ip("2023 Topps Chrome UEFA #F1 Erling Haaland", "Soccer"), "soccer");
});

test("m: a bare title that names a Pokémon is Pokémon (character fallback)", () => {
  assert.equal(ip("2022 #015 Radiant Charizard PSA"), "pokemon"); // Collector Crypt token with no attributes
  assert.equal(ip("2022 #232 Full Art/Zamazenta V P"), "pokemon");
  assert.equal(ip("Latias Delta Species", "Latias Delta Species", "Holon Research Tower", "041", "2005", "Japanese"), "pokemon"); // Renaiss
  assert.equal(ip("Mew", "Mew", "WotC Promos", "9", "English"), "pokemon");
});

test("m: One Piece cards a venue files under 'Collectible Card Games' are One Piece", () => {
  assert.equal(ip("2024 #OP05-060 Monkey.D.Luffy TA", "Card", "Collectible Card Games", "2024"), "one_piece");
  assert.equal(ip("2025 #002 Edward Newgate PSA 10", "Card", "Collectible Card Games", "2025"), "one_piece");
  assert.equal(ip("2023 #OP05069 Trafalgar Law MANG", "Collectible Card Games"), "one_piece"); // code without the dash
  assert.equal(ip("2024 #OP06118 Roronoa Zoro BGS 9", "Collectible Card Games"), "one_piece");
});

test("m: a title cut mid-name stays Pokémon: '…Hisuian Zoro' is a Zoroark, not Roronoa Zoro", () => {
  assert.equal(ip("2023 #GG56 Full Art/Hisuian Zoro"), "pokemon");
});

test("m: Vibes TCG cards that never say Pudgy are Pudgy Penguins", () => {
  assert.equal(ip("2024 #75 Karate Penguin CGC 10 V", "Card", "Vibes", "2024"), "pudgy_penguins");
});

test("c: the fallback never overrides a pattern, and ordinary words are not characters", () => {
  assert.equal(ip("2023 Prizm Victor Wembanyama Basketball"), "basketball"); // a pattern wins first
  assert.equal(ip("2019 Prizm Kevin Durant"), "other"); // Durant is a species name too; never decides a card
  assert.equal(ip("Persian Rug Collector Card"), "other");
  assert.equal(ip("Law & Order Season 1 Autograph"), "other"); // "Law" alone is not Trafalgar Law
  assert.equal(ip("Digimon ST1-01 Agumon"), "other"); // a Digimon code is not a One Piece code
});

test("c: no bare 'world cup' rule — a hockey World Cup card stays hockey", () => {
  assert.equal(ip("2016 Upper Deck World Cup of Hockey Connor McDavid"), "hockey");
});

test("c: soccer is checked before American football, and IP_CATALOG's display order is unchanged", () => {
  const keys = IP_CATALOG.map((i) => i.key);
  assert.ok(keys.indexOf("football") < keys.indexOf("soccer"), "display order keeps Football (NFL) before Soccer");
  assert.equal(ip("Football", "FIFA"), "soccer");
});
