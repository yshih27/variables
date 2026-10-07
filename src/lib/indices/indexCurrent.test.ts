/**
 * test:index-current — the running month's reading, the venues behind a step,
 * β on monthly returns, INV-14, and the strict panel build. Synthetic sales; no
 * network or database (a local snapshot dir and a stubbed fetch).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chainIdentityIndex } from "../data/identityIndex";
import type { SaleRow } from "../data/salePanel";
import type { CardPlatform } from "../card/ids";
import { monthlyBetaVsBtc, MIN_ALIGNED_MONTHS } from "./monthlyBeta";
import { checkProvisionalFreshness } from "./provisionalCheck";
import { readSaleFeed } from "../data/salePanel";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sale = (identity: string, ts: string, priceUsd: number, platform: CardPlatform = "beezie"): SaleRow => ({
  ts, tokenId: `${identity}-${ts}`, priceUsd, platform, ip: "pokemon", set: "Base Set", setKey: "base-set", grade: "PSA 10", identity,
});

/**
 * `ids` identities, each with two sales in every month of `months` at a price
 * that grows by `growth[m]` that month; the first identity also sells on
 * Collector Crypt in each month, so it is on two venues.
 */
function panel(months: string[], ids: number, growth: number[] = months.map(() => 0.02)): SaleRow[] {
  const rows: SaleRow[] = [];
  for (let i = 0; i < ids; i++) {
    let p = 100 + i * 10;
    months.forEach((m, k) => {
      p *= 1 + growth[k];
      rows.push(sale(`id${i}`, `${m}-05T12:00:00.000Z`, p, i === 0 ? "collector-crypt" : "beezie"));
      rows.push(sale(`id${i}`, `${m}-20T12:00:00.000Z`, p));
    });
  }
  return rows;
}

const FLOOR = 3;
const opts = (now: string) => ({ minIdentities: FLOOR, grain: "month" as const, nowMs: Date.parse(now) });

// ── The provisional reading ───────────────────────────────────────────────────

test("above the floor: the running step as a level, last close × exp(step), never a point", () => {
  const sales = panel(["2026-01", "2026-02", "2026-03", "2026-04"], 5);
  const { points, holds, provisional } = chainIdentityIndex(sales, opts("2026-04-25T00:00:00Z"));
  assert.deepEqual(points.map((p) => p.ts.slice(0, 7)), ["2026-01", "2026-02", "2026-03"]);
  assert.ok(provisional && "value" in provisional);
  assert.equal(provisional.month, "2026-04");
  assert.equal(provisional.n, 5);
  const last = points[points.length - 1];
  assert.ok(Math.abs(provisional.value - last.value * (1 + provisional.stepPct / 100)) < 1e-9);
  assert.ok(Math.abs(provisional.stepPct - 2) < 1e-9);
  // Every identity moved exactly 2%, so the step's bootstrap adds no width here.
  assert.ok(provisional.lo <= provisional.value && provisional.value <= provisional.hi);
  assert.equal(provisional.spansMonths, 1);
  assert.equal(provisional.asOf, "2026-04-20T12:00:00.000Z");
  assert.ok(!points.some((p) => p.ts.startsWith("2026-04")), "the running month is never a series point");
  assert.ok(holds.some((h) => h.reason === "running-month" && h.ts.startsWith("2026-04")));
});

test("below the floor: a record of the sample and why it is not a level", () => {
  const sales = panel(["2026-01", "2026-02", "2026-03"], 5).concat(
    // April: only two identities have priced twice so far.
    [sale("id0", "2026-04-02T00:00:00.000Z", 150), sale("id0", "2026-04-03T00:00:00.000Z", 150), sale("id1", "2026-04-02T00:00:00.000Z", 160), sale("id1", "2026-04-04T00:00:00.000Z", 160)],
  );
  const { provisional } = chainIdentityIndex(sales, opts("2026-04-10T00:00:00Z"));
  assert.ok(provisional && !("value" in provisional));
  assert.deepEqual({ month: provisional.month, n: provisional.n, floor: provisional.floor, reason: provisional.reason }, { month: "2026-04", n: 2, floor: FLOOR, reason: "below-floor" });
  assert.equal(typeof provisional.stepPct, "number");
  assert.equal(provisional.asOf, "2026-04-04T00:00:00.000Z");

  // Nothing priced twice in the running month yet: an empty sample, still a record.
  const empty = chainIdentityIndex(panel(["2026-01", "2026-02", "2026-03"], 5), opts("2026-04-01T03:00:00Z")).provisional;
  assert.deepEqual(empty, { month: "2026-04", asOf: null, n: 0, floor: FLOOR, reason: "below-floor", stepPct: null });
});

