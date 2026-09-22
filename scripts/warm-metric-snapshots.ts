/**
 * Daily metric-snapshots warmer — appends the long-term time-series spine.
 *
 *   npx tsx scripts/warm-metric-snapshots.ts
 *
 * Writes one row per (entity, metric, UTC-day) into `metric_snapshots`:
 *   • flow  (volume_usd, trades, active_wallets, cards_traded) — COMPLETE-day
 *     aggregates from authoritative per-sale feeds: CC (Dune) + Beezie
 *     (api.beezie.com/activity) + Courtyard (Dune nft.trades, 30d window).
 *   • buyback (buyback_payout_usd per platform) — the other half of net gacha
 *     revenue; same 35d window + complete-day gating as gacha_volume_usd.
 *   • gacha (gacha_volume_usd per platform) — daily primary/gacha volume from the
 *     ONE daily-bucketed multi-platform Dune query (GACHA_DAILY_QUERY_ID), 35d.
 *   • dyli  (volume_usd / gacha_volume_usd / direct_volume_usd) — DYLI's native
 *     /sales feed, split by the lane classifier (src/lib/dyli/lanes.ts) and
 *     reconciled against its own /transactions daily GMV.
 *   • dominance (entity_type set / grade / platform_ip) — daily volume/trades/
 *     cards per "{ip}:{set}", "{ip}:{grade}", "{platform}:{ip}" so the dominance
 *     panels can render a REAL historical trend (shares computed at read time).
 *   • stock (mcap_usd, holders, floor_usd) — today's reading at market / IP /
 *     platform level; no backfill exists, so it accumulates forward.
 *
 * NOTE: all secondary volume is native/Dune now (no Rarible — it inflated Beezie
 * ~20-90×). Courtyard secondary = Dune nft.trades (30d window); per-IP for
 * Courtyard awaits the traded-mint `cards` enrichment, so it's platform-level only.
 *
 * Runs in the DAILY batch AFTER warm-core-dune (fresh) + warm-marketcap +
 * warm-holders so it reads their fresh output. Wrapped in runWarmer so a
 * failure is a visible source_freshness error, not a silent gap.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { fetchCCSecondaryScan, fetchCourtyardSecondaryScan } from "../src/lib/data/warmers/core";
import { scannedCompleteDays } from "../src/lib/dune/scanWindow";
import { foldBuybackRows, reconcileDays } from "../src/lib/data/buybackFold";
import { fetchBeezieSales } from "../src/lib/beezie/market";
import { getResultsAutoRefresh, type DuneRow } from "../src/lib/dune/client";
import { GACHA_DAILY_QUERY_ID, BUYBACK_QUERY_ID } from "../src/lib/dune/queryIds";
import { readDyliSales, fetchDailyGmv } from "../src/lib/dyli/sales";
import { LANE_METRIC } from "../src/lib/dyli/lanes";
import { readMarketCap, readMarketCapHistory } from "../src/lib/data/marketcap";
import { sanitizeStockSeries } from "../src/lib/data/indices";
import { readHolders } from "../src/lib/data/holders";
import { readCardDims } from "../src/lib/data/cards";
import type { NormalizedSale } from "../src/lib/rarible/queries";
import {
  writeMetricSnapshots,
  readMetricSeries,
  dayStartUtc,
  type MetricRow,
} from "../src/lib/data/metricSnapshots";
import { runWarmer } from "../src/lib/db/runWarmer";
import { createHash } from "node:crypto";
import { db } from "../src/lib/db/client";

const DAY = 24 * 60 * 60 * 1000;
const DRY_RUN = process.argv.includes("--dry-run");

/** 8252735's one-character platform codes. Short because every byte of that
 *  result is billed — see dune/buyback-all-platforms.sql. */
const PLATFORM_BY_CODE: Record<string, string> = {
  c: "collector-crypt",
  p: "phygitals",
};

/**
 * Platforms whose `gacha_pulls.buyer` set we trust enough to apply R3 with.
 *
 * ⚠️ NOT "every platform with pulls". Measured 2026-08-19 over an identical 35d
 * window, distinct buyers in `gacha_pulls` vs the spender set Dune derives from
 * on-chain inflow:
 *     collector-crypt   10,167 vs 10,107   ratio 1.006  ← faithful
 *     phygitals          5,796 vs  6,822   ratio 0.850  ← 15% SHORT
 * Phygitals' pull ingestion comes off its own rate-limited API and misses ~1,026
 * spenders. Classifying with it would mark real players as non-spenders, strip
 * their payouts, and overstate net — the exact direction of error this whole
 * reconciliation exists to prevent. So Phygitals' payouts stay GROSS (the pre-R3
 * definition, unchanged) and it gets no basis marker, which keeps its net held
 * on data grounds as well as policy grounds.
 *
 * Removing a platform from this set is safe; adding one requires re-measuring
 * that ratio, because nothing downstream can detect the under-coverage — the
 * cheap query no longer scans inflow, so there is no second opinion to compare.
 */
const R3_CLASSIFIED = new Set<string>(["collector-crypt"]);

