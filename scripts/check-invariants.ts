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
import {
  STEP_LIMIT_PCT as INDEX_STEP_LIMIT_PCT,
  THIN_WEEK_PAIRS as INDEX_THIN_WEEK_PAIRS,
} from "../src/lib/data/repeatSalesIndex";
import { INVARIANCE_TOLERANCE_PP, INDEX_HARD_SKEW_PP } from "../src/lib/data/biasTests";
import {
  THIN_MONTH_IDENTITIES as INDEX_THIN_MONTH_IDENTITIES,
  weightedMedian,
  weightedMedianDegeneracy,
} from "../src/lib/data/identityIndex";
import { HOMEPAGE_SNAPSHOT_KEY } from "../src/lib/data/fetchHomepage";
import { readHolders } from "../src/lib/data/holders";
import { readCoreVolume } from "../src/lib/data/coreVolumeCache";
import { readMetricSeriesBulk, bulkDayOverDayPctComplete, dayStartUtc, DELTA_MIN_BASE_USD } from "../src/lib/data/metricSnapshots";
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
 * INV-11 (HARD): no published price-index step may exceed ±25% unless the period
 * rests on enough observations.
 *
 * GRAIN-AWARE (v4). The threshold depends on what a point IS: a WEEKLY point needs
 * ≥100 repeat-sale pairs, a MONTHLY identity-comparables point needs ≥50 identities
 * (fewer, because an identity priced from >=2 sales in both months is a far stronger
 * observation than one token resold once). The grain is read off the stamps rather
 * than configured, so the invariant cannot drift out of sync with the blob: a point
 * stamped on the last day of its month is monthly, anything else weekly. The rebuilt index is a repeat-sales
 * estimator (src/lib/data/repeatSalesIndex.ts) whose builder withholds such points
 * with reason `thin-week`; this invariant is the independent check that none ever
 * reaches the blob. The week ending Sep 6 printed +40.5% on the old cell method —
 * that is the class of number this exists to keep off the site.
 */
async function checkIndexStepSanity(): Promise<Result> {
  const snap = await readSnapshot<{ series: Record<string, { ts: string; value: number; n?: number }[]> }>("price-index");
  if (!snap?.series || !Object.keys(snap.series).length) {
    return skip("index-step-sanity", "hard", "price-index snapshot unreadable/empty");
  }
  // A month-end stamp is the last day of its own month; a week-end stamp is not.
  const isMonthEnd = (ts: string): boolean => {
    const t = Date.parse(ts);
    if (!Number.isFinite(t)) return false;
    const d = new Date(t);
    return d.getUTCDate() === new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  };
  const bads: string[] = [];
  let steps = 0, monthly = 0;
  for (const [key, pts] of Object.entries(snap.series)) {
    // `premium:` series are RATIOS between two grades of the same card, not
    // index levels: a real premium can move more than 25% in a month on a
    // handful of matched identities, and that is the finding, not a fault. The
    // step-sanity rule is about a chained LEVEL and does not apply to them.
    if (key.startsWith("premium:")) continue;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (!(a.value > 0) || !(b.value > 0)) continue;
      steps += 1;
      const month = isMonthEnd(b.ts) && isMonthEnd(a.ts);
      if (month) monthly += 1;
      const need = month ? INDEX_THIN_MONTH_IDENTITIES : INDEX_THIN_WEEK_PAIRS;
      const unit = month ? "identities" : "pairs";
      const stepPct = (b.value / a.value - 1) * 100;
      const n = b.n ?? 0;
      if (Math.abs(stepPct) > INDEX_STEP_LIMIT_PCT && n < need) {
        bads.push(`${key}: ${b.ts.slice(0, 10)} ${stepPct >= 0 ? "+" : ""}${stepPct.toFixed(1)}% on ${n} ${unit} (needs ≥${need})`);
      }
    }
  }
  return bads.length
    ? bad("index-step-sanity", "hard", `${bads.length} thin-period step(s) exceed ±${INDEX_STEP_LIMIT_PCT}%`, bads.slice(0, 8))
    : ok(
        "index-step-sanity",
        "hard",
        `all ${steps} steps (${monthly} monthly, ${steps - monthly} weekly) within ±${INDEX_STEP_LIMIT_PCT}% or backed by ≥${INDEX_THIN_WEEK_PAIRS} pairs / ≥${INDEX_THIN_MONTH_IDENTITIES} identities`,
      );
}

