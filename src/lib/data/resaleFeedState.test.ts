/**
 * Resale-feed state: how a read attempt moves a venue's entry, and which entries
 * count as a closed feed.
 *
 *   npm run test:resale-feeds
 *
 * Error strings are the Beezie client's own (src/lib/beezie/market.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { closedFeedWhy, closedResaleFeed, nextResaleFeedEntry, notReadSince, type ResaleFeedsSnapshot } from "./resaleFeedState";

const CHALLENGE = "Beezie /activity page 0: 403 (Cloudflare challenge)";

test("a refused read keeps the last read and dates the outage from its first failure", () => {
  const read = nextResaleFeedEntry(undefined, { ok: true, at: "2026-10-21T16:24:00Z" });
  assert.deepEqual(read, { lastReadAt: "2026-10-21T16:24:00Z", unavailable: null, unavailableSince: null });
  const first = nextResaleFeedEntry(read, { ok: false, at: "2026-10-22T04:27:00Z", error: CHALLENGE });
  assert.equal(first.lastReadAt, "2026-10-21T16:24:00Z");
  assert.equal(first.unavailableSince, "2026-10-22T04:27:00Z");
  const second = nextResaleFeedEntry(first, { ok: false, at: "2026-10-22T10:30:00Z", error: CHALLENGE });
  assert.equal(second.unavailableSince, "2026-10-22T04:27:00Z"); // the outage keeps its start
  // Reading again closes the outage.
  assert.deepEqual(nextResaleFeedEntry(second, { ok: true, at: "2026-10-25T00:00:00Z" }), {
    lastReadAt: "2026-10-25T00:00:00Z",
    unavailable: null,
    unavailableSince: null,
  });
});

test("with no read recorded, the newest stored sale stands in for the last read", () => {
  const e = nextResaleFeedEntry(undefined, { ok: false, at: "2026-10-22T13:00:00Z", error: CHALLENGE, seedLastReadAt: "2026-10-21T15:58:10Z" });
  assert.equal(e.lastReadAt, "2026-10-21T15:58:10Z");
  // A recorded read always wins over the seed.
  const prev = { lastReadAt: "2026-10-21T16:24:00Z", unavailable: null, unavailableSince: null };
  assert.equal(nextResaleFeedEntry(prev, { ok: false, at: "2026-10-22T13:00:00Z", error: CHALLENGE, seedLastReadAt: "2026-10-01T00:00:00Z" }).lastReadAt, "2026-10-21T16:24:00Z");
});

test("only bot protection counts as a closed feed; a passing failure does not", () => {
  const snap: ResaleFeedsSnapshot = {
    generatedAt: "2026-10-22T13:00:00Z",
    venues: {
      beezie: { lastReadAt: "2026-10-21T16:24:00Z", unavailable: CHALLENGE, unavailableSince: "2026-10-22T04:27:00Z" },
      dyli: { lastReadAt: "2026-10-22T10:00:00Z", unavailable: "DYLI /sales: 502", unavailableSince: "2026-10-22T12:00:00Z" },
      renaiss: { lastReadAt: "2026-10-22T12:00:00Z", unavailable: null, unavailableSince: null },
    },
  };
  const bz = closedResaleFeed(snap, "beezie");
  assert.ok(bz);
  assert.equal(notReadSince(bz), "not read since Oct\u00a021");
  assert.equal(closedFeedWhy(bz), "its API answers automated reads with a bot challenge");
  assert.equal(closedResaleFeed(snap, "dyli"), null);
  assert.equal(closedResaleFeed(snap, "renaiss"), null);
  assert.equal(closedResaleFeed(null, "beezie"), null);
});
