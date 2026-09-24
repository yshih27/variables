import { test } from "node:test";
import assert from "node:assert/strict";
import {
  floorSignal, volumeSignal, clearSignal, listingSignal, fingerprint, composeDigests,
  CLEAR_MIN_USD, type FiredEvent, type AlertEvent,
} from "./signals";
import { DELTA_MIN_BASE_USD } from "@/lib/data/metricSnapshots";
import { NOW, identity, volume, sale, charizard, pokemon, beezie } from "./fixtures.test-helpers";

const firedAt = (price: number) => ({ priceUsd: price, venue: "collector-crypt", at: "2026-09-20T00:00:00.000Z" });

// ── floor ──
test("floor: the first look is a baseline, never an alert", () => {
  const r = floorSignal(identity(), undefined, NOW);
  assert.equal(r.event, null);
  assert.deepEqual(r.state, { priceUsd: 100, venue: "collector-crypt", at: NOW });
});

test("floor: fires at a 10% move either way, not below it", () => {
  for (const [now, fires] of [[110, true], [109.9, false], [90, true], [90.1, false]] as const) {
    const r = floorSignal(identity({ floor: { priceUsd: now, venue: "collector-crypt", plausible: true } }), firedAt(100), NOW);
    assert.equal(!!r.event, fires, `${now} vs 100`);
    if (r.event?.kind === "floor") {
      assert.equal(r.event.payload.change, "moved");
      assert.equal(Math.round(r.event.payload.pct! * 10) / 10, Math.round(((now - 100) / 100) * 1000) / 10);
      assert.deepEqual(r.event.payload.reference, { priceUsd: 100, month: "2026-08", n: 4 });
    }
  }
});

test("floor: measured against the floor LAST FIRED AT, so small drifts accumulate", () => {
  let state = firedAt(100) as ReturnType<typeof floorSignal>["state"];
  const steps = [104, 108, 111];
  const fired = steps.map((p) => {
    const r = floorSignal(identity({ floor: { priceUsd: p, venue: "collector-crypt", plausible: true } }), state, NOW);
    state = r.state;
    return !!r.event;
  });
  assert.deepEqual(fired, [false, false, true]);
});

test("floor: a placeholder ask is no floor — an unplausible ask makes the floor disappear, never a move", () => {
  const r = floorSignal(identity({ floor: { priceUsd: 1.84, venue: "beezie", plausible: false } }), firedAt(100), NOW);
  assert.equal(r.event?.kind, "floor");
  if (r.event?.kind === "floor") {
    assert.equal(r.event.payload.change, "disappeared");
    assert.equal(r.event.payload.to, null);
    assert.equal(r.event.payload.pct, null);
  }
});

test("floor: appearing and disappearing", () => {
  const appeared = floorSignal(identity(), { priceUsd: null, venue: null, at: "2026-09-20T00:00:00.000Z" }, NOW);
  assert.equal(appeared.event?.kind === "floor" && appeared.event.payload.change, "appeared");
  const gone = floorSignal(identity({ floor: null }), firedAt(100), NOW);
  assert.equal(gone.event?.kind === "floor" && gone.event.payload.change, "disappeared");
  // no floor before, none now: nothing
  assert.equal(floorSignal(identity({ floor: null }), { priceUsd: null, venue: null, at: NOW }, NOW).event, null);
});

// ── volume ──
test("volume: fires at 2× the seven-day mean, not below", () => {
  assert.equal(volumeSignal(volume({ totalUsd: 200_000 }), undefined).event?.kind, "volume");
  assert.equal(volumeSignal(volume({ totalUsd: 199_999 }), undefined).event, null);
});

test("volume: the noise floor — a spike off a base under DELTA_MIN_BASE_USD is silent", () => {
  assert.equal(volumeSignal(volume({ meanUsd: DELTA_MIN_BASE_USD - 1, totalUsd: 50_000 }), undefined).event, null);
  assert.equal(volumeSignal(volume({ meanUsd: DELTA_MIN_BASE_USD, totalUsd: 2 * DELTA_MIN_BASE_USD }), undefined).event?.kind, "volume");
});

test("volume: needs seven complete base days, and judges a day once", () => {
  assert.equal(volumeSignal(volume({ window: { from: "2026-09-18T00:00:00.000Z", to: "2026-09-22T00:00:00.000Z", days: 5 } }), undefined).event, null);
  const first = volumeSignal(volume(), undefined);
  assert.ok(first.event);
  assert.equal(volumeSignal(volume(), first.state).event, null);
});

test("volume: the payload carries the day, the mean, the window and the split", () => {
  const e = volumeSignal(volume(), undefined).event;
  assert.ok(e?.kind === "volume");
  if (e?.kind === "volume") {
    assert.equal(e.payload.multiple, 2.4);
    assert.equal(e.payload.resaleUsd + (e.payload.packsUsd ?? 0), e.payload.totalUsd);
    assert.equal(e.payload.window.days, 7);
  }
});

