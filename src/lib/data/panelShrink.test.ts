import { test } from "node:test";
import assert from "node:assert/strict";
import { shortVenues } from "./panelShrink";

const rows = (counts: Record<string, number>) =>
  Object.entries(counts).flatMap(([platform, n]) => Array.from({ length: n }, () => ({ platform })));

test("Oct 7: Beezie at 17 sales against 18,385 is short", () => {
  const out = shortVenues(rows({ beezie: 18_385, "collector-crypt": 3_600 }), rows({ beezie: 17, "collector-crypt": 3_650 }));
  assert.deepEqual(out, [{ venue: "beezie", before: 18_385, after: 17 }]);
});

test("a venue that vanished is short", () => {
  assert.deepEqual(shortVenues(rows({ courtyard: 500 }), rows({})), [{ venue: "courtyard", before: 500, after: 0 }]);
});

test("a rolling window that loses a third is not short", () => {
  assert.deepEqual(shortVenues(rows({ "collector-crypt": 3_000 }), rows({ "collector-crypt": 2_000 })), []);
});

test("exactly half is not short", () => {
  assert.deepEqual(shortVenues(rows({ beezie: 400 }), rows({ beezie: 200 })), []);
});

test("a venue below the floor is not checked", () => {
  assert.deepEqual(shortVenues(rows({ dyli: 150 }), rows({ dyli: 3 })), []);
});

test("a venue that joins is never short", () => {
  assert.deepEqual(shortVenues(rows({ beezie: 1_000 }), rows({ beezie: 1_000, renaiss: 5_000 })), []);
});
