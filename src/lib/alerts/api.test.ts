import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWatchInput, parseUpdateInput } from "./api";

const base = { email: " Reader@Example.com ", entity_type: "identity", entity_key: "pokemon/base-set/4/charizard/psa-10", kinds: ["floor", "listing"], channel: "email" };

test("create: a valid identity watch, the address normalised", () => {
  const r = parseWatchInput(base, { telegramAvailable: false });
  assert.deepEqual(r, { ok: true, value: { email: "reader@example.com", entityType: "identity", entityKey: base.entity_key, kinds: ["floor", "listing"], channel: "email" } });
});

test("create: kinds must apply to the entity (no floor on an IP, no volume on a card)", () => {
  assert.equal(parseWatchInput({ ...base, entity_type: "ip", entity_key: "pokemon", kinds: ["floor"] }, { telegramAvailable: false }).ok, false);
  assert.equal(parseWatchInput({ ...base, kinds: ["volume"] }, { telegramAvailable: false }).ok, false);
  assert.equal(parseWatchInput({ ...base, kinds: [] }, { telegramAvailable: false }).ok, false);
  assert.equal(parseWatchInput({ ...base, entity_type: "platform", entity_key: "beezie", kinds: ["volume", "clear"] }, { telegramAvailable: false }).ok, true);
});

test("create: telegram only where the deployment has a bot; bad email and type refused", () => {
  assert.equal(parseWatchInput({ ...base, channel: "telegram" }, { telegramAvailable: false }).ok, false);
  assert.equal(parseWatchInput({ ...base, channel: "telegram" }, { telegramAvailable: true }).ok, true);
  assert.equal(parseWatchInput({ ...base, email: "not-an-email" }, { telegramAvailable: false }).ok, false);
  assert.equal(parseWatchInput({ ...base, entity_type: "card" }, { telegramAvailable: false }).ok, false);
});

test("update: token, a uuid and one of three actions", () => {
  const id = "0b7e2f0a-8d2c-4c55-9a51-3b1f4e9d2a10";
  assert.deepEqual(parseUpdateInput({ token: "t", id, action: "pause" }), { ok: true, token: "t", id, action: "pause" });
  assert.equal(parseUpdateInput({ token: "t", id, action: "archive" }).ok, false);
  assert.equal(parseUpdateInput({ token: "t", id: "1; drop table", action: "delete" }).ok, false);
});
