/**
 * Closed pack feeds: the registry and the date it prints.
 *
 *   npm run test:resale-feeds
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { closedPackFeed, lastSeriesDay } from "./packFeedState";

test("a listed venue's pack feed is closed; others are not", () => {
  assert.ok(closedPackFeed("beezie"));
  assert.equal(closedPackFeed("collector-crypt"), null);
});

test("the date shown is the series' own last day, whatever the row order", () => {
  const s = [
    { ts: "2026-10-18T00:00:00.000Z", value: 331600 },
    { ts: "2026-10-19T00:00:00.000Z", value: 29050 },
    { ts: "2026-10-17T00:00:00.000Z", value: 70760 },
    { ts: "not a date", value: 1 },
  ];
  assert.equal(lastSeriesDay(s), "2026-10-19T00:00:00.000Z");
  assert.equal(lastSeriesDay([]), null);
});
