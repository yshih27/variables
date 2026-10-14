import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVenueMix } from "./venueMix";
import type { SeriesPoint } from "./metricSnapshots";

const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString());
const series = (from: string, values: number[]): SeriesPoint[] => days(from, values.length).map((ts, i) => ({ ts, value: values[i] }));

test("one big sale carries the window share; the median day does not move", () => {
  const steady = { market: series("2026-10-01", [10, 10, 10, 10]), packs: series("2026-10-01", [90, 90, 90, 90]) };
  const lumpy = { market: series("2026-10-01", [1, 1, 1_000, 1]), packs: series("2026-10-01", [99, 99, 99, 99]) };
  const mix = buildVenueMix(
    { steady: steady.market, lumpy: lumpy.market },
    { steady: steady.packs, lumpy: lumpy.packs, packsOnly: series("2026-10-01", [50, 50, 50, 50]) },
    ["steady", "lumpy", "packsOnly"],
    4,
  )!;
  assert.deepEqual([mix.from, mix.to], ["2026-10-01", "2026-10-04"]);
  assert.deepEqual(mix.rows.map((r) => r.venue), ["lumpy", "steady", "packsOnly"], "by window share; no source last");
  const lumpyRow = mix.rows[0];
  assert.ok(lumpyRow.marketPct! > 70, "the window share is carried by one day");
  assert.equal(lumpyRow.typicalPct, 1, "the median day is 1%");
  assert.equal(mix.rows[1].marketPct, 10);
  assert.equal(mix.rows[1].typicalPct, 10);
  const packsOnly = mix.rows[2];
  assert.equal(packsOnly.marketUsd, null, "no marketplace source is null, never 0");
  assert.equal(packsOnly.marketPct, null);
  assert.ok(packsOnly.daily.every((d) => d.pct === null));
});

test("every venue covers the same days: the window ends on the earliest complete day", () => {
  const mix = buildVenueMix(
    { a: series("2026-10-01", [1, 1, 1, 1, 1]), b: series("2026-10-01", [1, 1, 1]) },
    { a: series("2026-10-01", [1, 1, 1, 1, 1]), b: series("2026-10-01", [1, 1, 1]) },
    ["a", "b"],
    2,
  )!;
  assert.equal(mix.to, "2026-10-03");
  assert.deepEqual(mix.rows[0].daily.map((d) => d.day), ["2026-10-02", "2026-10-03"]);
});