/**
 * INV-12 (SOFT): holding-period invariance — the selection-bias detector.
 *
 * A real price index has the same per-week rate whatever interval it is measured
 * over. v2's rate fell monotonically with holding period (+5.4%/wk at 1 week,
 * +1.2%/wk at 6 months) because it could only observe cards somebody chose to
 * resell, and it still passed every test it had: a smoothness gate cannot tell a
 * trend from a compounding selection bias, because a perfectly biased index is
 * perfectly smooth. This is the test that would have caught it.
 *
 * SOFT on purpose: a spread above the tolerance means the SAMPLE is suspect, which
 * is a judgement call about method, not a broken pipeline. It flags for review
 * rather than failing the batch. The warmer computes it on every rebuild and stores
 * it with the series (see warm-sale-panel.ts).
 */
async function checkHoldingPeriodInvariance(): Promise<Result> {
  const snap = await readSnapshot<{
    biasTests?: {
      invariance?: { buckets: { label: string; n: number; perWeekPct: number }[]; spreadPP: number; pass: boolean };
      entities?: Record<string, { selectionPremiumPP: number | null; heldReason?: string | null }>;
    };
  }>("price-index");
  const inv = snap?.biasTests?.invariance;
  if (!inv || !Number.isFinite(inv.spreadPP)) {
    return skip("holding-period-invariance", "soft", "price-index snapshot carries no bias-test block (pre-INV-12 rebuild)");
  }
  const detail = inv.buckets.map((b) => `${b.label} ${b.perWeekPct >= 0 ? "+" : ""}${b.perWeekPct.toFixed(2)}%/mo (n=${b.n})`).join(" · ");
  const mkt = snap?.biasTests?.entities?.["market:total"];
  // TWO THRESHOLDS. Above the disclosure tolerance (1pp) the skew is DISCLOSED on
  // every surface as the "resale skew" receipt — soft, informational. Above the
  // hard limit (3pp) the builder must have written heldReason="selection-premium"
  // for V-MKT and the reader withholds it; an index that publishes with a skew
  // past the hard limit is a HARD failure, because the receipt then understates a
  // bias too large to footnote.
  if (inv.spreadPP > INDEX_HARD_SKEW_PP) {
    return mkt?.heldReason === "selection-premium"
      ? ok("holding-period-invariance", "hard", `spread ${inv.spreadPP.toFixed(2)}pp > ${INDEX_HARD_SKEW_PP}pp — V-MKT correctly auto-held (selection-premium)`)
      : bad(
          "holding-period-invariance",
          "hard",
          `spread ${inv.spreadPP.toFixed(2)}pp > ${INDEX_HARD_SKEW_PP}pp but V-MKT is NOT held — the builder must write heldReason=selection-premium`,
          [detail],
        );
  }
  return inv.spreadPP <= INVARIANCE_TOLERANCE_PP
    ? ok("holding-period-invariance", "soft", `spread ${inv.spreadPP.toFixed(2)}pp ≤ ${INVARIANCE_TOLERANCE_PP}pp — ${detail}`)
    : ok(
        "holding-period-invariance",
        "soft",
        `spread ${inv.spreadPP.toFixed(2)}pp — disclosed as resale skew (soft band ${INVARIANCE_TOLERANCE_PP}–${INDEX_HARD_SKEW_PP}pp) — ${detail}`,
      );
}

/**
 * INV-13 (HARD): no published step rests on ONE identity.
 *
 * The v4 estimator was a plain weighted median, which returns the first
 * observation past 50% of the weight — one identity's return. On the market's
 * June → July step (49 identities, 22 up / 2 flat / 25 down, unweighted median
 * −2.08%) it printed exactly 0.00% because the cut landed on a flat card; the
 * whole market's level rested on one identity. v4.1 interpolates between the two
 * straddling identities, so a step can equal a single identity's return only in
 * two degenerate cases: the 50% mark lands exactly on that identity's midpoint,
 * or the two straddling identities share a value. Both are allowed and LOGGED.
 *
 * This re-derives the estimator from the raw observations the builder stores
 * (`stepObs`), so it is an independent check, not a self-report: (a) the stored
 * step return must equal the re-derived interpolated median, and (b) when the
 * overlap is ≥ 3, that return must not equal any single observation to 1e-9
 * unless the case is degenerate.
 */
