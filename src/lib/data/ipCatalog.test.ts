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
import { classifyIP, IP_CATALOG } from "./ipCatalog";

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

test("c: no bare 'world cup' rule — a hockey World Cup card stays hockey", () => {
  assert.equal(ip("2016 Upper Deck World Cup of Hockey Connor McDavid"), "hockey");
});

test("c: soccer is checked before American football, and IP_CATALOG's display order is unchanged", () => {
  const keys = IP_CATALOG.map((i) => i.key);
  assert.ok(keys.indexOf("football") < keys.indexOf("soccer"), "display order keeps Football (NFL) before Soccer");
  assert.equal(ip("Football", "FIFA"), "soccer");
});
