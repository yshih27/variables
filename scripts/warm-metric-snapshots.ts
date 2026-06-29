/**
 * Daily metric-snapshots warmer — appends the long-term time-series spine.
 *
 *   npx tsx scripts/warm-metric-snapshots.ts
 *
 * Writes one row per (entity, metric, UTC-day) into `metric_snapshots`:
 *   • flow  (volume_usd, trades, active_wallets, cards_traded) — COMPLETE-day
 *     aggregates from the AUTHORITATIVE native per-sale feeds: CC 30d (Dune) +
 *     Beezie 30d (api.beezie.com/activity). Idempotent re-bucketing self-corrects.
 *   • dominance (entity_type set / grade / platform_ip) — daily volume/trades/
 *     cards per "{ip}:{set}", "{ip}:{grade}", "{platform}:{ip}" so the dominance
 *     panels can render a REAL historical trend (shares computed at read time).
 *   • stock (mcap_usd, holders, floor_usd) — today's reading at market / IP /
 *     platform level; no backfill exists, so it accumulates forward.
 *
 * NOTE: Beezie + per-IP volume come from the NATIVE feeds, not the Rarible-fed
 * history snapshot — Rarible inflated Beezie's volume ~20-90× (the cause of the
 * 24h-KPI vs daily-spine gap). Courtyard (no native API, low volume) stays on
 * its history snapshot.
 *
 * Runs in the DAILY batch AFTER warm-core-dune (fresh) + warm-marketcap +
 * warm-holders so it reads their fresh output. Wrapped in runWarmer so a
 * failure is a visible source_freshness error, not a silent gap.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { fetchCCSecondarySales } from "../src/lib/data/warmers/core";
import { fetchBeezieSales } from "../src/lib/beezie/market";
import { readHistory } from "../src/lib/data/history";
import { readMarketCap, readMarketCapHistory } from "../src/lib/data/marketcap";
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

  // ── Courtyard daily flow (7d, from history snapshot) — still Rarible-sourced ──
  // Low volume + no native API, so it stays on the history snapshot.
  const cyHist = await readHistory("courtyard");
  if (cyHist && cyHist.buckets.length) {
    const windowStart = Date.parse(cyHist.buckets[0].hourStart);
    const windowEnd = Date.parse(cyHist.generatedAt);
    const byDay = new Map<string, { vol: number; trades: number }>();
    for (const bk of cyHist.buckets) {
      const t = Date.parse(bk.hourStart);
      if (!Number.isFinite(t)) continue;
      const day = dayStartUtc(t);
      const acc = byDay.get(day) ?? { vol: 0, trades: 0 };
      acc.vol += bk.volumeUsd; acc.trades += bk.sales;
      byDay.set(day, acc);
    }
    for (const [day, acc] of byDay) {
      const ds = Date.parse(day);
      if (ds < windowStart || ds + DAY > windowEnd) continue;
      push("platform", "courtyard", "volume_usd", acc.vol, day);
      push("platform", "courtyard", "trades", acc.trades, day);
    }
  }

  // ── Family 2: stock metrics — today's reading (forward only) ──
  const today = dayStartUtc(now);
  const mcap = await readMarketCap();
  if (mcap) {
    push("market", "total", "mcap_usd", mcap.totals.mcapUsd, today);
    for (const [ip, e] of Object.entries(mcap.byIp)) {
      push("ip", ip, "mcap_usd", e.mcapUsd, today);
      if (e.floorUsd > 0) push("ip", ip, "floor_usd", e.floorUsd, today);
    }
    for (const [platform, e] of Object.entries(mcap.byPlatform ?? {})) {
      push("platform", platform, "mcap_usd", e.mcapUsd, today);
    }
  }
  const holders = await readHolders();
  if (holders) {
    for (const [key, n] of Object.entries(holders.platforms)) push("platform", key, "holders", n, today);
    for (const [ip, e] of Object.entries(holders.byIp)) push("ip", ip, "holders", e.total, today);
  }

  // ── Family 3: market + per-IP mcap history backfill (past days, ~30d) ──
  const mcapHist = await readMarketCapHistory();
  const dayMcap = new Map<string, { total: number; byIp: Record<string, number> }>();
  for (const h of mcapHist.hourly) {
    const t = Date.parse(h.at);
    if (!Number.isFinite(t)) continue;
    dayMcap.set(dayStartUtc(t), { total: h.totalMcapUsd, byIp: h.byIp }); // latest-of-day wins
  }
  for (const [day, m] of dayMcap) {
    if (day === today) continue; // today handled by Family 2
    push("market", "total", "mcap_usd", m.total, day);
    for (const [ip, v] of Object.entries(m.byIp)) push("ip", ip, "mcap_usd", v, day);
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
