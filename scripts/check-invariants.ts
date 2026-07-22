/**
 * Automated data invariants (D10-4) — the systemic answer to "data correctness is
 * the one thing we cannot get wrong." Runs in the Actions gate beside
 * check-freshness; a HARD violation exits non-zero → the run goes red.
 *
 *   npx tsx scripts/check-invariants.ts          # report; exit 1 on a HARD violation
 *   npx tsx scripts/check-invariants.ts --strict # also exit 1 on SOFT (heuristic) flags
 *
 * Two severities:
 *   • HARD — a mathematical identity that can only break if the pipeline is wrong
 *     (fan-out duplication, holders union > sum, hero total ≠ Σ rows, avgTrade ≠
 *     vol/trades, cards>0 while vol=0). Always fails the gate.
 *   • SOFT — a heuristic anomaly that USUALLY means a bug but has legitimate causes
 *     (a per-token trade outlier, a >±30% day-over-day mcap move — a real move on a
 *     tiny IP, or a taxonomy migration not yet reset). Warns; fails only with --strict.
 *
 * Inputs that can't be read (e.g. a Supabase outage) SKIP with a warning rather than
 * failing — a transient outage must not be indistinguishable from a data violation.
 * Skips are reported; they never exit non-zero (the freshness gate owns liveness).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { getLatestResults } from "../src/lib/dune/client";
import { CC_SECONDARY_QUERY_ID, COURTYARD_SECONDARY_QUERY_ID } from "../src/lib/dune/queryIds";
import { cleanSecondarySales } from "../src/lib/data/secondaryHygiene";
import { readSnapshot } from "../src/lib/db/snapshots";
import { weekStartUtc } from "../src/lib/data/priceIndex";
import { HOMEPAGE_SNAPSHOT_KEY } from "../src/lib/data/fetchHomepage";
import { readHolders } from "../src/lib/data/holders";
import { readCoreVolume } from "../src/lib/data/coreVolumeCache";
import { readMetricSeriesBulk, bulkDayOverDayPctComplete, DELTA_MIN_BASE_USD } from "../src/lib/data/metricSnapshots";
import type { HomepagePayload } from "../src/lib/types";
import type { NormalizedSale } from "../src/lib/rarible/queries";

type Severity = "hard" | "soft";
type Status = "pass" | "fail" | "skip";
type Result = { name: string; severity: Severity; status: Status; detail: string; violations?: string[] };

const DUPE_MAX_RATIO = 1.02; // rows ÷ unique natural-keys — above this = fan-out
const MCAP_DOD_MAX = 0.30; // |day-over-day mcap change| flag threshold
const AVGTRADE_TOL = 0.01; // avgTrade vs vol/trades relative tolerance
const XSURFACE_TOL = 0.005; // hero total vs Σ rows relative tolerance

const ok = (name: string, severity: Severity, detail: string): Result => ({ name, severity, status: "pass", detail });
const bad = (name: string, severity: Severity, detail: string, violations: string[]): Result => ({ name, severity, status: "fail", detail, violations });
const skip = (name: string, severity: Severity, detail: string): Result => ({ name, severity, status: "skip", detail });

const mapDune = (raw: Record<string, unknown>[]): NormalizedSale[] =>
  raw
    .map((r) => ({ date: String(r.block_time), tokenId: String(r.nft_mint ?? ""), buyer: String(r.buyer ?? ""), seller: String(r.seller ?? ""), priceUsd: Number(r.price_usd) }))
    .filter((s) => s.priceUsd > 0 && s.tokenId);

/** INV-1 (HARD) + INV-2 (SOFT) over a Dune secondary feed, from ONE 0-credit read. */
async function checkDuneFeed(label: string, queryId: number): Promise<Result[]> {
  let raw: Record<string, unknown>[];
  try {
    raw = await getLatestResults(queryId, { maxRows: 300_000 });
  } catch (e) {
    return [skip(`dupe-rate:${label}`, "hard", `feed unreadable: ${(e as Error).message.slice(0, 80)}`)];
  }
  const sales = mapDune(raw);
  const results: Result[] = [];

  // INV-1: fan-out — rows ÷ unique natural-key (no tx signature in the feed).
  const keys = new Set(sales.map((s) => `${s.tokenId}|${s.date}|${s.buyer}|${s.seller}|${s.priceUsd}`));
  const ratio = keys.size ? sales.length / keys.size : 1;
  results.push(
    ratio > DUPE_MAX_RATIO
      ? bad(`dupe-rate:${label}`, "hard", `rows/unique = ${ratio.toFixed(3)} > ${DUPE_MAX_RATIO}`, [
          `${sales.length} rows vs ${keys.size} unique natural-keys — Dune SQL fan-out?`,
        ])
      : ok(`dupe-rate:${label}`, "hard", `rows/unique = ${ratio.toFixed(3)} (${sales.length} rows)`),
  );

  // INV-2: per-token trade outlier on the CLEANED feed (wash already removed). No
  // token should tower over the field — that's residual manipulation the ring
  // filter didn't catch. Flag any token > max(P99×10, 20).
  const { sales: clean, stats } = cleanSecondarySales(sales);
  const byTok = new Map<string, number>();
  for (const s of clean) byTok.set(s.tokenId, (byTok.get(s.tokenId) ?? 0) + 1);
  const counts = [...byTok.values()].sort((a, b) => a - b);
  const p99 = counts.length ? counts[Math.floor(counts.length * 0.99)] : 0;
  const thresh = Math.max(p99 * 10, 20);
  const outliers = [...byTok.entries()].filter(([, n]) => n > thresh).sort((a, b) => b[1] - a[1]);
  results.push(
    outliers.length
      ? { name: `trade-outlier:${label}`, severity: "soft", status: "fail", detail: `${outliers.length} token(s) > ${thresh} trades (P99=${p99}); cleaned ${stats.washDropped} wash`, violations: outliers.slice(0, 5).map(([m, n]) => `${m.slice(0, 10)}… ${n} trades`) }
      : ok(`trade-outlier:${label}`, "soft", `max ${counts[counts.length - 1] ?? 0} trades/token ≤ ${thresh}; cleaned ${stats.washDropped} wash`),
  );
  return results;
}

