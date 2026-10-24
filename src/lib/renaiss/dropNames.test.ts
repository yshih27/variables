import { test } from "node:test";
import assert from "node:assert/strict";
import { dropLabel, RENAISS_DROP_NAMES } from "./dropNames";

const DUO = "e6b242a5-102e-4c5a-9f8d-fcfcb4c7781a"; // the Sep 18 2026 drop

test("the feed's name wins; Varible's fills a drop the feed leaves unnamed; else none", () => {
  assert.deepEqual(dropLabel({ productId: "c1de2240-071f-4bc1-9647-b7042f205865", name: "Lunar Pack", named: true }), { name: "Lunar Pack", source: "feed" });
  assert.deepEqual(dropLabel({ productId: DUO, name: "Unnamed pack · Sep 18", named: false }), { name: "Duo Pack", source: "varible" });
  // Constructed: a feed name for a product we also named.
  assert.deepEqual(dropLabel({ productId: DUO, name: "Duo", named: true }), { name: "Duo", source: "feed" });
  assert.equal(dropLabel({ productId: "b362b8d6-4176-4fd6-97a8-a3d328f41b26", name: "Unnamed pack · Sep 4", named: false }), null);
});

test("five names, each a distinct pack", () => {
  const names = Object.values(RENAISS_DROP_NAMES);
  assert.equal(names.length, 5);
  assert.equal(new Set(names).size, 5);
  for (const n of names) assert.match(n, / Pack$/);
});