/**
 * The recipient key 8252735 emits: sha256(address) hex, first 16 characters,
 * from `substr(to_hex(sha256(to_utf8(to_owner))), 1, 16)`.
 *
 * ⚠️ CASE. Trino's `to_hex` returns UPPERCASE; Node's `digest("hex")` returns
 * lowercase. Both sides are lower-cased here so the comparison cannot depend on
 * which one is doing the hashing. This is not hypothetical tidiness — the first
 * end-to-end run matched 7 recipients out of 10,961 because of exactly this, and
 * the 7 were the hashes that happened to be all digits. A silent near-total miss
 * like that reads as "almost nothing is a player payout", which is a plausible
 * enough number to ship unnoticed. Truncating after hashing is safe either way:
 * case does not move character positions.
 */
function recipientKey(address: string): string {
  return createHash("sha256").update(address, "utf8").digest("hex").slice(0, 16).toLowerCase();
}

/** Re-derive a platform's per-day GROSS outflow from the raw rows. Used only by
 *  the classification sanity gate, to fall back to the pre-R3 definition for a
 *  platform whose spender join has evidently broken. */

/**
 * The R3 spender set, built from our own pull spine rather than a second Dune
 * scan: every wallet that pulled on a platform inside the window, keyed the same
 * way 8252735 keys its recipients.
 *
 * Keyset-paginated because PostgREST caps a page at 1000 rows however large a
 * limit you ask for (verified). ~765k rows over 35d ⇒ a few minutes, which is
 * the same order as warm-player-analytics' full scan and fine for a daily job.
 */
async function loadSpenderKeys(sinceMs: number): Promise<Map<string, Set<string>>> {
  const since = new Date(sinceMs).toISOString();
  const out = new Map<string, Set<string>>();
  const t0 = Date.now();
  let cursor = "";
  let scanned = 0;
  for (let page = 0; page < 5000; page++) {
    const { data, error } = await db()
      .from("gacha_pulls")
      .select("pull_id, platform_id, buyer")
      .gte("pulled_at", since)
      .gt("pull_id", cursor)
      .order("pull_id", { ascending: true })
      .limit(1000);
    if (error) throw new Error(`[buyback] spender scan failed: ${error.message}`);
    const rows = data ?? [];
    if (!rows.length) break;
    for (const r of rows) {
      const platform = String(r.platform_id ?? "");
      const buyer = r.buyer == null ? "" : String(r.buyer);
      if (!platform || !buyer) continue;
      let set = out.get(platform);
      if (!set) out.set(platform, (set = new Set()));
      set.add(recipientKey(buyer));
    }
    scanned += rows.length;
    cursor = String(rows[rows.length - 1].pull_id);
  }
  console.log(
    `  R3 spender set: ${scanned.toLocaleString()} pulls since ${since.slice(0, 10)} in ${((Date.now() - t0) / 1000).toFixed(0)}s · ` +
      [...out].map(([k, v]) => `${k} ${v.size.toLocaleString()}`).join(" · "),
  );
  return out;
}