// ── clear ──
test("clear (identity): 3× the reference fires, just under does not; no reference, no clear", () => {
  const since = { cursor: "2026-09-23T00:00:00.000Z" };
  const at = "2026-09-23T12:00:00.000Z";
  assert.equal(clearSignal(charizard, [sale(300, at)], identity().reference, since, NOW).event?.kind, "clear");
  assert.equal(clearSignal(charizard, [sale(299.99, at)], identity().reference, since, NOW).event, null);
  assert.equal(clearSignal(charizard, [sale(10_000, at)], null, since, NOW).event, null);
});

test("clear (ip / platform): the named $ line, both sides", () => {
  const since = { cursor: "2026-09-23T00:00:00.000Z" };
  const at = "2026-09-23T12:00:00.000Z";
  assert.equal(clearSignal(pokemon, [sale(CLEAR_MIN_USD, at)], null, since, NOW).event?.kind, "clear");
  assert.equal(clearSignal(pokemon, [sale(CLEAR_MIN_USD - 0.01, at)], null, since, NOW).event, null);
});

test("clear: a baseline, then only sales after the cursor; the cursor moves to the newest sale", () => {
  const sales = [sale(5_000, "2026-09-22T12:00:00.000Z"), sale(6_000, "2026-09-23T12:00:00.000Z")];
  const base = clearSignal(beezie, sales, null, undefined, NOW);
  assert.equal(base.event, null);
  assert.equal(base.state.cursor, "2026-09-23T12:00:00.000Z");
  assert.equal(clearSignal(beezie, sales, null, base.state, NOW).event, null); // already seen
  const r = clearSignal(beezie, [...sales, sale(7_000, "2026-09-24T01:00:00.000Z")], null, base.state, NOW);
  assert.ok(r.event?.kind === "clear" && r.event.payload.sales.length === 1);
});

// ── listing ──
test("listing: a baseline, then a slab not seen before; a placeholder is an unverified ask", () => {
  const base = listingSignal(identity(), undefined);
  assert.equal(base.event, null);
  const r = listingSignal(
    identity({
      listed: [
        { cardId: "cc-A", venue: "collector-crypt", priceUsd: 100, source: "NATIVE" },
        { cardId: "bz-9", venue: "beezie", priceUsd: 1, source: "OPEN_SEA" },
        { cardId: "cc-B", venue: "collector-crypt", priceUsd: 120, source: "NATIVE" },
      ],
    }),
    base.state,
  );
  assert.ok(r.event?.kind === "listing");
  if (r.event?.kind === "listing") {
    assert.deepEqual(r.event.payload.listings.map((l) => [l.cardId, l.plausible]), [["bz-9", false], ["cc-B", true]]);
    assert.equal(r.event.payload.basis?.kind, "reference");
  }
});

test("listing: without a reference the last sale is the basis; with neither, nothing is plausible", () => {
  const r1 = listingSignal(identity({ reference: null }), { seen: [] });
  assert.ok(r1.event?.kind === "listing" && r1.event.payload.basis?.kind === "last-sale");
  const r2 = listingSignal(identity({ reference: null, lastSale: null }), { seen: [] });
  assert.ok(r2.event?.kind === "listing" && r2.event.payload.basis === null && !r2.event.payload.listings[0].plausible);
});

// ── dedupe + digest ──
test("fingerprint: one per kind per entity per subscription per UTC day; midnight starts a new one", () => {
  const a = fingerprint("s1", "floor", charizard, "2026-09-24T00:00:01.000Z");
  assert.equal(a, fingerprint("s1", "floor", charizard, "2026-09-24T23:59:59.000Z"));
  assert.notEqual(a, fingerprint("s1", "floor", charizard, "2026-09-25T00:00:00.000Z"));
  assert.notEqual(a, fingerprint("s2", "floor", charizard, "2026-09-24T12:00:00.000Z"));
  assert.notEqual(a, fingerprint("s1", "listing", charizard, "2026-09-24T12:00:00.000Z"));
});

test("digest: N events → ONE digest per reader per channel, biggest move first", () => {
  const ev = (sub: string, e: AlertEvent): FiredEvent => ({ ...e, subscriptionId: sub, fingerprint: `${sub}:${e.kind}`, firedAt: NOW });
  const events = [
    ev("s1", volumeSignal(volume({ totalUsd: 210_000 }), undefined).event!),
    ev("s2", floorSignal(identity({ floor: { priceUsd: 150, venue: "collector-crypt", plausible: true } }), firedAt(100), NOW).event!),
    ev("s3", listingSignal(identity(), { seen: [] }).event!),
    ev("s4", volumeSignal(volume(), undefined).event!),
  ];
  const subs: Record<string, { subscriberId: string; channel: "email" | "telegram" }> = {
    s1: { subscriberId: "r1", channel: "email" },
    s2: { subscriberId: "r1", channel: "email" },
    s3: { subscriberId: "r1", channel: "email" },
    s4: { subscriberId: "r2", channel: "telegram" },
  };
  const d = composeDigests(events, (id) => subs[id]);
  assert.equal(d.length, 2);
  assert.deepEqual(d[0].events.map((e) => e.kind), ["volume", "floor", "listing"]); // 110% > 50% > 0
  assert.equal(d[1].channel, "telegram");
});