test("at the close the provisional is replaced: the month becomes a point, the next month the reading", () => {
  const sales = panel(["2026-01", "2026-02", "2026-03", "2026-04"], 5);
  const during = chainIdentityIndex(sales, opts("2026-04-25T00:00:00Z"));
  const after = chainIdentityIndex(sales, opts("2026-05-01T01:00:00Z"));
  const april = after.points.find((p) => p.ts.startsWith("2026-04"));
  assert.ok(april, "April publishes once it closes");
  assert.ok(during.provisional && "value" in during.provisional);
  // Same step, same chain: the close is the reading the month carried.
  assert.ok(Math.abs(april.value - during.provisional.value) < 1e-9);
  assert.equal(after.provisional?.month, "2026-05");
  assert.equal(after.provisional && "reason" in after.provisional ? after.provisional.reason : null, "below-floor");
});

test("an entity that does not publish has no provisional", () => {
  const { points, provisional } = chainIdentityIndex(panel(["2026-01", "2026-02"], 5), opts("2026-03-10T00:00:00Z"));
  assert.equal(points.length, 0);
  assert.equal(provisional, null);
});

// ── Venues ────────────────────────────────────────────────────────────────────

test("venues: per-venue identities and sales; an identity on two venues counts on both", () => {
  const { points, provisional } = chainIdentityIndex(panel(["2026-01", "2026-02", "2026-03", "2026-04"], 5), opts("2026-04-25T00:00:00Z"));
  const v = points[points.length - 1].venues!;
  // 5 identities × 2 months × 2 sales; id0 sold once a month on Collector Crypt.
  assert.deepEqual(v, {
    byVenue: { "collector-crypt": { identities: 1, sales: 2 }, beezie: { identities: 5, sales: 18 } },
    identities: 5,
    sales: 20,
    multiVenue: 1,
  });
  const sumIds = Object.values(v.byVenue).reduce((a, x) => a + x.identities, 0);
  assert.equal(sumIds, v.identities + v.multiVenue);
  assert.equal(Object.values(v.byVenue).reduce((a, x) => a + x.sales, 0), v.sales);
  assert.ok(provisional && "venues" in provisional);
  assert.deepEqual(provisional.venues, v);
});

// ── β and correlation on monthly returns ──────────────────────────────────────

function months(n: number): string[] {
  return Array.from({ length: n }, (_, k) => new Date(Date.UTC(2025, 0 + k, 1)).toISOString().slice(0, 7));
}
function btcDaily(ms: string[], rets: number[]): { ts: string; value: number }[] {
  const out: { ts: string; value: number }[] = [];
  let v = 50_000;
  ms.forEach((m, k) => {
    v *= 1 + rets[k];
    for (const d of ["01", "15", "28"]) out.push({ ts: `${m}-${d}T00:00:00.000Z`, value: v });
  });
  return out;
}

