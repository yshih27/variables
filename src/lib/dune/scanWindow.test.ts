import test from "node:test";
import assert from "node:assert/strict";
import { scannedCompleteDays } from "./scanWindow";

test("a 30d scan ending mid-day covers 29 complete days: the partial first day and the running day are out", () => {
  const days = scannedCompleteDays("2026-09-21T11:12:00Z", 30);
  assert.equal(days.length, 29);
  assert.equal(days[0], "2026-08-23T00:00:00.000Z"); // window opened 2026-08-22T11:12 → first COMPLETE day is the 23rd
  assert.equal(days[days.length - 1], "2026-09-20T00:00:00.000Z"); // the 21st had not ended at 11:12
});

test("an execution exactly at midnight covers the day that just ended", () => {
  const days = scannedCompleteDays("2026-09-22T00:00:00Z", 30);
  assert.equal(days[days.length - 1], "2026-09-21T00:00:00.000Z");
});

test("no execution time → no coverage claimed", () => {
  assert.deepEqual(scannedCompleteDays(null, 30), []);
  assert.deepEqual(scannedCompleteDays("not a date", 30), []);
});
