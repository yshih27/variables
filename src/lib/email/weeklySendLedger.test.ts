import { test } from "node:test";
import assert from "node:assert/strict";
import { pendingRecipients, recordSent, ledgerKey, type WeeklySendLedger } from "./weeklySendLedger";

const empty: WeeklySendLedger = { weekStart: "2026-09-14", sent: [], updatedAt: "1970-01-01T00:00:00.000Z" };
const people = [{ id: "a" }, { id: "b" }, { id: "c" }];

test("the ledger is keyed per report week", () => {
  assert.equal(ledgerKey("2026-09-14T00:00:00.000Z"), "weekly-report-send:2026-09-14");
});

test("a re-run skips everyone already sent; a half-finished run resumes", () => {
  assert.deepEqual(pendingRecipients(people, empty), { pending: people, skipped: 0 });
  const half = recordSent(empty, "a", "2026-09-14T08:10:00Z");
  assert.deepEqual(pendingRecipients(people, half), { pending: [{ id: "b" }, { id: "c" }], skipped: 1 });
  const all = ["b", "c"].reduce((l, id) => recordSent(l, id, "2026-09-14T08:11:00Z"), half);
  assert.deepEqual(pendingRecipients(people, all), { pending: [], skipped: 3 });
});

test("recording the same id twice is a no-op", () => {
  const once = recordSent(empty, "a", "t1");
  assert.equal(recordSent(once, "a", "t2"), once);
});