async function checkStepNotSingleIdentity(): Promise<Result> {
  const snap = await readSnapshot<{
    series: Record<string, { ts: string; value: number; n?: number }[]>;
    stepObs?: Record<string, Record<string, [number, number][]>>;
  }>("price-index");
  if (!snap?.series || !snap.stepObs) {
    return skip("step-not-single-identity", "hard", "price-index snapshot carries no stepObs block (pre-v4.1 rebuild)");
  }
  const bads: string[] = [];
  const degenerate: string[] = [];
  let checked = 0;
  for (const [key, pts] of Object.entries(snap.series)) {
    if (key.startsWith("premium:")) continue;
    const obsByTs = snap.stepObs[key] ?? {};
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const raw = obsByTs[b.ts];
      if (!raw || !(a.value > 0) || !(b.value > 0)) continue;
      const obs = raw.map(([v, w]) => ({ v, w }));
      const stepRet = Math.log(b.value / a.value);
      const derived = weightedMedian(obs);
      checked += 1;
      // (a) the published step IS the interpolated estimator of its own sample
      if (!Number.isFinite(derived) || Math.abs(derived - stepRet) > 1e-9) {
        bads.push(`${key} ${b.ts.slice(0, 10)}: published step ${stepRet.toFixed(6)} ≠ re-derived ${derived.toFixed(6)}`);
        continue;
      }
      if (obs.length < 3) continue; // a 1- or 2-identity step is degenerate by definition
      // (b) it does not equal any single identity's return, unless degenerate
      const hit = obs.find((o) => Math.abs(o.v - derived) < 1e-9);
      if (!hit) continue;
      const { onMidpoint, tie } = weightedMedianDegeneracy(obs);
      if (onMidpoint || tie) {
        degenerate.push(`${key} ${b.ts.slice(0, 10)}: equals one identity's return (${derived.toFixed(6)}) — ${tie ? "straddling tie" : "mark on midpoint"}, n=${obs.length}`);
      } else {
        bads.push(`${key} ${b.ts.slice(0, 10)}: step ${derived.toFixed(6)} equals a single identity's return on n=${obs.length} with no degeneracy`);
      }
    }
  }
  for (const d of degenerate) console.log(`        · degenerate (allowed): ${d}`);
  return bads.length
    ? bad("step-not-single-identity", "hard", `${bads.length} step(s) rest on one identity or disagree with the estimator`, bads.slice(0, 8))
    : ok("step-not-single-identity", "hard", `${checked} steps re-derived from raw observations; ${degenerate.length} degenerate (logged), 0 resting on one identity`);
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

/**
 * INV-9 (HARD) — SOURCE DEATH. A (platform, metric) stream that was writing
 * recently but has produced nothing for the two most recent complete days is a
 * dead writer, and nothing else catches it:
 *   • sourceDayCompleteness detects LAG, not death. It compares each day's
 *     source set against the previous day's, so once a source has been absent
 *     for one full day it is absent from BOTH sides of the comparison and the
 *     day is judged "complete" again. The gate quietly heals around the corpse.
 *   • source_freshness tracks whether the WARMER ran, not whether a particular
 *     stream inside it still produces rows. A warmer can exit "ok" having
 *     written nothing for one platform.
 *
 * Two consecutive silent days is the threshold because one missing day is
 * ordinary (a lagging upstream feed, a late batch); two in a row is not.
 *
 * ⚠️ Density guard: only streams that wrote on at least DEATH_MIN_ACTIVE_DAYS of
 * the trailing window are judged. A genuinely sparse lane (a platform with
 * occasional direct sales) legitimately has quiet days, and a gate that cries
 * wolf gets switched off. Sparse streams are reported as skipped, not silently
 * ignored, so the exemption stays visible.
 */
