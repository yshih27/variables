import { test } from "node:test";
import assert from "node:assert/strict";
import type { EconomicsBoard, EconomicsPlatform } from "@/lib/types";
import { economicsHeroModel, weeklyPayoutRatio } from "./economicsHero";
import { economicsCoverage, legCountChip, ratioCountChip } from "./economicsCoverage";
import { netHeldReasonFor } from "@/lib/metrics/outboundDisclosure";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const DAY = 86_400_000;

/** 21 complete days, Sep 21 → Oct 11 (three full Monday weeks). */
const days = (usd: number) =>
  Array.from({ length: 21 }, (_, i) => ({ ts: new Date(Date.parse("2026-09-21T00:00:00Z") + i * DAY).toISOString(), value: usd }));

const venue = (o: Partial<EconomicsPlatform> & Pick<EconomicsPlatform, "key">): EconomicsPlatform => ({
  name: o.key,
  spend30d: 0,
  outbound30d: null,
  ratioPct30d: null,
  ratioPctPrior30d: null,
  r3VerifiedPct30d: null,
  net30d: null,
  heldReason: null,
  ratioHeld: null,
  disclosure: "gross",
  players: null,
  partnerAttributedPct: null,
  spendDaily: [],
  outboundDaily: [],
  ...o,
});

// Oct 13 measured shape: CC's ratio stands; Courtyard publishes outbound > spend
// (buybacks include cards from card-paid packs) and its ratio is held.
const cc = venue({ key: "collector-crypt", spend30d: 30e6, outbound30d: 27e6, ratioPct30d: 90, spendDaily: days(1e6), outboundDaily: days(0.9e6) });
const courtyard = venue({
  key: "courtyard",
  spend30d: 53.4e6,
  outbound30d: 57.6e6,
  ratioHeld: "unpriced-spend",
  heldReason: "unpriced-spend",
  spendDaily: days(1.78e6),
  outboundDaily: days(1.92e6),
});
const beezie = venue({ key: "beezie", spend30d: 3.3e6, heldReason: "unsourced", spendDaily: days(0.11e6) });

test("a venue whose ratio is held draws no weekly ratio", () => {
  assert.deepEqual(weeklyPayoutRatio(courtyard, NOW), []);
});

test("a venue whose ratio stands draws its weekly ratio from the two legs", () => {
  const pts = weeklyPayoutRatio(cc, NOW);
  assert.equal(pts.length, 3);
  for (const p of pts) assert.ok(Math.abs(p.v - 90) < 1e-9, `${p.ts} ${p.v}`);
});

test("the hero overlay leaves the held venue's outbound out", () => {
  const { overlay } = economicsHeroModel([cc, courtyard, beezie]);
  assert.ok(overlay);
  // (0.9M) ÷ (1M + 1.78M + 0.11M), not (0.9M + 1.92M) ÷ the same spend.
  const want = (0.9e6 / (1e6 + 1.78e6 + 0.11e6)) * 100;
  for (const p of overlay.points) assert.ok(Math.abs(p.value - want) < 1e-9, `${p.ts} ${p.value}`);
});

test("the ratio chip counts ratio venues, not outbound venues", () => {
  const board = { platforms: [cc, courtyard, beezie] } as EconomicsBoard;
  const cov = economicsCoverage(board);
  assert.equal(legCountChip(cov, "outbound"), "2 of 3 venues");
  assert.equal(ratioCountChip(cov), "1 of 3 venues");
});

test("net hold: Courtyard (gross outbound only, card-paid packs) is unpriced-spend, not unsourced", () => {
  const base = { payoutSourced: false, grossSourced: true, unpricedPacks30d: 198_262, eligible: true, r3Basis: false };
  assert.equal(netHeldReasonFor(base), "unpriced-spend");
  // No outbound leg at all: still unsourced, whatever the spend side looks like.
  assert.equal(netHeldReasonFor({ ...base, grossSourced: false }), "unsourced");
  // No card-paid packs: the old ladder, unchanged.
  assert.equal(netHeldReasonFor({ ...base, unpricedPacks30d: 0 }), "unsourced");
  assert.equal(netHeldReasonFor({ payoutSourced: true, grossSourced: true, unpricedPacks30d: null, eligible: false, r3Basis: true }), "reconciliation");
  assert.equal(netHeldReasonFor({ payoutSourced: true, grossSourced: true, unpricedPacks30d: null, eligible: true, r3Basis: false }), "awaiting-r3-basis");
});
