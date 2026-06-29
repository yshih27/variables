/**
 * Daily metric-snapshots warmer — appends the long-term time-series spine.
 *
 *   npx tsx scripts/warm-metric-snapshots.ts
 *
 * Writes one row per (entity, metric, UTC-day) into `metric_snapshots`:
 *   • flow  (volume_usd, trades, active_wallets) — COMPLETE-day aggregates
 *     backfilled from row-level history: CC 30d (Dune), Beezie/Courtyard 7d
 *     (history snapshot). Idempotent re-bucketing self-corrects late days.
 *   • stock (mcap_usd, holders, floor_usd) — today's reading at market / IP /
 *     platform level; no backfill exists, so it accumulates forward.
 *
 * Runs in the DAILY batch AFTER warm-core-dune (fresh) + warm-marketcap +
 * warm-holders so it reads their fresh output. Wrapped in runWarmer so a
 * failure is a visible source_freshness error, not a silent gap.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { fetchCCSecondarySales } from "../src/lib/data/warmers/core";
import { readHistory, readIpHistory } from "../src/lib/data/history";
import { readMarketCap, readMarketCapHistory } from "../src/lib/data/marketcap";
import { readHolders } from "../src/lib/data/holders";
import { readCardValuations } from "../src/lib/data/cards";
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
  // The Dune query returns every on-chain sale over 30d; bucket by UTC day.
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
    if (!b) {
      b = { vol: 0, trades: 0, wallets: new Set() };
      ccByDay.set(day, b);
    }
    b.vol += s.priceUsd;
    b.trades += 1;
    if (s.buyer) b.wallets.add(s.buyer);
    if (s.seller) b.wallets.add(s.seller);
  }
  let ccDays = 0;
  let ccVolTotal = 0;
  for (const [day, b] of ccByDay) {
    const ds = Date.parse(day);
    // COMPLETE days only: fully inside the data window AND fully elapsed.
    if (ds < ccWindowStart || ds + DAY > now) continue;
    push("platform", "collector-crypt", "volume_usd", b.vol, day);
    push("platform", "collector-crypt", "trades", b.trades, day);
    push("platform", "collector-crypt", "active_wallets", b.wallets.size, day);
    ccDays++;
    ccVolTotal += b.vol;
  }

  // ── Family 1d: per-IP active_wallets + cards_traded from CC's 30d sale rows ──
  // by-ip history (1c) gives per-IP volume/trades but not uniques; attribute each
  // CC sale's mint to an IP (cards.ip_key) for daily unique wallets + cards. CC-only
  // (the dominant platform for these IPs); completes the IP Activity chart's 5 metrics.
  const ccMintToIp = new Map<string, string>();
  for (const c of await readCardValuations("collector-crypt")) ccMintToIp.set(c.tokenId, c.ipKey);
  const ccIpByDay = new Map<string, Map<string, { wallets: Set<string>; cards: Set<string> }>>();
  for (const s of ccSales) {
    const t = Date.parse(s.date);
    if (!Number.isFinite(t)) continue;
    const day = dayStartUtc(t);
    const ip = ccMintToIp.get(s.tokenId) ?? "other";
    let dayMap = ccIpByDay.get(day);
    if (!dayMap) {
      dayMap = new Map();
      ccIpByDay.set(day, dayMap);
    }
    let acc = dayMap.get(ip);
    if (!acc) {
      acc = { wallets: new Set(), cards: new Set() };
      dayMap.set(ip, acc);
    }
    if (s.buyer) acc.wallets.add(s.buyer);
    if (s.seller) acc.wallets.add(s.seller);
    if (s.tokenId) acc.cards.add(s.tokenId);
  }
  for (const [day, dayMap] of ccIpByDay) {
    const ds = Date.parse(day);
    if (ds < ccWindowStart || ds + DAY > now) continue; // complete days only
    for (const [ip, acc] of dayMap) {
      push("ip", ip, "active_wallets", acc.wallets.size, day);
      push("ip", ip, "cards_traded", acc.cards.size, day);
    }
  }

  // ── Family 1b: Beezie + Courtyard daily flow (7d, from history snapshot) ──
  // history:<key> holds 168 hourly buckets; roll them up to complete UTC days
  // bounded by the snapshot's own window (it may be a few hours old).
  for (const key of ["beezie", "courtyard"] as const) {
    const hist = await readHistory(key);
    if (!hist || !hist.buckets.length) continue;
    const windowStart = Date.parse(hist.buckets[0].hourStart);
    const windowEnd = Date.parse(hist.generatedAt);
    const byDay = new Map<string, { vol: number; trades: number }>();
    for (const bk of hist.buckets) {
      const t = Date.parse(bk.hourStart);
      if (!Number.isFinite(t)) continue;
      const day = dayStartUtc(t);
      const acc = byDay.get(day) ?? { vol: 0, trades: 0 };
      acc.vol += bk.volumeUsd;
      acc.trades += bk.sales;
      byDay.set(day, acc);
    }
    for (const [day, acc] of byDay) {
      const ds = Date.parse(day);
      if (ds < windowStart || ds + DAY > windowEnd) continue; // complete days within the snapshot
      push("platform", key, "volume_usd", acc.vol, day);
      push("platform", key, "trades", acc.trades, day);
    }
  }

  // ── Family 1c: per-IP daily flow (7d) from the by-ip history snapshot ──
  // history:by-ip holds 168 hourly buckets per IP (Beezie + CC coverage); roll
  // up to complete UTC days so the IP Activity chart's volume/trades go real.
  const ipHist = await readIpHistory();
  if (ipHist) {
    const ipWindowEnd = Date.parse(ipHist.generatedAt);
    for (const [ip, buckets] of Object.entries(ipHist.byIp)) {
      if (!buckets.length) continue;
      const windowStart = Date.parse(buckets[0].hourStart);
      const byDay = new Map<string, { vol: number; trades: number }>();
      for (const bk of buckets) {
        const t = Date.parse(bk.hourStart);
        if (!Number.isFinite(t)) continue;
        const day = dayStartUtc(t);
        const acc = byDay.get(day) ?? { vol: 0, trades: 0 };
        acc.vol += bk.volumeUsd;
        acc.trades += bk.sales;
        byDay.set(day, acc);
      }
      for (const [day, acc] of byDay) {
        const ds = Date.parse(day);
        if (ds < windowStart || ds + DAY > ipWindowEnd) continue; // complete days only
        push("ip", ip, "volume_usd", acc.vol, day);
        push("ip", ip, "trades", acc.trades, day);
      }
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
    for (const [key, n] of Object.entries(holders.platforms)) {
      push("platform", key, "holders", n, today);
    }
    for (const [ip, e] of Object.entries(holders.byIp)) {
      push("ip", ip, "holders", e.total, today);
    }
  }

  // ── Family 3: market + per-IP mcap history backfill (past days, ~30d) ──
  // marketcap-history holds hourly mcap (byIp + total). Sample the latest reading
  // per UTC day; today is owned by Family 2 (the current snapshot) → skip it here.
  const mcapHist = await readMarketCapHistory();
  const dayMcap = new Map<string, { total: number; byIp: Record<string, number> }>();
  for (const h of mcapHist.hourly) {
    const t = Date.parse(h.at);
    if (!Number.isFinite(t)) continue;
    dayMcap.set(dayStartUtc(t), { total: h.totalMcapUsd, byIp: h.byIp }); // later entry = latest-of-day
  }
  for (const [day, m] of dayMcap) {
    if (day === today) continue; // today handled by Family 2
    push("market", "total", "mcap_usd", m.total, day);
    for (const [ip, v] of Object.entries(m.byIp)) push("ip", ip, "mcap_usd", v, day);
  }

  const written = await writeMetricSnapshots(rows);
  console.log(
    `Wrote ${written} metric_snapshots rows · CC ${ccDays} complete days ` +
      `($${Math.round(ccVolTotal).toLocaleString()} 30d) · ` +
      `mcap $${Math.round(mcap?.totals.mcapUsd ?? 0).toLocaleString()} · ` +
      `${mcap ? Object.keys(mcap.byIp).length : 0} IPs`,
  );
  return { rowsWritten: written };
}

runWarmer("metric-snapshots", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