async function main() {
  const now = Date.now();
  const rows: MetricRow[] = [];
  const push = (
    entity_type: MetricRow["entity_type"],
    entity_key: string,
    metric: string,
    value: number,
    ts: string,
  ) => rows.push({ entity_type, entity_key, metric, value, ts });

  // ── Family 1a: Collector Crypt secondary daily flow (30d, Dune row-level) ──
  const ccScan = await fetchCCSecondaryScan({ cachedOnly: true });
  const ccSales = ccScan.sales;
  let ccWindowStart = Infinity;
  for (const s of ccSales) {
    const t = Date.parse(s.date);
    if (Number.isFinite(t) && t < ccWindowStart) ccWindowStart = t;
  }
  const ccByDay = new Map<string, { vol: number; trades: number; wallets: Set<string> }>();
  for (const s of ccSales) {
    const t = Date.parse(s.date);
    if (!Number.isFinite(t)) continue;
    const day = dayStartUtc(t);
    let b = ccByDay.get(day);
    if (!b) { b = { vol: 0, trades: 0, wallets: new Set() }; ccByDay.set(day, b); }
    b.vol += s.priceUsd;
    b.trades += 1;
    if (s.buyer) b.wallets.add(s.buyer);
    if (s.seller) b.wallets.add(s.seller);
  }
  let ccDays = 0;
  let ccVolTotal = 0;
  for (const [day, b] of ccByDay) {
    const ds = Date.parse(day);
    if (ds < ccWindowStart || ds + DAY > now) continue; // complete days only
    push("platform", "collector-crypt", "volume_usd", b.vol, day);
    push("platform", "collector-crypt", "trades", b.trades, day);
    push("platform", "collector-crypt", "active_wallets", b.wallets.size, day);
    ccDays++;
    ccVolTotal += b.vol;
  }
  // A complete day the scan covered and found no sale on is a measured zero,
  // not a gap (src/lib/dune/scanWindow.ts). Written as 0 so the stream never
  // reads as dead on a quiet day; days the execution had not reached stay blank.
  const ccZeroDays = scannedCompleteDays(ccScan.executionEndedAt, ccScan.windowDays).filter((d) => !ccByDay.has(d));
  for (const day of ccZeroDays) {
    push("platform", "collector-crypt", "volume_usd", 0, day);
    push("platform", "collector-crypt", "trades", 0, day);
    push("platform", "collector-crypt", "active_wallets", 0, day);
  }
  if (ccZeroDays.length) console.log(`  collector-crypt secondary: ${ccZeroDays.length} scanned day(s) with no sale written as 0 (${ccZeroDays.map((d) => d.slice(0, 10)).join(", ")})`);

  // ── Native per-sale daily flow + dominance (CC Dune 30d + Beezie /activity 30d) ──
  // Tag each sale with its card's precomputed ip/set/grade (the `cards` table) and
  // bucket per UTC day. This reconciles per-IP + Beezie volume to the native feeds
  // over 30d (the history path drew Beezie from Rarible → ~20-90× inflated) AND
  // records per-set/grade/platform-IP dominance so those panels grow a real trend.
  const beezieSales = await fetchBeezieSales(30 * DAY).catch((e) => {
    console.warn(`  beezie /activity failed: ${(e as Error).message}`);
    return [] as NormalizedSale[];
  });
  const ccDims = await readCardDims("collector-crypt");
  const bzDims = await readCardDims("beezie");

  type Tagged = {
    date: string; tokenId: string; priceUsd: number;
    platform: "collector-crypt" | "beezie"; ip: string; set: string | null; grade: string;
  };
  const tagged: Tagged[] = [];
  const tag = (
    s: NormalizedSale,
    platform: "collector-crypt" | "beezie",
    dims: Map<string, { ip: string; set: string | null; grade: string }>,
  ) => {
    const d = dims.get(s.tokenId);
    tagged.push({
      date: s.date, tokenId: s.tokenId, priceUsd: s.priceUsd, platform,
      ip: d?.ip ?? "other", set: d?.set ?? null, grade: d?.grade ?? "Ungraded",
    });
  };
  for (const s of ccSales) tag(s, "collector-crypt", ccDims);
  for (const s of beezieSales) tag(s, "beezie", bzDims);

  // Complete-day window both feeds cover: later of the two oldest sale times,
  // fully elapsed (excludes the partial boundary day + today).
  const oldestOf = (arr: NormalizedSale[]) =>
    arr.reduce((m, s) => { const t = Date.parse(s.date); return Number.isFinite(t) && t < m ? t : m; }, Infinity);
  const ccOldest = oldestOf(ccSales);
  const bzOldest = oldestOf(beezieSales);
  const nativeStart = Math.max(
    ccOldest === Infinity ? -Infinity : ccOldest,
    bzOldest === Infinity ? -Infinity : bzOldest,
  );
  const completeDay = (day: string) => {
    const ds = Date.parse(day);
    return ds >= nativeStart && ds + DAY <= now;
  };

  type Acc = { vol: number; trades: number; cards: Set<string> };
  const blank = (): Acc => ({ vol: 0, trades: 0, cards: new Set() });
  const ipDay = new Map<string, Map<string, Acc>>();
  const setDay = new Map<string, Map<string, Acc>>();
  const gradeDay = new Map<string, Map<string, Acc>>();
  const platIpDay = new Map<string, Map<string, Acc>>();
  const bzPlatDay = new Map<string, Acc>();
  const bump = (m: Map<string, Map<string, Acc>>, day: string, key: string, t: Tagged) => {
    let dm = m.get(day); if (!dm) { dm = new Map(); m.set(day, dm); }
    let a = dm.get(key); if (!a) { a = blank(); dm.set(key, a); }
    a.vol += t.priceUsd; a.trades += 1; a.cards.add(`${t.platform}:${t.tokenId}`);
  };
  for (const t of tagged) {
    const ms = Date.parse(t.date);
    if (!Number.isFinite(ms)) continue;
    const day = dayStartUtc(ms);
    bump(ipDay, day, t.ip, t);
    if (t.set) bump(setDay, day, `${t.ip}:${t.set}`, t);
    bump(gradeDay, day, `${t.ip}:${t.grade}`, t);
    bump(platIpDay, day, `${t.platform}:${t.ip}`, t);
    if (t.platform === "beezie") {
      let a = bzPlatDay.get(day); if (!a) { a = blank(); bzPlatDay.set(day, a); }
      a.vol += t.priceUsd; a.trades += 1;
    }
  }

  // per-IP daily volume + trades (native 30d — replaces the inflated history path)
  for (const [day, dm] of ipDay) {
    if (!completeDay(day)) continue;
    for (const [ip, a] of dm) {
      push("ip", ip, "volume_usd", a.vol, day);
      push("ip", ip, "trades", a.trades, day);
    }
  }
  // Beezie platform daily volume + trades (native; CC platform handled by 1a)
  for (const [day, a] of bzPlatDay) {
    if (!completeDay(day)) continue;
    push("platform", "beezie", "volume_usd", a.vol, day);
    push("platform", "beezie", "trades", a.trades, day);
  }
  // dominance: per-set / per-grade / per-platform-IP (volume + trades + cards)
  let domRows = 0;
  const pushDom = (m: Map<string, Map<string, Acc>>, et: MetricRow["entity_type"]) => {
    for (const [day, dm] of m) {
      if (!completeDay(day)) continue;
      for (const [key, a] of dm) {
        push(et, key, "volume_usd", a.vol, day);
        push(et, key, "trades", a.trades, day);
        push(et, key, "cards", a.cards.size, day);
        domRows += 3;
      }
    }
  };
  pushDom(setDay, "set");
  pushDom(gradeDay, "grade");
  pushDom(platIpDay, "platform_ip");

  // ── Family 1d: per-IP active_wallets + cards_traded from CC's 30d sale rows ──
  const ccIpByDay = new Map<string, Map<string, { wallets: Set<string>; cards: Set<string> }>>();
  for (const s of ccSales) {
    const t = Date.parse(s.date);
    if (!Number.isFinite(t)) continue;
    const day = dayStartUtc(t);
    const ip = ccDims.get(s.tokenId)?.ip ?? "other";
    let dayMap = ccIpByDay.get(day);
    if (!dayMap) { dayMap = new Map(); ccIpByDay.set(day, dayMap); }
    let acc = dayMap.get(ip);
    if (!acc) { acc = { wallets: new Set(), cards: new Set() }; dayMap.set(ip, acc); }
    if (s.buyer) acc.wallets.add(s.buyer);
    if (s.seller) acc.wallets.add(s.seller);
    if (s.tokenId) acc.cards.add(s.tokenId);
  }
  for (const [day, dayMap] of ccIpByDay) {
    if (!completeDay(day)) continue;
    for (const [ip, acc] of dayMap) {
      push("ip", ip, "active_wallets", acc.wallets.size, day);
      push("ip", ip, "cards_traded", acc.cards.size, day);
    }
  }

  // ── Courtyard secondary daily flow — Dune nft.trades (30d window; off Rarible) ──
  // The 30d window is not a history loss: these pushes are idempotent upserts, so
  // days already in the spine stay put and only the trailing 30d get rewritten.
  // Platform-level only: Courtyard's `cards` table is empty, so per-IP would all
  // fall to "other" (enable per-IP once the traded-mint enrichment lands).
  try {
    const cyScan = await fetchCourtyardSecondaryScan({ cachedOnly: true });
    const cySales = cyScan.sales;
    const cyOldest = oldestOf(cySales);
    const cyByDay = new Map<string, { vol: number; trades: number }>();
    for (const s of cySales) {
      const t = Date.parse(s.date);
      if (!Number.isFinite(t)) continue;
      const day = dayStartUtc(t);
      const acc = cyByDay.get(day) ?? { vol: 0, trades: 0 };
      acc.vol += s.priceUsd; acc.trades += 1;
      cyByDay.set(day, acc);
    }
    for (const [day, acc] of cyByDay) {
      const ds = Date.parse(day);
      if (ds < cyOldest || ds + DAY > now) continue; // complete days only
      push("platform", "courtyard", "volume_usd", acc.vol, day);
      push("platform", "courtyard", "trades", acc.trades, day);
    }
    // ⚠️ Measured 2026-09-22: ~6 OpenSea trades a day; Sep 20 had none and the
    // stream read as dead. A scanned, saleless complete day is written as 0.
    const cyZeroDays = scannedCompleteDays(cyScan.executionEndedAt, cyScan.windowDays).filter((d) => !cyByDay.has(d));
    for (const day of cyZeroDays) {
      push("platform", "courtyard", "volume_usd", 0, day);
      push("platform", "courtyard", "trades", 0, day);
    }
    console.log(
      `  courtyard secondary: ${cyByDay.size} day(s) with sales, ${cyZeroDays.length} scanned day(s) written as 0` +
        (cyScan.executionEndedAt ? ` · scan through ${cyScan.executionEndedAt.slice(0, 16)}` : " · execution time unknown, no zero-fill"),
    );
  } catch (e) {
    console.warn(`  courtyard secondary (Dune) failed: ${(e as Error).message}`);
  }

  // ── Gacha (primary) daily volume → spine (gacha_volume_usd per platform) ──
  // Daily-bucketed combined Dune query (35d): CC/Beezie/Phygitals = gacha pulls,
  // Courtyard = tokenization. Summed across pack_price where a query splits tiers.
  // ONE execution for every platform (was four); split on the `platform` column.
  try {
    const { rows } = await getResultsAutoRefresh(GACHA_DAILY_QUERY_ID, {
      maxAgeMs: DAY,
      freshnessSource: "metric-snapshots",
      runOpts: { maxWaitMs: 480_000 },
    });
    // Never null: reuse is opt-in and the spine needs the rows to push days.
    if (rows === null) throw new Error("gacha-daily returned an unrequested reuse signal");
    const byPlatformDay = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const rec = r as Record<string, unknown>;
      const key = String(rec.platform ?? "");
      if (!key) continue;
      const raw = String(rec.day ?? "");
      const t = Date.parse(raw.includes("T") ? raw : raw.replace(" UTC", "Z").replace(" ", "T"));
      if (!Number.isFinite(t)) continue;
      const v = Number(rec.volume_usd);
      if (!Number.isFinite(v)) continue;
      const day = dayStartUtc(t);
      let days = byPlatformDay.get(key);
      if (!days) byPlatformDay.set(key, (days = new Map()));
      days.set(day, (days.get(day) ?? 0) + v);
    }
    for (const [key, byDay] of byPlatformDay) {
      // The query is windowed (35d), so its OLDEST day is clipped by the window
      // boundary — a partial. Publishing it would overwrite a complete stored day
      // with a smaller number (verified: it is the only day that disagrees with
      // the unwindowed query). Skipping is always safe here because the spine
      // upserts and never deletes: the complete value simply stays put.
      const oldest = [...byDay.keys()].sort()[0];
      let gd = 0;
      for (const [day, vol] of byDay) {
        if (day === oldest) continue; // partial leading edge of the window
        if (Date.parse(day) + DAY > now) continue; // exclude today (partial)
        push("platform", key, "gacha_volume_usd", vol, day);
        gd++;
      }
      console.log(`  gacha_volume_usd ${key}: ${gd} days`);
    }
  } catch (e) {
    console.warn(`  gacha daily (combined) failed: ${(e as Error).message}`);
  }

  // ── Buyback payouts daily → spine (buyback_payout_usd per platform) ───────
  // The other half of net gacha revenue. Same shape, same 35d window and the
  // same complete-day gating as gacha_volume_usd, so the two series can be
  // subtracted day-for-day without ever mixing bases. Only platforms with a
  // known on-chain buyback wallet appear (CC, Phygitals) — a platform whose
  // payout side is unsourced simply has no rows here, which is what keeps
  // fetchPlatform from computing spend-minus-zero.
  //
  // ⚠️ TWO SERIES FROM ONE PER-RECIPIENT RESULT. 8252735 no longer does the R3
  // test itself — it returns `{p,d,w,n,u}`, one row per recipient per day, and
  // the spender test happens HERE against our own `gacha_pulls.buyer`. Doing it
  // this way is a COST decision, measured, not a style preference: R3 inside Dune
  // needed a second scan of tokens_solana.transfers and came to 71.2 cr/run,
  // while one scan plus a wider export comes to 42.9 cr/run. See the PR.
  //
  //   `outflow_gross_usd`   Σ u over the day — every outflow bar the internal
  //                         list. Byte-identical to what the pre-R3 query
  //                         published as `payout_usd`.
  //   `buyback_payout_usd`  Σ u over the day, RESTRICTED to recipients that also
  //                         spent into this platform's gacha (rule R3).
  //
  // They are separate metrics and are never summed together. `outflow_gross_usd`
  // doubles as the R3 BASIS MARKER — fetchPlatform publishes a net figure only
  // for days carrying it — so it is written ONLY for platforms whose spender set
  // we actually trust (see R3_CLASSIFIED below). Everything here is defensive
  // about the row shape so a rollback to the pre-R3 query degrades rather than
  // crashes.
  // SINGLE PAYER, 2-DAY CADENCE (Aug '26 credit crisis). This is now the ONLY
  // reader of the buyback query — warm-gacha-dune's read fed a blob field
  // nothing consumed. The per-recipient export grew ~47K → ~241K rows with
  // August's volume (~240 cr per execution+read at 1cr/1K datapoints), so it
  // executes every OTHER day and `reuseIfUnchanged` skips the re-download in
  // between. Cost of the cadence: the payout/gross series (and therefore the
  // published net) trail one day further on off days — fetchPlatform already
  // holds net for days without a basis marker, so the lag is honest, not wrong.
  let bbRows: DuneRow[] | null = null;
  try {
    ({ rows: bbRows } = await getResultsAutoRefresh(BUYBACK_QUERY_ID, {
      maxAgeMs: 2 * DAY,
      freshnessSource: "metric-snapshots",
      reuseIfUnchanged: true,
      runOpts: { maxWaitMs: 600_000 },
    }));
  } catch (e) {
    console.warn(`  buyback read failed: ${(e as Error).message} — spine rows stand`);
  }
  if (bbRows === null) {
    console.log("  buyback: no new export this run — spine rows stand (2d cadence)");
  } else try {
    // The fold (src/lib/data/buybackFold.ts) accepts the two-tier shape the
    // query emits since 2026-09-22 (per-recipient rows for 9 days, one gross
    // row a day for 35) AND the older per-recipient-only shape, so the loader
    // can ship before the query is re-applied on Dune.
    const spenders = await loadSpenderKeys(now - 35 * DAY);
    const fold = foldBuybackRows(bbRows, { spenders, trusted: R3_CLASSIFIED, platformByCode: PLATFORM_BY_CODE, nowMs: now, dayStartUtc });
    for (const w of fold.warnings) console.warn(`  ⚠ ${w}`);
    for (const [key, m] of fold.match) {
      if (m.rate >= 0.5) console.log(`  R3 match ${key}: ${m.hit.toLocaleString()}/${m.seen.toLocaleString()} recipients (${(m.rate * 100).toFixed(1)}%)`);
    }
    if (fold.stats.legacyRows > 0) {
      console.warn(
        `  ⚠ buyback: ${fold.stats.legacyRows} rows in the PRE-R3 shape — query ${BUYBACK_QUERY_ID} has been rolled back. Writing the gross series as payouts and NO basis marker, so net revenue stays held.`,
      );
    }
    console.log(
      fold.basis === "r3"
        ? `  buyback basis: R3 (${fold.stats.recipientRows.toLocaleString()} per-recipient rows over ${fold.stats.recipientDays}d · ` +
            (fold.stats.grossFromRecipients
              ? "gross summed from them — the single-tier query is still live on Dune, apply dune/buyback-all-platforms.sql"
              : `${fold.stats.grossRows.toLocaleString()} gross rows`) +
            `) · classified: ${[...R3_CLASSIFIED].join(", ")}`
        : `  ⚠ buyback basis: PRE-R3 — query ${BUYBACK_QUERY_ID} returned no per-recipient rows, so payouts are gross-of-list and net revenue stays held. Apply dune/buyback-all-platforms.sql.`,
    );

    for (const [key, byDay] of fold.payouts) {
      const covered = fold.payoutDays.get(key) ?? new Set<string>();
      let pushed = 0;
      let sumWin = 0;
      for (const [day, usd] of byDay) {
        if (!covered.has(day)) continue;
        push("platform", key, "buyback_payout_usd", usd, day);
        pushed++;
        sumWin += usd;
      }
      // Reconcile over the days the recipient tier covers AND the spine has —
      // settled days (≥3d old) carry the alarm; the newest days are still
      // filling upstream and are reported as the restatement they are.
      const stored = await readMetricSeries("platform", key, "buyback_payout_usd").catch(() => []);
      const storedByDay = new Map(stored.map((p) => [dayStartUtc(Date.parse(p.ts)), p.value] as const));
      const rec = reconcileDays(byDay, storedByDay, covered, now);
      if (rec.settledStored > 0 && rec.settledDrift > 0.05) {
        console.warn(
          `  ⚠ buyback reconciliation ${key}: ${rec.settledDays} settled day(s) source Σ $${Math.round(rec.settledSource).toLocaleString()} vs spine Σ $${Math.round(rec.settledStored).toLocaleString()} (${(rec.settledDrift * 100).toFixed(1)}%) — restated upstream, or a bad earlier write`,
        );
        for (const p of rec.perDay) if (Date.parse(p.day) + 3 * DAY <= now && Math.abs(p.source - p.stored) > 0.05 * Math.max(1, p.stored)) console.warn(`      ${p.day.slice(0, 10)}  source $${Math.round(p.source).toLocaleString()} · spine $${Math.round(p.stored).toLocaleString()}`);
      }
      console.log(
        `  buyback_payout_usd ${key}: ${pushed} days · ${covered.size}d $${Math.round(sumWin).toLocaleString()}` +
          (rec.sharedDays === 0
            ? " (first write)"
            : ` · settled ${rec.settledDays}d ${(rec.settledDrift * 100).toFixed(1)}% drift` +
              (rec.freshDays ? ` · fresh ${rec.freshDays}d $${Math.round(rec.freshSource).toLocaleString()} vs spine $${Math.round(rec.freshStored).toLocaleString()} (upstream still filling)` : "")),
      );
    }

    for (const [key, byDay] of fold.gross) {
      const covered = fold.grossDays.get(key) ?? new Set<string>();
      const payoutDays = fold.payouts.get(key);
      const payoutCovered = fold.payoutDays.get(key) ?? new Set<string>();
      let pushed = 0;
      let sum30 = 0;
      for (const [day, usd] of byDay) {
        if (!covered.has(day)) continue;
        push("platform", key, "outflow_gross_usd", usd, day);
        pushed++;
        if (Date.parse(day) >= now - 30 * DAY) sum30 += usd;
      }
      let inverted = 0;
      for (const [day, grossUsd] of byDay) {
        const pay = payoutDays?.get(day);
        if (pay != null && pay > grossUsd + 0.01) inverted++;
      }
      if (inverted > 0) {
        console.warn(
          `  ⚠ outflow_gross_usd ${key}: ${inverted} day(s) where R3 payout EXCEEDS gross outflow — the two columns disagree on scope, do not publish a net figure off this run`,
        );
      }
      // The verified share is read over the days BOTH tiers cover.
      let paidCovered = 0;
      let grossCovered = 0;
      for (const day of payoutCovered) {
        if (!covered.has(day)) continue;
        paidCovered += payoutDays?.get(day) ?? 0;
        grossCovered += byDay.get(day) ?? 0;
      }
      console.log(
        `  outflow_gross_usd ${key}: ${pushed} days · 30d $${Math.round(sum30).toLocaleString()}` +
          (grossCovered > 0 ? ` · R3 verifies ${((paidCovered / grossCovered) * 100).toFixed(2)}% over the ${payoutCovered.size} classified days` : ""),
      );
    }
  } catch (e) {
    console.warn(`  buyback daily failed: ${(e as Error).message}`);
  }

  // ── DYLI daily flow — native /sales, split by the lane classifier ──────────
  // One row store, three published metrics: marketplace resale → volume_usd,
  // mystery boxes → gacha_volume_usd, first sales that are NOT random-outcome →
  // direct_volume_usd. `excluded` rows (zero-price claims, eBay-venue) are
  // stored but never published — see src/lib/dyli/lanes.ts for the evidence
  // behind each branch.
  try {
    const rows = await readDyliSales();
    const byMetricDay = new Map<string, Map<string, number>>();
    const salesByDay = new Map<string, number>();
    // Daily TRADE COUNT, marketplace lane only. `trades` means the same thing on
    // every platform that publishes it — a secondary-market sale — so a first
    // sale (box / fair drop / inventory purchase) must not be counted here even
    // though it is a row in the same store. Without this DYLI was the one
    // platform with a volume_usd series and no trades series, which made the
    // platform page's Trades card render "no secondary-sales source yet" — false:
    // the source exists (core-volume already builds DYLI's live 24h stats from
    // these very rows), only the daily series was missing.
    const tradesByDay = new Map<string, number>();
    for (const r of rows) {
      if (r.lane === "excluded") continue;
      const t = Date.parse(r.sold_at);
      const usd = Number(r.price_usd);
      if (!Number.isFinite(t) || !Number.isFinite(usd)) continue;
      const day = dayStartUtc(t);
      const metric = LANE_METRIC[r.lane];
      let days = byMetricDay.get(metric);
      if (!days) byMetricDay.set(metric, (days = new Map()));
      days.set(day, (days.get(day) ?? 0) + usd);
      salesByDay.set(day, (salesByDay.get(day) ?? 0) + usd);
      // Priced resale only — a $0 row is not a trade anyone can read a price off,
      // and counting it would make avgTrade (vol ÷ trades) sag for free reasons.
      if (r.lane === "marketplace" && usd > 0) {
        tradesByDay.set(day, (tradesByDay.get(day) ?? 0) + 1);
      }
    }
    let pushed = 0;
    for (const [metric, days] of byMetricDay) {
      for (const [day, vol] of days) {
        if (Date.parse(day) + DAY > now) continue; // exclude today (partial)
        push("platform", "dyli", metric, vol, day);
        pushed++;
      }
    }
    let tradeDays = 0;
    for (const [day, n] of tradesByDay) {
      if (Date.parse(day) + DAY > now) continue; // same partial-day rule
      push("platform", "dyli", "trades", n, day);
      tradeDays++;
    }
    console.log(
      `  dyli: ${pushed} day-metrics across ${byMetricDay.size} lanes · trades ${tradeDays} days`,
    );

    // ── Two-source reconciliation, on the RATIO not the level ────────────────
    // /transactions is DYLI's own daily GMV, derived independently of the sale
    // rows we page. The two will never match: /sales applies default
    // `excluded_products: ["is_pod","live=false"]` and we additionally drop the
    // excluded lanes, while /transactions counts every transaction (~631K tx
    // against ~398K sale rows). That gap sits around 50% and is STRUCTURAL.
    //
    // So an absolute-difference check just prints "diverged" on every single day
    // forever, which trains everyone to ignore it. What actually carries signal
    // is our coverage RATIO (Σ our lanes ÷ GMV) moving away from where it has
    // been sitting — that means one of the two feeds changed shape: a new
    // channel we aren't classifying, a lane silently dropping out, an upstream
    // definition change. Baseline is the trailing mean; we alert when a recent
    // day departs from it by more than RECON_DRIFT_PP percentage points.
    const RECON_DRIFT_PP = 10;
    const RECON_BASELINE_DAYS = 30;
    const RECON_CHECK_DAYS = 7;
    const gmv = await fetchDailyGmv().catch((e) => {
      console.warn(`  dyli reconciliation skipped: ${(e as Error).message}`);
      return [] as Awaited<ReturnType<typeof fetchDailyGmv>>;
    });
    const ratios: { day: string; pct: number }[] = [];
    for (const g of gmv) {
      const dayIso = dayStartUtc(Date.parse(g.day));
      if (Date.parse(dayIso) + DAY > now) continue; // complete days only
      const ours = salesByDay.get(dayIso);
      if (ours === undefined || !(g.gmv > 0)) continue;
      ratios.push({ day: dayIso.slice(0, 10), pct: (ours / g.gmv) * 100 });
    }
    ratios.sort((a, b) => a.day.localeCompare(b.day));
    const window = ratios.slice(-RECON_BASELINE_DAYS);
    if (window.length >= 2) {
      const baseline = window.reduce((s, r) => s + r.pct, 0) / window.length;
      const recent = window.slice(-RECON_CHECK_DAYS);
      const drifted = recent.filter((r) => Math.abs(r.pct - baseline) > RECON_DRIFT_PP);
      console.log(
        `  dyli reconciliation: coverage ${baseline.toFixed(1)}% of /transactions GMV ` +
          `(trailing ${window.length}d baseline) · last ${recent.length}d within ±${RECON_DRIFT_PP}pp: ${recent.length - drifted.length}/${recent.length}`,
      );
      for (const r of drifted) {
        console.warn(
          `  ⚠ dyli coverage drift ${r.day}: ${r.pct.toFixed(1)}% vs ${baseline.toFixed(1)}% baseline ` +
            `(${(r.pct - baseline >= 0 ? "+" : "") + (r.pct - baseline).toFixed(1)}pp) — a lane or channel may have changed shape`,
        );
      }
    } else if (ratios.length) {
      console.log(`  dyli reconciliation: only ${ratios.length} comparable day(s) — baseline not established yet`);
    }
  } catch (e) {
    console.warn(`  dyli daily failed: ${(e as Error).message}`);
  }

  // ── Family 2: stock metrics — today's reading (forward only) ──
  const today = dayStartUtc(now);
  const mcap = await readMarketCap();
  if (mcap) {
    // mcap is a STOCK metric — a $0 reading is never real (failed/empty scan), and
    // it makes rebased charts dip to zero. Only record strictly-positive values.
    if (mcap.totals.mcapUsd > 0) push("market", "total", "mcap_usd", mcap.totals.mcapUsd, today);
    for (const [ip, e] of Object.entries(mcap.byIp)) {
      if (e.mcapUsd > 0) push("ip", ip, "mcap_usd", e.mcapUsd, today);
      if (e.floorUsd > 0) push("ip", ip, "floor_usd", e.floorUsd, today);
    }
    for (const [platform, e] of Object.entries(mcap.byPlatform ?? {})) {
      if (e.mcapUsd > 0) push("platform", platform, "mcap_usd", e.mcapUsd, today);
    }
  }
  const holders = await readHolders();
  if (holders) {
    // holders is a STOCK metric too — 0 for a live platform means "couldn't measure"
    // (e.g. Helius outage), not "no holders". Skip zeros so the spine keeps the last
    // real reading instead of a false drop to 0. (warm-holders itself now carries the
    // last-known-good forward on scan failure — this is defense in depth.)
    for (const [key, n] of Object.entries(holders.platforms)) {
      if (n > 0) push("platform", key, "holders", n, today);
    }
    for (const [ip, e] of Object.entries(holders.byIp)) {
      if (e.total > 0) push("ip", ip, "holders", e.total, today);
    }
    // market/total = the TRUE cross-platform UNIQUE-holder UNION (dedupes wallets on
    // both CC + Phygitals, which are both Solana) — the SAME figure the homepage hero
    // shows (fetchHomepage.ts), NOT a platform-sum (that re-introduces the double-count
    // we deliberately removed). Forward-only: there's no per-day wallet-set history to
    // backfill a past union from, so the /ips holders bar fills forward (~2 weeks).
    const holderUnion =
      holders.totalHolders ?? Object.values(holders.platforms).reduce((s, n) => s + (Number(n) || 0), 0);
    if (holderUnion > 0) push("market", "total", "holders", holderUnion, today);
  }

  // ── Family 3: market + per-IP mcap history backfill (past days, ~30d) ──
  // The marketcap-history blob can carry legacy junk: $0 totals from pre-guard
  // empty-scan days, and an isolated seed reading weeks before continuous coverage.
  // sanitizeStockSeries drops non-positive readings AND trims that leading orphan,
  // so the spine's mcap series starts at its true continuous inception (no dip-to-0
  // on rebased charts). Per-IP values are guarded > 0 the same way.
  const mcapHist = await readMarketCapHistory();
  const dayMcap = new Map<string, { total: number; byIp: Record<string, number> }>();
  for (const h of mcapHist.hourly) {
    const t = Date.parse(h.at);
    if (!Number.isFinite(t)) continue;
    dayMcap.set(dayStartUtc(t), { total: h.totalMcapUsd, byIp: h.byIp }); // latest-of-day wins
  }
  const keptMarket = sanitizeStockSeries(
    [...dayMcap.entries()].map(([ts, m]) => ({ ts, value: m.total })),
  );
  for (const p of keptMarket) {
    if (p.ts === today) continue; // today handled by Family 2
    push("market", "total", "mcap_usd", p.value, p.ts);
    for (const [ip, v] of Object.entries(dayMcap.get(p.ts)?.byIp ?? {})) {
      if (v > 0) push("ip", ip, "mcap_usd", v, p.ts);
    }
  }

  let written = 0;
  if (DRY_RUN) {
    const byMetric = new Map<string, number>();
    for (const r of rows) byMetric.set(`${r.entity_type}:${r.entity_key}:${r.metric}`, (byMetric.get(`${r.entity_type}:${r.entity_key}:${r.metric}`) ?? 0) + 1);
    console.log(`DRY RUN — ${rows.length} rows NOT written:`);
    for (const [k, n] of [...byMetric].sort()) if (k.startsWith("platform:")) console.log(`  ${k} × ${n}`);
  } else {
    written = await writeMetricSnapshots(rows);
  }
  const bzVol30 = beezieSales.reduce((a, s) => a + s.priceUsd, 0);
  console.log(
    `Wrote ${written} metric_snapshots rows · CC ${ccDays}d ($${Math.round(ccVolTotal).toLocaleString()}/30d) · ` +
      `Beezie native $${Math.round(bzVol30).toLocaleString()}/30d · dominance ${domRows} rows · ` +
      `mcap $${Math.round(mcap?.totals.mcapUsd ?? 0).toLocaleString()}`,
  );
  return { rowsWritten: written };
}

// --dry-run: every read, no write, no freshness stamp — for verifying a change to this writer.
(DRY_RUN ? main() : runWarmer("metric-snapshots", main)).catch((e) => {
  console.error(e);
  process.exit(1);
});