/** INV-3 (HARD): column semantics — cards24h>0 ⇔ vol24h>0 on IP rows (D10-2). */
function checkColumnSemantics(hp: HomepagePayload): Result {
  const bads: string[] = [];
  for (const ip of hp.ips) {
    const hasCards = ip.cards > 0;
    const hasVol = Number.isFinite(ip.vol24Usd) && ip.vol24Usd > 0;
    if (hasCards !== hasVol) bads.push(`${ip.key}: cards24h=${ip.cards} but vol24h=${Math.round(ip.vol24Usd)}`);
  }
  return bads.length
    ? bad("column-semantics", "hard", `${bads.length} IP row(s) break cards⇔vol`, bads.slice(0, 8))
    : ok("column-semantics", "hard", `all ${hp.ips.length} IP rows: cards24h>0 ⇔ vol24h>0`);
}

/** INV-3b (HARD): avgTrade ≈ vol/salesCount per platform (from the core-volume snapshot). */
async function checkAvgTrade(): Promise<Result> {
  const core = await readCoreVolume();
  if (!core) return skip("avg-trade", "hard", "core-volume snapshot unreadable");
  const bads: string[] = [];
  for (const [key, p] of Object.entries(core.platforms)) {
    const { volumeUsd, salesCount, avgTradeUsd } = p.stats24h;
    if (salesCount <= 0) continue;
    const implied = volumeUsd / salesCount;
    const rel = implied > 0 ? Math.abs(avgTradeUsd - implied) / implied : (avgTradeUsd === 0 ? 0 : 1);
    if (rel > AVGTRADE_TOL) bads.push(`${key}: avgTrade=${avgTradeUsd.toFixed(2)} vs vol/trades=${implied.toFixed(2)} (${(rel * 100).toFixed(1)}%)`);
  }
  return bads.length
    ? bad("avg-trade", "hard", `${bads.length} platform(s) avgTrade≠vol/trades`, bads)
    : ok("avg-trade", "hard", "avgTrade ≈ vol/trades for all platforms");
}

/** INV-4 (HARD): holders — union ≤ Σ per-platform; Σ per-IP ≥ union. */
async function checkHolders(): Promise<Result> {
  const h = await readHolders();
  if (!h) return skip("holders", "hard", "holders snapshot unreadable");
  const platSum = Object.values(h.platforms).reduce((s, n) => s + (Number(n) || 0), 0);
  const union = h.totalHolders ?? platSum;
  const ipSum = Object.values(h.byIp).reduce((s, e) => s + (Number((e as { total?: number }).total) || 0), 0);
  const bads: string[] = [];
  // small tolerance for snapshot skew between the union field and the per-platform map
  if (union > platSum * 1.001) bads.push(`union ${union} > Σplatform ${platSum}`);
  if (ipSum > 0 && ipSum < union * 0.999) bads.push(`Σper-IP ${ipSum} < union ${union} (a wallet in K IPs must count K times)`);
  return bads.length ? bad("holders", "hard", "holder set relations violated", bads) : ok("holders", "hard", `union ${union} ≤ Σplat ${platSum}; ΣIP ${ipSum} ≥ union`);
}

