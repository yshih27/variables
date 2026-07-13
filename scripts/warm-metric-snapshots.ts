/**
 * Daily metric-snapshots warmer — appends the long-term time-series spine.
 *
 *   npx tsx scripts/warm-metric-snapshots.ts
 *
 * Writes one row per (entity, metric, UTC-day) into `metric_snapshots`:
 *   • flow  (volume_usd, trades, active_wallets, cards_traded) — COMPLETE-day
 *     aggregates from authoritative per-sale feeds: CC (Dune) + Beezie
 *     (api.beezie.com/activity) + Courtyard (Dune nft.trades, full history).
 *   • gacha (gacha_volume_usd per platform) — daily primary/gacha volume from the
 *     daily-bucketed Dune queries (GACHA_DAILY_QUERY_IDS), full history.
 *   • dominance (entity_type set / grade / platform_ip) — daily volume/trades/
 *     cards per "{ip}:{set}", "{ip}:{grade}", "{platform}:{ip}" so the dominance
 *     panels can render a REAL historical trend (shares computed at read time).
 *   • stock (mcap_usd, holders, floor_usd) — today's reading at market / IP /
 *     platform level; no backfill exists, so it accumulates forward.
 *
 * NOTE: all secondary volume is native/Dune now (no Rarible — it inflated Beezie
 * ~20-90×). Courtyard secondary = Dune nft.trades (full history); per-IP for
 * Courtyard awaits the traded-mint `cards` enrichment, so it's platform-level only.
 *
 * Runs in the DAILY batch AFTER warm-core-dune (fresh) + warm-marketcap +
 * warm-holders so it reads their fresh output. Wrapped in runWarmer so a
 * failure is a visible source_freshness error, not a silent gap.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { fetchCCSecondarySales, fetchCourtyardSecondarySales } from "../src/lib/data/warmers/core";
import { fetchBeezieSales } from "../src/lib/beezie/market";
import { getResultsAutoRefresh } from "../src/lib/dune/client";
import { GACHA_DAILY_QUERY_IDS } from "../src/lib/dune/queryIds";
import { readMarketCap, readMarketCapHistory } from "../src/lib/data/marketcap";
import { sanitizeStockSeries } from "../src/lib/data/indices";
import { readHolders } from "../src/lib/data/holders";
import { readCardDims } from "../src/lib/data/cards";
import type { NormalizedSale } from "../src/lib/rarible/queries";
import {
  writeMetricSnapshots,
  dayStartUtc,
  type MetricRow,
} from "../src/lib/data/metricSnapshots";
import { runWarmer } from "../src/lib/db/runWarmer";

const DAY = 24 * 60 * 60 * 1000;

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
  const ccSales = await fetchCCSecondarySales({ cachedOnly: true });
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

  // ── Courtyard secondary daily flow — Dune nft.trades (full history; off Rarible) ──
  // Platform-level only: Courtyard's `cards` table is empty, so per-IP would all
  // fall to "other" (enable per-IP once the traded-mint enrichment lands).
  try {
    const cySales = await fetchCourtyardSecondarySales({ cachedOnly: true });
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
  } catch (e) {
    console.warn(`  courtyard secondary (Dune) failed: ${(e as Error).message}`);
  }

  // ── Gacha (primary) daily volume → spine (gacha_volume_usd per platform) ──
  // Daily-bucketed Dune queries (full history): CC/Beezie/Phygitals = gacha pulls,
  // Courtyard = tokenization. Summed across pack_price where a query splits tiers.
  for (const [key, qid] of Object.entries(GACHA_DAILY_QUERY_IDS)) {
    try {
      const { rows } = await getResultsAutoRefresh(qid, {
        maxAgeMs: DAY,
        runOpts: { maxWaitMs: 480_000 },
      });
      const byDay = new Map<string, number>();
      for (const r of rows) {
        const raw = String((r as Record<string, unknown>).day ?? "");
        const t = Date.parse(raw.includes("T") ? raw : raw.replace(" UTC", "Z").replace(" ", "T"));
        if (!Number.isFinite(t)) continue;
        const v = Number((r as Record<string, unknown>).volume_usd);
        if (!Number.isFinite(v)) continue;
        const day = dayStartUtc(t);
        byDay.set(day, (byDay.get(day) ?? 0) + v);
      }
      let gd = 0;
      for (const [day, vol] of byDay) {
        if (Date.parse(day) + DAY > now) continue; // exclude today (partial)
        push("platform", key, "gacha_volume_usd", vol, day);
        gd++;
      }
      console.log(`  gacha_volume_usd ${key}: ${gd} days`);
    } catch (e) {
      console.warn(`  gacha daily ${key} failed: ${(e as Error).message}`);
    }
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

  const written = await writeMetricSnapshots(rows);
  const bzVol30 = beezieSales.reduce((a, s) => a + s.priceUsd, 0);
  console.log(
    `Wrote ${written} metric_snapshots rows · CC ${ccDays}d ($${Math.round(ccVolTotal).toLocaleString()}/30d) · ` +
      `Beezie native $${Math.round(bzVol30).toLocaleString()}/30d · dominance ${domRows} rows · ` +
      `mcap $${Math.round(mcap?.totals.mcapUsd ?? 0).toLocaleString()}`,
  );
  return { rowsWritten: written };
}

runWarmer("metric-snapshots", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