const DEATH_LOOKBACK_DAYS = 14;
const DEATH_MIN_ACTIVE_DAYS = 7;
// ⚠️ This list is explicit, NOT derived — a new spine metric is not watched until
// it is added here. buyback_payout_usd is dense for the platforms that have it
// (~34 of the query's 35d window), so it clears the density guard and is judged.
const DEATH_METRICS = ["volume_usd", "gacha_volume_usd", "direct_volume_usd", "buyback_payout_usd", "trades"] as const;
/**
 * How many trailing complete days a stream may miss before it counts as dead.
 * Default 2 (one missing day is Dune lag; two is a stopped writer). The buyback
 * stream is the exception BY DESIGN since the Aug '26 credit fix: its query
 * executes every OTHER day (warm-metric-snapshots, maxAgeMs 2*DAY), and the
 * newest bucket trails a further day behind the execution — so 2-3 silent days
 * are the stream's normal breathing, not death. 4 keeps the alarm real (a
 * genuinely dead buyback writer still fails, two days later) without hard-
 * failing every second daily run. This fired for real on Aug 29 — the alarm
 * was correct that the stream was silent, wrong that silence meant death.
 */
const DEATH_RECENT_DAYS: Partial<Record<(typeof DEATH_METRICS)[number], number>> = {
  buyback_payout_usd: 4,
};

async function checkSourceDeath(): Promise<Result> {
  const DAY = 24 * 60 * 60 * 1000;
  const today = Date.parse(dayStartUtc(Date.now()));
  const windowStart = today - DEATH_LOOKBACK_DAYS * DAY;

  const dead: string[] = [];
  let judged = 0;
  let sparse = 0;
  for (const metric of DEATH_METRICS) {
    // The N most recent COMPLETE days (today is still filling up); N is 2 unless
    // the metric declares a slower expected cadence (see DEATH_RECENT_DAYS).
    const recentDays = DEATH_RECENT_DAYS[metric] ?? 2;
    const recent = Array.from({ length: recentDays }, (_, i) => dayStartUtc(today - (i + 1) * DAY));
    const bulk = await readMetricSeriesBulk("platform", metric).catch(() => new Map<string, { ts: string }[]>());
    for (const [entity, points] of bulk) {
      const days = new Set<string>();
      for (const p of points) {
        const t = Date.parse(p.ts);
        if (Number.isFinite(t) && t >= windowStart && t < today) days.add(dayStartUtc(t));
      }
      if (days.size === 0) continue; // not writing in this window at all — not a death, just absent
      if (days.size < DEATH_MIN_ACTIVE_DAYS) { sparse++; continue; }
      judged++;
      if (!recent.some((d) => days.has(d))) {
        const newest = [...days].sort().pop() ?? "—";
        dead.push(
          `${entity}:${metric} — wrote ${days.size}/${DEATH_LOOKBACK_DAYS}d but nothing in the last ${recentDays} complete days (last ${newest.slice(0, 10)})`,
        );
      }
    }
  }

  const detail = `${judged} regular stream(s) checked, ${sparse} sparse skipped (<${DEATH_MIN_ACTIVE_DAYS}/${DEATH_LOOKBACK_DAYS}d)`;
  return dead.length
    ? bad("source-death", "hard", `${dead.length} stream(s) silent past their expected cadence — ${detail}`, dead)
    : ok("source-death", "hard", `no dead streams — ${detail}`);
}

async function main() {
  const strict = process.argv.includes("--strict");
  // --no-dune: skip the two Dune feed checks. For gating a LOCALLY built blob
  // (SNAPSHOT_LOCAL_DIR) where the point is the index invariants and a Dune
  // export would be a paid read for nothing. CI never passes it.
  const noDune = process.argv.includes("--no-dune");
  console.log(`\nData invariants — ${process.env.SUPABASE_URL ?? "(no SUPABASE_URL)"}\n`);

  const results: Result[] = [];
  // Dune feeds (0-credit reads; independent of Supabase).
  if (!noDune) {
    results.push(...(await checkDuneFeed("cc", CC_SECONDARY_QUERY_ID)));
    results.push(...(await checkDuneFeed("courtyard", COURTYARD_SECONDARY_QUERY_ID)));
  }

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
  results.push(await checkIndexStepSanity());
  results.push(await checkHoldingPeriodInvariance());
  results.push(await checkStepNotSingleIdentity());
  results.push(await checkDailyDeltaCompleteness(hp));
  results.push(await checkSourceDeath());

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