/** INV-5 (SOFT): spine continuity — latest day-over-day mcap move ≤ ±30% per entity. */
async function checkSpineContinuity(): Promise<Result> {
  const bulk = await readMetricSeriesBulk("ip", "mcap_usd").catch(() => new Map());
  if (!bulk.size) return skip("spine-continuity", "soft", "spine mcap series unreadable/empty");
  const bads: string[] = [];
  for (const [key, series] of bulk) {
    if (series.length < 2) continue;
    const last = series[series.length - 1], prev = series[series.length - 2];
    // only the most recent step (catch fresh artifacts, not re-litigate old history)
    if (!(prev.value > 0)) continue;
    const move = (last.value - prev.value) / prev.value;
    if (Math.abs(move) > MCAP_DOD_MAX) bads.push(`ip:${key} ${(move * 100).toFixed(0)}% (${Math.round(prev.value)}→${Math.round(last.value)}) on ${last.ts.slice(0, 10)}`);
  }
  return bads.length
    ? { name: "spine-continuity", severity: "soft", status: "fail", detail: `${bads.length} entity(ies) moved >±${MCAP_DOD_MAX * 100}% day-over-day (bad write or un-reset taxonomy migration?)`, violations: bads.slice(0, 8) }
    : ok("spine-continuity", "soft", `all ${bulk.size} IP mcap series within ±${MCAP_DOD_MAX * 100}% day-over-day`);
}

/** INV-6 (HARD): cross-surface — hero.vol24Usd == Σ platform.vol24Usd (same snapshot). */
function checkCrossSurface(hp: HomepagePayload): Result {
  const rowSum = hp.platforms.reduce((s, p) => s + (Number(p.vol24Usd) || 0), 0);
  const hero = Number(hp.hero.vol24Usd) || 0;
  const rel = hero > 0 ? Math.abs(hero - rowSum) / hero : (rowSum === 0 ? 0 : 1);
  return rel > XSURFACE_TOL
    ? bad("cross-surface", "hard", `hero.vol24Usd ${Math.round(hero)} ≠ Σrows ${Math.round(rowSum)} (${(rel * 100).toFixed(1)}%)`, [`hero=${Math.round(hero)} vs Σplatform.vol24Usd=${Math.round(rowSum)}`])
    : ok("cross-surface", "hard", `hero.vol24Usd == Σ platform rows (${Math.round(hero)})`);
}

/**
 * INV-7 (HARD): price-index completeness — the week-END stamping (PR #44) must never
 * publish (1) a FUTURE-dated point or (2) the IN-PROGRESS week. A running-week point
 * is a thin-sample partial spike stamped at its future Sunday (the "Jul 26 ≈ 239" bug);
 * only fully-elapsed weeks belong in a constant-quality index. Runs in the indices batch's
 * gate so a missing/regressed completeness gate in the builder fails CI, not the chart.
 */
async function checkIndexCompleteness(nowMs: number = Date.now()): Promise<Result> {
  const snap = await readSnapshot<{ series: Record<string, { ts: string; value: number }[]> }>("price-index");
  if (!snap?.series || !Object.keys(snap.series).length) {
    return skip("index-completeness", "hard", "price-index snapshot unreadable/empty");
  }
  const cutoff = Date.parse(weekStartUtc(nowMs)); // Monday 00:00 UTC of the in-progress week
  const bads: string[] = [];
  let series = 0, points = 0;
  for (const [key, pts] of Object.entries(snap.series)) {
    if (!Array.isArray(pts) || !pts.length) continue;
    series += 1;
    points += pts.length;
    // (1) no future-dated point
    const future = pts.find((p) => Date.parse(p.ts) > nowMs);
    if (future) bads.push(`${key}: future point ${future.ts.slice(0, 10)} > now`);
    // (2) newest point covers a fully-elapsed week (its week-end < the running week's Monday)
    const newest = pts[pts.length - 1];
    if (Date.parse(newest.ts) >= cutoff) bads.push(`${key}: newest ${newest.ts.slice(0, 10)} is the in-progress week (≥ ${new Date(cutoff).toISOString().slice(0, 10)})`);
  }
  return bads.length
    ? bad("index-completeness", "hard", `${bads.length} series publish an incomplete/future week`, bads.slice(0, 8))
    : ok("index-completeness", "hard", `${series} index series end on a fully-elapsed week; no future points (${points} pts)`);
}

