import { test } from "node:test";
import assert from "node:assert/strict";
import { indexCompletenessCutoff } from "./completeness";

const at = (iso: string) => Date.parse(iso);
const passes = (newestTs: string, cadence: string | undefined, nowIso: string) =>
  Date.parse(newestTs) < indexCompletenessCutoff(cadence, at(nowIso)).cutoffMs;

test("monthly: the closed month passes the day after month-end, mid-week (the Oct 1 false alarm)", () => {
  // Thu Oct 1 2026, 00:21 UTC; the running week began Mon Sep 28.
  assert.equal(passes("2026-09-30T00:00:00.000Z", "monthly", "2026-10-01T00:21:19Z"), true);
  assert.deepEqual(indexCompletenessCutoff("monthly", at("2026-10-01T00:21:19Z")), {
    cutoffMs: at("2026-10-01T00:00:00.000Z"),
    period: "month",
  });
});

test("monthly: a point stamped in the running month fails", () => {
  assert.equal(passes("2026-10-31T00:00:00.000Z", "monthly", "2026-10-15T12:00:00Z"), false);
  assert.equal(passes("2026-10-01T00:00:00.000Z", "monthly", "2026-10-15T12:00:00Z"), false);
});

test("monthly: a month-end on a Saturday passes on the Sunday after (Oct 31 2026)", () => {
  assert.equal(passes("2026-10-31T00:00:00.000Z", "monthly", "2026-11-01T06:00:00Z"), true);
});

test("weekly or undeclared blobs keep the Monday rule", () => {
  // Week-end (Sunday) stamps: the running week's own Sunday fails, last week's passes.
  assert.equal(passes("2026-10-04T00:00:00.000Z", "weekly", "2026-10-01T00:21:19Z"), false);
  assert.equal(passes("2026-09-27T00:00:00.000Z", "weekly", "2026-10-01T00:21:19Z"), true);
  assert.equal(indexCompletenessCutoff(undefined, at("2026-10-01T00:21:19Z")).period, "week");
});
