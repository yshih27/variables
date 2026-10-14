import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVenuePrices } from "./venuePrices";
import type { GachaPack } from "./gachaPacksCache";

const pack = (platform: string, name: string, priceUsd: number, pulls24h: number | null, pulls7d?: number | null, est = false): GachaPack =>
  ({ id: `${platform}:${name}`, platform, name, priceUsd, pulls24h, pulls7d, pulls24hEstimated: est }) as GachaPack;

test("each price weighted by its share of the venue's own spend, over the venue's own window", () => {
  const rows = buildVenuePrices(
    [
      pack("weekly", "Cheap", 28, 5, 600),
      pack("weekly", "Mid", 48, 9, 400),
      pack("daily", "A", 25, 100, null, true),
      pack("daily", "B", 25, 50, null, true),
      pack("daily", "Big", 5000, 1, null, true),
      pack("claws", "Claw", 30, null, null),
    ],
    ["weekly", "daily", "claws", "absent"],
  );
  assert.deepEqual(rows.map((r) => [r.venue, r.window, r.estimated]), [
    ["weekly", "7d", false],
    ["daily", "24h", true],
    ["claws", null, false],
  ]);
  const weekly = rows[0].points;
  assert.equal(Math.round(weekly[0].spendSharePct!), Math.round((100 * 600 * 28) / (600 * 28 + 400 * 48)), "7d pulls x price");
  const daily = rows[1].points;
  assert.deepEqual(daily.map((p) => p.priceUsd), [25, 5000]);
  assert.deepEqual(daily[0].names, ["A", "B"], "one point per price, busiest first");
  assert.equal(daily[0].pulls, 150);
  assert.equal(Math.round(daily[1].spendSharePct!), Math.round((100 * 5000) / (150 * 25 + 5000)));
  assert.equal(rows[2].points[0].spendSharePct, null, "no pull counts: prices only");
});