/**
 * INV-8 (HARD): published Σ-based 24h deltas must be computed over SOURCE-COMPLETE days,
 * never a Dune-lagged partial newest day (the "gacha −79.8%" fake collapse). Recompute
 * the gated delta from the spine and compare to the homepage payload's hero.vol24Pct /
 * gachaVol24Pct. Runs in the DAILY batch AFTER warm-homepage writes the payload from the
 * same spine, so it's timing-robust — a mismatch means the completeness gate regressed.
 */
async function checkDailyDeltaCompleteness(hp: HomepagePayload | null): Promise<Result> {
  if (!hp?.hero) return skip("daily-delta-completeness", "hard", "homepage-payload unreadable");
  const near = (a: number | null, b: number | null) =>
    a == null || b == null ? a === b : Math.abs(a - b) < 0.5; // 0.5pp — same computation, float slack
  const bads: string[] = [];
  for (const [label, metric, published] of [
    ["marketplace", "volume_usd", hp.hero.vol24Pct],
    ["gacha", "gacha_volume_usd", hp.hero.gachaVol24Pct],
  ] as const) {
    const bulk = await readMetricSeriesBulk("platform", metric).catch(() => new Map<string, never>());
    if (!bulk.size) continue;
    const gated = bulkDayOverDayPctComplete(bulk, DELTA_MIN_BASE_USD);
    if (!near(published, gated)) {
      bads.push(`${label}: published ${published?.toFixed(1) ?? "—"}% ≠ gated ${gated?.toFixed(1) ?? "—"}% (partial newest day reaching the chart?)`);
    }
  }
  return bads.length
    ? bad("daily-delta-completeness", "hard", `${bads.length} published Σ-delta(s) not gated to complete days`, bads)
    : ok("daily-delta-completeness", "hard", "Σ 24h deltas computed over source-complete days");
}

async function main() {
  const strict = process.argv.includes("--strict");
  console.log(`\nData invariants — ${process.env.SUPABASE_URL ?? "(no SUPABASE_URL)"}\n`);

  const results: Result[] = [];
  // Dune feeds (0-credit reads; independent of Supabase).
  results.push(...(await checkDuneFeed("cc", CC_SECONDARY_QUERY_ID)));
  results.push(...(await checkDuneFeed("courtyard", COURTYARD_SECONDARY_QUERY_ID)));

  // Snapshot-backed invariants — skip cleanly if the homepage blob is unreadable.
  const hp = await readSnapshot<HomepagePayload>(HOMEPAGE_SNAPSHOT_KEY);
  if (hp?.hero && Array.isArray(hp.ips) && Array.isArray(hp.platforms)) {
    results.push(checkColumnSemantics(hp));
    results.push(checkCrossSurface(hp));
  } else {
    results.push(skip("column-semantics", "hard", "homepage-payload snapshot unreadable"));
    results.push(skip("cross-surface", "hard", "homepage-payload snapshot unreadable"));
  }
  results.push(await checkAvgTrade());
  results.push(await checkHolders());
  results.push(await checkSpineContinuity());
  results.push(await checkIndexCompleteness());
  results.push(await checkDailyDeltaCompleteness(hp));

  const ICON: Record<Status, string> = { pass: "✓", fail: "✗", skip: "·" };
  for (const r of results) {
    console.log(`  ${ICON[r.status]} [${r.severity.toUpperCase().padEnd(4)}] ${r.name.padEnd(24)} ${r.detail}`);
    for (const v of r.violations ?? []) console.log(`        → ${v}`);
  }

  const hardFails = results.filter((r) => r.status === "fail" && r.severity === "hard");
  const softFails = results.filter((r) => r.status === "fail" && r.severity === "soft");
  const skips = results.filter((r) => r.status === "skip");
  console.log(
    `\nSUMMARY  ${results.filter((r) => r.status === "pass").length} pass · ${hardFails.length} HARD-fail · ${softFails.length} soft-flag · ${skips.length} skipped\n`,
  );

  if (hardFails.length || (strict && softFails.length)) {
    console.error(`✗ INVARIANTS FAILED — ${hardFails.length} hard${strict ? ` + ${softFails.length} soft (--strict)` : ""}. This fails the Actions job on purpose.\n`);
    process.exit(1);
  }
  if (softFails.length) console.log(`⚠ ${softFails.length} soft flag(s) — review, not blocking (run with --strict to enforce).\n`);
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1); });