test("β and correlation: null with the reason below 12 aligned months, computed at 12", () => {
  const rets = [0.1, -0.05, 0.08, -0.12, 0.04, 0.06, -0.03, 0.09, -0.07, 0.02, 0.11, -0.04, 0.05, -0.02];
  const now = Date.parse("2026-06-15T00:00:00Z");
  const index = (n: number) => {
    let lvl = 100;
    return months(n).map((m, k) => {
      lvl *= 1 + 0.5 * rets[k];
      return { ts: new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0, 23, 59, 59)).toISOString(), value: lvl };
    });
  };
  const btc = btcDaily(months(14), rets);

  const six = monthlyBetaVsBtc(index(7), btc, { nowMs: now });
  assert.deepEqual(six, { beta: null, corr: null, months: 6, reason: `6 aligned monthly returns; ${MIN_ALIGNED_MONTHS} needed` });

  const twelve = monthlyBetaVsBtc(index(13), btc, { nowMs: now });
  assert.equal(twelve.months, 12);
  assert.ok(twelve.beta != null && Math.abs(twelve.beta - 0.5) < 1e-9, `beta ${twelve.beta}`);
  assert.ok(twelve.corr != null && Math.abs(twelve.corr - 1) < 1e-9, `corr ${twelve.corr}`);
  assert.equal(twelve.reason, undefined);

  // A withheld month leaves a two-month move: not a monthly return, not counted.
  const gapped = index(13).filter((_, k) => k !== 6);
  assert.equal(monthlyBetaVsBtc(gapped, btc, { nowMs: now }).months, 10);
});

// ── INV-14 ────────────────────────────────────────────────────────────────────

test("INV-14: an index that published last month needs a reading for this month, under 24h old", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  const blob = {
    generatedAt: "2026-10-01T06:20:00Z",
    series: {
      "market:total": [{ ts: "2026-08-31T23:59:59.999Z" }, { ts: "2026-09-30T23:59:59.999Z" }],
      "ip:pokemon": [{ ts: "2026-09-30T23:59:59.999Z" }],
      "set:pokemon:old": [{ ts: "2026-07-31T23:59:59.999Z" }], // did not publish September: not checked
      "premium:psa-10:psa-9": [{ ts: "2026-09-30T23:59:59.999Z" }], // a ratio: no running step
    },
    provisional: { "market:total": { month: "2026-10" }, "ip:pokemon": { month: "2026-10" } },
  };
  assert.deepEqual(checkProvisionalFreshness(blob, now), { checked: 2, violations: [], running: "2026-10", last: "2026-09" });

  const missing = checkProvisionalFreshness({ ...blob, provisional: { "market:total": { month: "2026-10" } } }, now);
  assert.deepEqual(missing.violations, ["ip:pokemon: published 2026-09, no 2026-10 reading"]);

  const wrongMonth = checkProvisionalFreshness({ ...blob, provisional: { ...blob.provisional, "ip:pokemon": { month: "2026-09" } } }, now);
  assert.deepEqual(wrongMonth.violations, ["ip:pokemon: published 2026-09, its reading is for 2026-09, not 2026-10"]);

  const stale = checkProvisionalFreshness({ ...blob, generatedAt: "2026-09-30T06:00:00Z" }, now);
  assert.equal(stale.violations.length, 2);
  assert.match(stale.violations[0], /30\.0h old \(> 24h\)/);
});

// ── The index build's panel is strict ─────────────────────────────────────────

test("strict panel: a Beezie leg that comes back empty throws; the lenient feed still serves the rest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "index-current-"));
  const cc = { date: "2026-09-20T00:00:00.000Z", tokenId: "m", buyer: "x", seller: "y", priceUsd: 50 };
  writeFileSync(join(dir, "secondary-sales.json"), JSON.stringify({ generatedAt: "2026-09-30T00:00:00Z", windowDays: 30, platforms: { "collector-crypt": [cc] } }));
  const prevDir = process.env.SNAPSHOT_LOCAL_DIR;
  const prevFetch = globalThis.fetch;
  process.env.SNAPSHOT_LOCAL_DIR = dir;
  // Beezie /activity answering 200 with nothing: the degraded response that left the Oct 1 legs build without Beezie.
  globalThis.fetch = (async () => Response.json({ activity: [] })) as typeof fetch;
  try {
    await assert.rejects(readSaleFeed({ strict: true }), /Beezie's \/activity returned no sales; nothing was written/);
    const lenient = await readSaleFeed();
    assert.deepEqual(lenient.map((r) => [r.platform, r.tokenId]), [["collector-crypt", "m"]]);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevDir == null) delete process.env.SNAPSHOT_LOCAL_DIR;
    else process.env.SNAPSHOT_LOCAL_DIR = prevDir;
  }
});
