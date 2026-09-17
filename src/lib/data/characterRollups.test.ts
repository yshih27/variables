/**
 * `buildCharacterRollups` on a synthetic panel — the grouping, the KPIs, the
 * per-character share, the multi-character double count, the index gate and
 * the identity rows, all checkable by hand. The production shape is measured
 * by scripts/dev/probe-character-rollups.ts; this pins the arithmetic.
 *
 *   npm run test:character
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCharacterRollups } from "./characterRollups";
import type { SaleRow } from "./salePanel";
import type { IdentityIndex } from "./identityDetail";
import { identityKey, type CardIdentityParts } from "./traits";
import { identitySlug } from "@/lib/card/identity";
import { MIN_IDENTITIES_BROAD } from "./identityIndex";

const NOW = Date.parse("2026-09-17T12:00:00Z");
const DAY = 86_400_000;

function parts(cardName: string, set: string, number: string, grade = "PSA 10"): CardIdentityParts {
  return { year: null, set, number, cardName, grade, edition: null, language: null };
}

type Fixture = { ip: string; p: CardIdentityParts; sales: { daysAgo: number; priceUsd: number; platform: SaleRow["platform"] }[]; slabs?: number };

function build(fixtures: Fixture[]) {
  const panel: SaleRow[] = [];
  const bySlug = new Map<string, string[]>();
  const slabsByKey = new Map<string, { platform: SaleRow["platform"]; tokenId: string }[]>();
  for (const f of fixtures) {
    const key = identityKey(f.ip, f.p)!;
    const slug = identitySlug(f.ip, f.p)!;
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), key]);
    slabsByKey.set(key, Array.from({ length: f.slabs ?? 1 }, (_, i) => ({ platform: f.sales[0]?.platform ?? "beezie", tokenId: `${key}#${i}` })));
    for (const [i, s] of f.sales.entries()) {
      panel.push({
        ts: new Date(NOW - s.daysAgo * DAY).toISOString(),
        tokenId: `${key}#${i % (f.slabs ?? 1)}`,
        priceUsd: s.priceUsd,
        platform: s.platform,
        ip: f.ip,
        set: f.p.set,
        setKey: f.p.set?.toLowerCase().replace(/\s+/g, "-") ?? null,
        grade: f.p.grade,
        identity: key,
      });
    }
  }
  const idx: IdentityIndex = { bySlug, slabsByKey, siblingsOf: new Map() };
  return buildCharacterRollups(panel, idx, { nowMs: NOW, listings: new Map() });
}

test("groups identities by character, computes KPIs, share, monthly, sets, venues and rows", () => {
  const snap = build([
    { ip: "pokemon", p: parts("CHARIZARD EX", "151", "6"), sales: [{ daysAgo: 3, priceUsd: 100, platform: "beezie" }, { daysAgo: 10, priceUsd: 120, platform: "collector-crypt" }, { daysAgo: 45, priceUsd: 90, platform: "beezie" }], slabs: 3 },
    { ip: "pokemon", p: parts("DARK CHARIZARD", "Team Rocket", "4", "PSA 9"), sales: [{ daysAgo: 5, priceUsd: 50, platform: "beezie" }], slabs: 2 },
    { ip: "pokemon", p: parts("PIKACHU", "Base Set", "58"), sales: [{ daysAgo: 1, priceUsd: 30, platform: "beezie" }, { daysAgo: 2, priceUsd: 20, platform: "beezie" }] },
    { ip: "pokemon", p: parts("PROFESSOR'S RESEARCH", "151", "190"), sales: [{ daysAgo: 1, priceUsd: 200, platform: "beezie" }] },
  ]);
  const chz = snap.characters["pokemon:charizard"];
  assert.ok(chz, "charizard rollup exists");
  assert.equal(chz.name, "Charizard");
  assert.equal(chz.identities, 2);
  assert.equal(chz.slabs, 5);
  assert.equal(chz.kpis.sales30d, 3); // 100, 120, 50 — the 45-day-old sale is outside the window
  assert.equal(chz.kpis.volume30d, 270);
  // The IP's 30d resale volume from the SAME panel: 270 + 50 (pikachu) + 200 (the trainer card, still Pokémon resale) = 520.
  assert.ok(Math.abs(chz.kpis.shareOfIp30d - (270 / 520) * 100) < 1e-9, `share ${chz.kpis.shareOfIp30d}`);
  assert.deepEqual(chz.venues.sort(), ["beezie", "collector-crypt"]);
  // monthly: Aug (the 45-day-old sale, complete) and Sep (running, partial)
  assert.equal(chz.monthly.length, 2);
  assert.equal(chz.monthly[0].partial, false);
  assert.equal(chz.monthly[0].sales, 1);
  assert.equal(chz.monthly[1].partial, true);
  assert.equal(chz.monthly[1].sales, 3);
  assert.equal(chz.monthly[1].volumeUsd, 270);
  // sets
  assert.equal(chz.bySet.length, 2);
  assert.equal(chz.bySet[0].setKey, "151");
  assert.equal(chz.bySet[0].volume30d, 220);
  // venues — beezie 2 sales, cc 1; coverage per the identity page's rule
  assert.equal(chz.byVenue[0].platform, "beezie");
  assert.equal(chz.byVenue[0].sales30d, 2);
  assert.equal(chz.byVenue[0].coverage, "aggregator");
  assert.equal(chz.byVenue[1].platform, "collector-crypt");
  assert.equal(chz.byVenue[1].coverage, "native");
  // rows — every identity, by 30d volume, with the extractor's facets
  assert.equal(chz.top.length, 2);
  assert.equal(chz.top[0].name, "Charizard Ex");
  assert.equal(chz.top[0].volume30d, 220);
  assert.equal(chz.top[0].sales, 3);
  assert.equal(chz.top[0].slabs, 3);
  assert.equal(chz.top[0].lastSale?.priceUsd, 100);
  assert.equal(chz.top[0].monthlyPriceUsd, null); // one sale in August < MIN_SALES_PER_IDENTITY
  assert.equal(chz.top[1].facets.form, "Dark");
  assert.equal(chz.top[1].grade, "PSA 9");
  // index gate: far below the floor
  assert.equal(chz.index, null);
  assert.deepEqual(chz.indexGate, { priced: 0, needed: MIN_IDENTITIES_BROAD, held: "below-floor" });
  // the trainer card maps to nothing and is reported
  assert.equal(snap.coverage.pokemon.identities, 4);
  assert.equal(snap.coverage.pokemon.mapped, 3);
  assert.equal(snap.coverage.pokemon.unmappedTop[0].name, "PROFESSOR'S RESEARCH");
  // leaderboard order: charizard 270 > pikachu 50
  assert.deepEqual(snap.byIp.pokemon.map((r) => r.key), ["charizard", "pikachu"]);
  assert.equal(snap.byIp.pokemon[0].indexLatest, null);
});

test("a multi-character card counts under EACH character; shares are not additive", () => {
  const snap = build([
    { ip: "pokemon", p: parts("CHARIZARD & BRAIXEN GX", "Cosmic Eclipse", "22"), sales: [{ daysAgo: 2, priceUsd: 80, platform: "beezie" }] },
    { ip: "pokemon", p: parts("BRAIXEN", "Fates Collide", "12"), sales: [{ daysAgo: 2, priceUsd: 20, platform: "beezie" }] },
  ]);
  const chz = snap.characters["pokemon:charizard"], brx = snap.characters["pokemon:braixen"];
  assert.equal(chz.identities, 1);
  assert.equal(brx.identities, 2);
  assert.equal(chz.multiCharacter, 1);
  assert.equal(brx.multiCharacter, 1);
  assert.equal(chz.kpis.volume30d, 80);
  assert.equal(brx.kpis.volume30d, 100);
  assert.equal(brx.name, "Braixen");
  // Σ share > 100: the tag-team card is in both numerators.
  assert.ok(chz.kpis.shareOfIp30d + brx.kpis.shareOfIp30d > 100);
  assert.deepEqual(chz.top[0].facets.partners, ["Braixen"]);
  assert.deepEqual(brx.top.find((t) => t.name.includes("&"))?.facets.partners, ["Charizard"]);
  assert.equal(snap.coverage.pokemon.multiCharacter, 1);
});

test("the character index publishes only with ≥ MIN_IDENTITIES_BROAD priced identities in the latest complete month", () => {
  // 25 Charizard identities, each sold twice a month for four complete months
  // at a steady price: enough priced identities for the broad floor.
  const fixtures: Fixture[] = [];
  for (let i = 0; i < 25; i++) {
    const sales: Fixture["sales"] = [];
    for (let m = 1; m <= 4; m++) {
      const daysAgo = 20 + (m - 1) * 31; // Aug 28/25, Jul 28/25, Jun 27/24, May 27/24 from Sep 17
      sales.push({ daysAgo, priceUsd: 100 + i, platform: "beezie" }, { daysAgo: daysAgo + 3, priceUsd: 100 + i, platform: "beezie" });
    }
    fixtures.push({ ip: "pokemon", p: parts("CHARIZARD", `Set ${i}`, String(i)), sales });
  }
  const snap = build(fixtures);
  const chz = snap.characters["pokemon:charizard"];
  assert.equal(chz.indexGate.priced, 25);
  assert.equal(chz.indexGate.held, null);
  assert.ok(chz.index && chz.index.length >= 3, "index published");
  assert.equal(chz.index![0].value, 100);
  assert.ok(chz.index!.every((p) => !("obs" in p)), "obs stripped");
  assert.equal(snap.byIp.pokemon[0].indexLatest?.thin, true); // 25 < THIN_MONTH_IDENTITIES
  assert.equal(chz.top[0].monthlyPriceUsd, 124); // identity 24, two sales at 124 in August
  assert.equal(chz.top[0].n, 2);
});

test("One Piece: aliases fold, guests stay out, events are unmapped", () => {
  const snap = build([
    { ip: "one_piece", p: parts("MONKEY.D.LUFFY", "OP01", "003"), sales: [{ daysAgo: 1, priceUsd: 500, platform: "beezie" }] },
    { ip: "one_piece", p: parts("LUFFY", "ST01", "001"), sales: [{ daysAgo: 1, priceUsd: 50, platform: "beezie" }] },
    { ip: "one_piece", p: parts("ANDROID 18/FRANKY", "EB01", "020"), sales: [{ daysAgo: 1, priceUsd: 40, platform: "beezie" }] },
    { ip: "one_piece", p: parts("LUFFY WILL BECOME KING OF THE PIRATES!!!", "OP02", "099"), sales: [{ daysAgo: 1, priceUsd: 10, platform: "beezie" }] },
  ]);
  assert.equal(snap.characters["one_piece:monkey-d-luffy"].identities, 2);
  assert.equal(snap.characters["one_piece:franky"].identities, 1);
  assert.equal(snap.characters["one_piece:android-18"], undefined);
  assert.equal(snap.coverage.one_piece.mapped, 3);
  assert.equal(snap.coverage.one_piece.unmappedTop[0].name, "LUFFY WILL BECOME KING OF THE PIRATES!!!");
  // share denominator is the IP's whole resale, the event card included: 500+50+40+10
  assert.ok(Math.abs(snap.characters["one_piece:monkey-d-luffy"].kpis.shareOfIp30d - (550 / 600) * 100) < 1e-9);
});
