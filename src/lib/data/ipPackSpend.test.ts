/**
 * Pack spend by IP: which machine sells which IP, Renaiss pulls by prize, and
 * the assembly.
 *
 *   npm run test:ip-pack-spend
 *
 * Machine keys and names marked `m` were read off Collector Crypt's machine
 * board on 2026-10-21; `c` are constructed to pin one rule.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIpPackSpend, ccMachineIp, renaissPullIps, type RenaissPackPull } from "./ipPackSpend";
import type { MachineBoard } from "./playerAnalytics";

const cc = (key: string, name?: string) => ccMachineIp(`collector-crypt:${key}`, name ?? `collector-crypt:${key}`);

test("m: single-IP Collector Crypt machines are credited by name or key", () => {
  assert.equal(cc("pokemon_5000", "Celestial Pokémon Gacha Pack"), "pokemon");
  assert.equal(cc("onepiece_250", "One Piece Crew Pack"), "one_piece");
  assert.equal(cc("dragonball_100", "Dragonball 100"), "dragon_ball");
  assert.equal(cc("riftbound_250", "Riftbound 250"), "riftbound");
  assert.equal(cc("soccer_100", "Soccer $100 Pack"), "soccer");
  assert.equal(cc("football_250", "Football 250 Pack"), "football");
  assert.equal(cc("basketball_100", "Basketball 100 Gacha Pack"), "basketball");
  assert.equal(cc("baseball_250", "Baseball 250 Gacha Pack"), "baseball");
  assert.equal(cc("pokemon_300"), "pokemon"); // name falls back to the key
});

test("m: event machines read their theme from the key", () => {
  assert.equal(cc("ejup_poke_100"), "pokemon");
  assert.equal(cc("esfpoke_3000"), "pokemon");
  assert.equal(cc("esnorlax_5000"), "pokemon");
  assert.equal(cc("bf_soccer25"), "soccer");
  assert.equal(cc("comic_250"), "comics");
});

test("m: mixed machines are not credited, watches before Pokémon", () => {
  assert.equal(cc("ewatch_500", "WATCH 500"), null);
  assert.equal(cc("ewatches_500"), null);
  assert.equal(cc("epokewatch_2000"), null); // pays out watches
  assert.equal(cc("pokewatch_50_jup1"), null);
  assert.equal(cc("sports_100", "Sports Gacha Pack"), null);
  assert.equal(cc("sports_500", "All-Star Sports Gacha Pack 500"), null);
  assert.equal(cc("e10_10", "PSA 10's ONLY 10/10 Day"), null);
  assert.equal(cc("anime_75", "Anime Pop Culture Gacha"), null);
  assert.equal(cc("degen_100"), null);
  assert.equal(cc("evintage_80"), null);
});

const pull = (machine: string, card: string | null, price = 50, at = "2026-10-15T12:00:00Z"): RenaissPackPull => ({ product_id: machine, price_usd: price, pulled_at: at, prize_card_name: card, prize_set_name: null });

test("c: a Renaiss trainer prize takes its machine's IP only when the machine is ≥95% one IP", () => {
  const pure = [...Array.from({ length: 19 }, () => pull("A", "Pikachu ex")), pull("A", "Lillie's Determination")];
  assert.deepEqual(renaissPullIps(pure).slice(-1), ["pokemon"]);
  const mixed = [...Array.from({ length: 6 }, () => pull("B", "Pikachu ex")), ...Array.from({ length: 4 }, () => pull("B", "Monkey D. Luffy")), pull("B", "Lillie's Determination")];
  assert.deepEqual(renaissPullIps(mixed).slice(-1), [null]);
});

test("c: assembly credits by venue, keeps the 7-day share, and reports coverage", () => {
  const board: MachineBoard = {
    windowDays: 30,
    asOf: "2026-10-20T00:00:00.000Z",
    rows: [
      { key: "collector-crypt:soccer_100", name: "Soccer $100 Pack", priceUsd: 100, pulls: 10, spendUsd: 1000, spend7dUsd: 300, pulls24h: 1 },
      { key: "collector-crypt:ewatch_500", name: "WATCH 500", priceUsd: 500, pulls: 2, spendUsd: 1000, spend7dUsd: 500, pulls24h: 0 },
    ],
  } as MachineBoard;
  const end = Date.parse("2026-10-21T00:00:00Z");
  const snap = buildIpPackSpend({
    ccBoard: board,
    renaissPulls: [pull("A", "Pikachu ex", 50, "2026-10-19T08:00:00Z"), pull("A", "Pikachu ex", 50, "2026-10-01T08:00:00Z"), pull("A", "Pikachu ex", 50, "2026-09-01T08:00:00Z")],
    windowEndMs: end,
    venueTotals: { "collector-crypt": 5000, renaiss: 200, courtyard: 9000 },
    generatedAt: "2026-10-21T01:00:00Z",
  });
  assert.deepEqual(snap.byIp.soccer, { usd30d: 1000, usd7d: 300, byVenue: { "collector-crypt": { usd30d: 1000, usd7d: 300 } } });
  assert.deepEqual(snap.byIp.pokemon, { usd30d: 100, usd7d: 50, byVenue: { renaiss: { usd30d: 100, usd7d: 50 } } }); // Sep 1 is outside 30 days
  assert.equal(snap.venues["collector-crypt"].creditedUsd30d, 1000); // the watch machine is not credited
  assert.equal(snap.venues["collector-crypt"].packSpend30dUsd, 5000);
  assert.equal(snap.venues.courtyard.creditedUsd30d, 0);
  assert.equal(snap.venues.courtyard.basis, "no pull feed");
});
