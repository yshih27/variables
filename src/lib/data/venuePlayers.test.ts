import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVenuePlayers } from "./venuePlayers";
import { firstMonths, monthlyPlayersFrom, type PlatformPlayerAnalytics } from "./playerAnalytics";

const venue = (platform: string, rows: [string, number, number][]): PlatformPlayerAnalytics =>
  ({ platform, monthlyPlayers: rows.map(([month, players, firstTime]) => ({ month, players, firstTime })) }) as PlatformPlayerAnalytics;

test("drops the records' first month and the month in progress; latest month's players sort the rows", () => {
  const rows = buildVenuePlayers(
    [
      venue("small", [["2026-08", 10, 10], ["2026-09", 20, 5], ["2026-10", 3, 1]]),
      venue("big", [["2026-07", 100, 100], ["2026-08", 90, 30], ["2026-09", 80, 20], ["2026-10", 9, 2]]),
    ],
    ["small", "big", "none"],
    Date.parse("2026-10-15T00:00:00Z"),
  );
  assert.deepEqual(rows.map((r) => r.venue), ["big", "small", "none"]);
  assert.deepEqual(rows[0].months.map((m) => m.month), ["2026-08", "2026-09"], "Jul = records begin, Oct = in progress");
  assert.equal(rows[0].months[1].returning, 60);
  assert.equal(rows[0].since, "2026-07");
  assert.deepEqual(rows[1].months.map((m) => [m.month, m.returning]), [["2026-09", 15]]);
  assert.equal(rows[2].measured, false);
});

test("first-time counts each wallet once, in the month of its earliest pull", () => {
  const firstAt = (iso: string) => ({ firstAt: Date.parse(iso) });
  const byMonth = firstMonths([firstAt("2026-08-03T00:00:00Z"), firstAt("2026-09-01T00:00:00Z"), firstAt("2026-09-30T23:00:00Z")]);
  const rows = monthlyPlayersFrom(
    new Map([
      ["2026-09", new Set(["a", "b", "c"])],
      ["2026-08", new Set(["a"])],
    ]),
    byMonth,
  );
  assert.deepEqual(rows, [
    { month: "2026-08", players: 1, firstTime: 1 },
    { month: "2026-09", players: 3, firstTime: 2 },
  ]);
});
