import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVenuePlayers } from "./venuePlayers";
import { firstMonths, monthlyPlayersFrom, type PlatformPlayerAnalytics } from "./playerAnalytics";

const venue = (platform: string, rows: [string, number, number, number][]): PlatformPlayerAnalytics =>
  ({
    platform,
    coverage: { rows: 1, walletAttributedRows: 1, pricedRows: 1, firstPullAt: null, lastPullAt: null },
    monthly: [],
    monthlyPlayers: rows.map(([month, players, firstTime, spendUsd]) => ({ month, players, firstTime, spendUsd })),
  }) as unknown as PlatformPlayerAnalytics;
/** One point mid-month per month: the venue's pack spend. */
const spend = (byMonth: Record<string, number>) => Object.entries(byMonth).map(([m, value]) => ({ ts: `${m}-15T00:00:00Z`, value }));

test("a month is drawn only from half coverage; the first covered month and the month in progress are not", () => {
  const rows = buildVenuePlayers(
    [
      // Records arrive in June: 0.1% of the venue before, then 50%, then 75%.
      venue("late", [["2026-05", 285, 249, 100], ["2026-06", 5672, 5392, 500], ["2026-07", 10408, 8255, 750], ["2026-08", 7968, 5089, 750], ["2026-10", 10, 1, 999]]),
      // Never above a third of the venue.
      venue("thin", [["2026-07", 3322, 2722, 35], ["2026-08", 7152, 6059, 16]]),
      // The venue's own feed: every month covered.
      venue("whole", [["2026-06", 1032, 608, 100], ["2026-07", 864, 348, 100], ["2026-08", 865, 277, 100]]),
    ],
    {
      late: spend({ "2026-05": 100_000, "2026-06": 1000, "2026-07": 1000, "2026-08": 1000, "2026-10": 1000 }),
      thin: spend({ "2026-07": 100, "2026-08": 100 }),
      whole: spend({ "2026-06": 100, "2026-07": 100, "2026-08": 100 }),
    },
    ["late", "thin", "whole", "none"],
    Date.parse("2026-10-15T00:00:00Z"),
  );
  assert.deepEqual(rows.map((r) => [r.venue, r.measured]), [["late", true], ["whole", true], ["thin", false], ["none", false]]);
  const late = rows[0];
  assert.equal(late.since, "2026-06", "June is the first month at half coverage");
  assert.deepEqual(late.months.map((m) => m.month), ["2026-07", "2026-08"], "not May (0.1%), not June (records begin), not October (in progress)");
  assert.deepEqual(late.coverage, { min: 75, max: 75 });
  assert.equal(late.months[1].returning, 7968 - 5089);
  assert.equal(rows[2].reason, "our records cover under half its pack spend");
  assert.equal(rows[3].reason, "no wallet-level pulls");
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
    new Map([["2026-09", 30]]),
  );
  assert.deepEqual(rows, [
    { month: "2026-08", players: 1, firstTime: 1, spendUsd: 0 },
    { month: "2026-09", players: 3, firstTime: 2, spendUsd: 30 },
  ]);
});
