/**
 * The spine's per-IP daily wallets/cards and the stale-row rule.
 *
 *   npm run test:ip-coverage
 *
 * Sales and stored rows are constructed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ipWalletsCardsByDay, staleIpDays } from "./ipDailyFlow";
import type { NormalizedSale } from "@/lib/rarible/queries";

const sale = (date: string, tokenId: string, buyer: string, seller: string): NormalizedSale => ({ date, tokenId, buyer, seller, priceUsd: 10 });
const D20 = "2026-10-20T00:00:00.000Z";
const D19 = "2026-10-19T00:00:00.000Z";

test("wallets and cards per IP per day, across venues, matched sales only", () => {
  const out = ipWalletsCardsByDay([
    {
      platform: "collector-crypt",
      sales: [
        sale("2026-10-20T03:00:00Z", "mintA", "solBuyer1", "solSeller1"),
        sale("2026-10-20T09:00:00Z", "mintA", "solSeller1", "solBuyer1"), // same card, same two wallets
        sale("2026-10-20T10:00:00Z", "mintZ", "solBuyer2", "solSeller2"), // no cards row
      ],
      dims: new Map([["mintA", { ip: "pokemon" }]]),
    },
    {
      platform: "beezie",
      // Token id "mintA" on another venue is another card.
      sales: [sale("2026-10-20T12:00:00Z", "mintA", "0xbuyer", "0xseller")],
      dims: new Map([["mintA", { ip: "pokemon" }]]),
    },
  ]);
  const pkm = out.get(D20)?.get("pokemon");
  assert.ok(pkm);
  assert.equal(pkm.wallets.size, 4); // solBuyer1, solSeller1, 0xbuyer, 0xseller
  assert.equal(pkm.cards.size, 2); // collector-crypt:mintA, beezie:mintA
  // The unmatched sale reaches no IP, "other" included.
  assert.equal(out.get(D20)?.has("other"), false);
  assert.equal(out.get(D20)?.size, 1);
});

test("stale rows: stored, inside the rewrite window, not computed this run", () => {
  const stored = new Map([
    // Postgres hands timestamps back as +00:00; days still match.
    ["other", [{ ts: "2026-10-19T00:00:00+00:00", value: 120 }, { ts: "2026-10-20T00:00:00+00:00", value: 80 }]],
    ["pokemon", [{ ts: "2026-10-20T00:00:00+00:00", value: 5000 }]],
    // Outside the window: left alone.
    ["soccer", [{ ts: "2026-09-01T00:00:00+00:00", value: 40 }]],
    // Already 0: nothing to write.
    ["hockey", [{ ts: "2026-10-19T00:00:00+00:00", value: 0 }]],
  ]);
  const fresh = new Map<string, Map<string, unknown>>([
    [D20, new Map([["pokemon", {}], ["other", {}]])],
    [D19, new Map([["pokemon", {}]])],
  ]);
  const inWindow = (day: string) => day >= "2026-09-22";
  // Oct 19: other had a stored value but no matched sale now → zero it.
  assert.deepEqual(staleIpDays(stored, fresh, inWindow), [{ key: "other", day: D19 }]);
});
