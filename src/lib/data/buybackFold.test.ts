import test from "node:test";
import assert from "node:assert/strict";
import { foldBuybackRows, reconcileDays } from "./buybackFold";

const dayStartUtc = (ms: number) => new Date(Math.floor(ms / 86400000) * 86400000).toISOString();
const NOW = Date.parse("2026-09-22T04:00:00Z");
const d = (n: number) => new Date(NOW - n * 86400000).toISOString().slice(0, 10); // n days ago, DATE form like Dune's `d`
const opts = {
  spenders: new Map([["collector-crypt", new Set(["aa", "bb"])]]),
  trusted: new Set(["collector-crypt"]),
  platformByCode: { c: "collector-crypt", p: "phygitals" },
  nowMs: NOW,
  dayStartUtc,
};

test("two-tier shape: payouts from the recipient tier, gross from the gross tier, each with its own coverage", () => {
  const rows = [
    // recipient tier — 9 days back (partial first day) … today
    ...[9, 8, 3, 2, 1, 0].flatMap((n) => [
      { p: "c", d: d(n), w: "AA", n: 1, u: 100 }, // spender
      { p: "c", d: d(n), w: "zz", n: 1, u: 40 }, // not a spender (a partner)
    ]),
    // gross tier — 35 days, one row a day
    ...Array.from({ length: 36 }, (_, n) => ({ p: "c", d: d(n), w: null, n: 3, u: 140 })),
    // phygitals: untrusted → every recipient counts, no gross series
    { p: "p", d: d(2), w: "q1", n: 1, u: 10 },
    { p: "p", d: d(1), w: "q2", n: 1, u: 20 },
  ];
  const f = foldBuybackRows(rows, opts);
  assert.equal(f.basis, "r3");
  assert.equal(f.stats.grossRows, 36);
  assert.equal(f.stats.grossFromRecipients, false);
  // CC payouts: only the spender's rows; the partial first day (9) and today (0) are not covered
  const cc = f.payouts.get("collector-crypt")!;
  assert.equal(cc.get(dayStartUtc(NOW - 2 * 86400000)), 100);
  assert.deepEqual([...f.payoutDays.get("collector-crypt")!].sort(), [8, 3, 2, 1].map((n) => dayStartUtc(NOW - n * 86400000)).sort());
  // CC gross: from the gross tier, 34 complete days (day 35 partial, day 0 today)
  assert.equal(f.gross.get("collector-crypt")!.get(dayStartUtc(NOW - 20 * 86400000)), 140);
  assert.equal(f.grossDays.get("collector-crypt")!.size, 34);
  // match rate: aa matched, zz not → 1/2
  assert.equal(f.match.get("collector-crypt")!.rate, 0.5);
  // phygitals: untrusted → all counted, no gross
  assert.equal(f.payouts.get("phygitals")!.get(dayStartUtc(NOW - 1 * 86400000)), 20);
  assert.equal(f.gross.has("phygitals"), false);
});

test("old single-tier shape (the query still live on Dune): gross is summed from the recipient rows", () => {
  const rows = [3, 2, 1, 0].flatMap((n) => [
    { p: "c", d: d(n), w: "aa", n: 1, u: 100 },
    { p: "c", d: d(n), w: "zz", n: 1, u: 40 },
  ]);
  const f = foldBuybackRows(rows, opts);
  assert.equal(f.stats.grossFromRecipients, true);
  assert.equal(f.gross.get("collector-crypt")!.get(dayStartUtc(NOW - 2 * 86400000)), 140);
  assert.equal(f.payouts.get("collector-crypt")!.get(dayStartUtc(NOW - 2 * 86400000)), 100);
  assert.equal(f.grossDays.get("collector-crypt")!.size, 2); // day 3 partial, day 0 today
});

test("classification failure: gross-of-list payouts, no gross series, a warning", () => {
  const rows = [2, 1].flatMap((n) => [
    { p: "c", d: d(n), w: "n1", n: 1, u: 10 },
    { p: "c", d: d(n), w: "n2", n: 1, u: 10 },
    { p: "c", d: d(n), w: "n3", n: 1, u: 10 },
    { p: "c", d: d(n), w: null, n: 3, u: 30 },
  ]);
  const f = foldBuybackRows(rows, opts);
  assert.equal(f.warnings.length, 1);
  assert.equal(f.gross.has("collector-crypt"), false);
  assert.equal(f.payouts.get("collector-crypt")!.get(dayStartUtc(NOW - 1 * 86400000)), 30);
});

test("pre-R3 rows fold gross-of-list with no basis", () => {
  const f = foldBuybackRows([{ platform: "collector-crypt", day: `${d(1)} 00:00:00.000 UTC`, payout_usd: 55 }], opts);
  assert.equal(f.basis, "pre-r3");
  assert.equal(f.stats.legacyRows, 1);
  assert.equal(f.payouts.get("collector-crypt")!.get(dayStartUtc(NOW - 1 * 86400000)), 55);
});

test("reconciliation counts only shared days, alarms on settled days, reports fresh days as restatement", () => {
  const D = 86400000;
  const day = (n: number) => dayStartUtc(NOW - n * D);
  const source = new Map([[day(8), 100], [day(5), 100], [day(4), 100], [day(2), 150], [day(1), 200]]);
  const stored = new Map([[day(5), 100], [day(4), 90], [day(2), 100]]); // day(8) and day(1) not in the spine
  const r = reconcileDays(source, stored, source.keys(), NOW, 3);
  assert.equal(r.sharedDays, 3);
  assert.equal(r.settledDays, 2); // day(5), day(4)
  assert.equal(r.settledSource, 200);
  assert.equal(r.settledStored, 190);
  assert.ok(Math.abs(r.settledDrift - 10 / 190) < 1e-12);
  assert.equal(r.freshDays, 1); // day(2)
  assert.equal(r.freshSource, 150);
  assert.equal(r.freshStored, 100);
});
