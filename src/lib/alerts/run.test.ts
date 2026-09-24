import { test } from "node:test";
import assert from "node:assert/strict";
import { runAlerts, type DirectoryEntry, type RunDeps } from "./run";
import { memoryAlertStore, emptyMemoryData } from "./memoryStore";
import type { AlertSubscription } from "./store";
import type { Readings } from "./readings";
import type { EntityRef, IdentityReading } from "./signals";
import type { Notifier } from "@/lib/notify/types";
import { issueManageToken, type ManageTokenRepo } from "@/lib/subscribe/subscribers";
import { identity, volume, charizard, beezie } from "./fixtures.test-helpers";

const sub = (id: string, subscriberId: string, entity: EntityRef, kinds: AlertSubscription["kinds"], channel: "email" | "telegram" = "email"): AlertSubscription => ({
  id, subscriberId, entityType: entity.type, entityKey: entity.key, kinds, channel, createdAt: "2026-09-01T00:00:00.000Z", pausedAt: null,
});

function readingsWith(floorUsd: number): Readings {
  const idr: IdentityReading = identity({ floor: { priceUsd: floorUsd, venue: "collector-crypt", plausible: true } });
  return {
    identities: new Map([[charizard.key, idr]]),
    volumes: new Map([["platform:beezie", volume()]]),
    sales: { byIdentity: new Map(), byIp: new Map(), byPlatform: new Map(), storeAsOf: "2026-09-24T04:00:00.000Z" },
    timings: {},
  };
}

function harness(opts: { confirmed?: string[]; telegram?: boolean } = {}) {
  const store = memoryAlertStore(
    emptyMemoryData([
      sub("s1", "r1", charizard, ["floor", "listing"]),
      sub("s2", "r1", beezie, ["volume"]),
      sub("s3", "r2", charizard, ["floor"], "telegram"),
      sub("s4", "r-unconfirmed", charizard, ["floor"]),
    ]),
  );
  // Prior state: every floor last fired at $100, the listing set already seen.
  for (const id of ["s1", "s3", "s4"]) store.data.state[id] = { floor: { priceUsd: 100, venue: "collector-crypt", at: "2026-09-20T00:00:00.000Z" }, listing: { seen: ["cc-A"] } };
  const sent: { channel: string; subscriber: string; events: number }[] = [];
  const notifier = (channel: "email" | "telegram", available: boolean): Notifier => ({
    channel,
    available,
    async send(r, d) {
      sent.push({ channel, subscriber: r.subscriberId, events: d.events.length });
      return { ok: true, delivered: true };
    },
  });
  const confirmed = new Set(opts.confirmed ?? ["r1", "r2"]);
  const deps = (now: string, floorUsd: number): RunDeps => ({
    store,
    directory: async (ids) =>
      new Map(ids.filter((id) => confirmed.has(id)).map((id): [string, DirectoryEntry] => [id, { subscriberId: id, email: `${id}@x.invalid`, unsubscribeToken: `u-${id}`, manageToken: `m-${id}` }])),
    resolve: (type, key) => (type === "identity" ? charizard : type === "platform" && key === "beezie" ? beezie : null),
    readings: async () => readingsWith(floorUsd),
    notifiers: { email: notifier("email", true), telegram: notifier("telegram", opts.telegram ?? false) },
    now,
    send: true,
  });
  return { store, sent, deps };
}

test("one digest per reader per channel; an unconfirmed reader's watch stays silent", async () => {
  const h = harness();
  const r = await runAlerts(h.deps("2026-09-24T06:00:00.000Z", 120));
  assert.equal(r.subscriptions, 4);
  assert.equal(r.active, 3); // s4's reader never confirmed
  assert.deepEqual(r.fired, { floor: 2, volume: 1, clear: 0, listing: 0 });
  // r1: floor + volume in ONE email; r2: telegram, unavailable here
  assert.deepEqual(h.sent, [{ channel: "email", subscriber: "r1", events: 2 }]);
  assert.equal(r.undeliverable, 1);
  // Sent events are marked; the undeliverable one is not.
  const bySub = Object.fromEntries(h.store.data.events.map((e) => [e.subscriptionId + ":" + e.kind, !!e.sentAt]));
  assert.deepEqual(bySub, { "s1:floor": true, "s2:volume": true, "s3:floor": false });
});

test("dedupe: a second run on the same day never re-sends; the floor that fired stays the state", async () => {
  const h = harness();
  await runAlerts(h.deps("2026-09-24T06:00:00.000Z", 120));
  const after1 = structuredClone(h.store.data.state.s1.floor);
  // Another 20% move the same day: the signal fires, the fingerprint is taken.
  const r2 = await runAlerts(h.deps("2026-09-24T12:00:00.000Z", 144));
  assert.equal(r2.fired.floor, 0);
  assert.equal(r2.deduped, 2); // s1 and s3 (volume: the same day is judged once by its own state)
  assert.deepEqual(h.store.data.state.s1.floor, after1); // kept: the 144 never fired
  assert.equal(h.sent.length, 1);
});

test("dedupe: after midnight the same move is a new day's alert", async () => {
  const h = harness();
  await runAlerts(h.deps("2026-09-24T18:00:00.000Z", 120));
  const r = await runAlerts(h.deps("2026-09-25T00:30:00.000Z", 144));
  assert.equal(r.fired.floor, 2);
  assert.equal(h.sent.length, 2);
  assert.equal(h.store.data.events.filter((e) => e.kind === "floor").length, 4);
});

test("a dry run inserts, writes and sends nothing", async () => {
  const h = harness();
  const r = await runAlerts({ ...h.deps("2026-09-24T06:00:00.000Z", 120), send: false });
  assert.equal(r.events.length, 3);
  assert.equal(h.store.data.events.length, 0);
  assert.equal(h.sent.length, 0);
  assert.equal(h.store.data.state.s1.floor && (h.store.data.state.s1.floor as { priceUsd: number }).priceUsd, 100);
});

test("the manage token: issued once, the same one after, and one winner under a race", async () => {
  const rows = new Map<string, string | null>([["r1", null]]);
  let minted = 0;
  const mint = () => `tok-${++minted}`;
  const repo: ManageTokenRepo = {
    async get(id) {
      return rows.get(id) ?? null;
    },
    async setIfAbsent(id, t) {
      await new Promise((r) => setTimeout(r, 1)); // let a concurrent issue interleave
      if (rows.get(id)) return false;
      rows.set(id, t);
      return true;
    },
  };
  const [a, b] = await Promise.all([issueManageToken(repo, "r1", mint), issueManageToken(repo, "r1", mint)]);
  assert.equal(a, b);
  assert.equal(await issueManageToken(repo, "r1", mint), a);
  assert.equal(rows.get("r1"), a);
});
