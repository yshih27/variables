import { test } from "node:test";
import assert from "node:assert/strict";
import { boxRows } from "./venueBoxes";
import type { GachaPack } from "./gachaPacksCache";

const pack = (platform: string, name: string, priceUsd: number, pulls7d: number | null): GachaPack =>
  ({ id: `${platform}:${name}`, platform, name, priceUsd, pulls7d }) as GachaPack;

test("one venue's boxes, busiest first, then cheapest, unpulled boxes last", () => {
  const rows = boxRows(
    [
      pack("dyli", "Watch Box", 250, 0),
      pack("collector-crypt", "PKMN 50", 50, 900),
      pack("dyli", "PSA 10s Only", 60, 239),
      pack("dyli", "Vibes Set 2 Box", 1, 0),
      pack("dyli", "Slab Starter", 35, 467),
      pack("dyli", "No feed count", 20, null),
    ],
    "dyli",
  );
  assert.deepEqual(
    rows.map((p) => p.name),
    ["Slab Starter", "PSA 10s Only", "Vibes Set 2 Box", "Watch Box", "No feed count"],
  );
});
