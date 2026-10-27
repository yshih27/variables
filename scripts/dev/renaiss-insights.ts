/**
 * Renaiss insights for a private brief, from our own stores:
 *   1. lapsed high spenders — wallets by lifetime spend, active vs quiet 30–60
 *      vs quiet 60+ days before the newest pull in the store;
 *   2. the new-player funnel — first-time players per month, and how many come
 *      back on a later day, within 7 and 30 days, and how fast;
 *   3. the audience Renaiss shares with other EVM venues — Renaiss players whose
 *      address also traded on Courtyard (Polygon), Beezie (Base) or DYLI
 *      (Abstract). Same-address matches only: an embedded or smart wallet that
 *      differs per app cannot be matched, so every overlap is a floor (Oct 21
 *      2026: zero of 4,853) — and, inside Renaiss, the marketplace buyers who
 *      have never pulled a pack (sales of MIN_SALE_USD or more; sub-dollar dust
 *      trades are left out, as everywhere else).
 *
 * Reads renaiss_wallet_spend() (per wallet), renaiss_pulls (a keyset scan of
 * paid pulls for the visit days), renaiss_sales, secondary_sales and
 * dyli_sales. Writes one local JSON of counts, sums and shares.
 *
 * ⚠️ PRIVACY: wallet addresses are join keys inside this process only. Nothing
 * written or printed carries one. The repo is public: never commit the output.
 *
 *   npx tsx scripts/dev/renaiss-insights.ts --out=<file.json>
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync } from "node:fs";
import { db } from "../../src/lib/db/client";
import { readWalletSpend } from "../../src/lib/renaiss/players";
import { MIN_SALE_USD } from "../../src/lib/data/secondaryHygiene";

const DAY = 86_400_000;
const PAGE = 1000;
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
const addr = (v: unknown) => (typeof v === "string" && v.startsWith("0x") ? v.toLowerCase() : null);
const dayMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** Every paid pull's (buyer, UTC day), keyset-paged on the primary key. */
async function visitDays(): Promise<Map<string, Set<string>>> {
  const days = new Map<string, Set<string>>();
  let last: string | null = null;
  let pages = 0;
  for (;;) {
    let q = db().from("renaiss_pulls").select("pull_id,buyer,pulled_at").gt("price_usd", 0).order("pull_id", { ascending: true }).limit(PAGE);
    if (last !== null) q = q.gt("pull_id", last);
    const { data, error } = await q;
    if (error) throw new Error(`renaiss_pulls: ${error.message}`);
    const rows = (data ?? []) as { pull_id: string; buyer: string | null; pulled_at: string }[];
    for (const r of rows) {
      const a = addr(r.buyer);
      if (!a) continue;
      let s = days.get(a);
      if (!s) days.set(a, (s = new Set()));
      s.add(r.pulled_at.slice(0, 10));
    }
    pages++;
    if (pages % 100 === 0) console.log(`  renaiss_pulls: ${pages} pages, ${days.size} wallets`);
    if (rows.length < PAGE) break;
    last = rows[rows.length - 1].pull_id;
  }
  return days;
}

/** Distinct buyer ∪ seller addresses of one store (optionally one platform), with its date span. */
async function traders(table: "secondary_sales" | "dyli_sales" | "renaiss_sales", platform?: string) {
  const set = new Set<string>();
  let first: string | null = null;
  let lastSold: string | null = null;
  let last: string | number | null = null;
  const key = "sale_id";
  for (;;) {
    let q = db().from(table).select(`${key},buyer,seller,sold_at`).order(key, { ascending: true }).limit(PAGE);
    if (platform) q = q.eq("platform", platform);
    if (last !== null) q = q.gt(key, last);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as { sale_id: string | number; buyer: string | null; seller: string | null; sold_at: string }[];
    for (const r of rows) {
      for (const v of [r.buyer, r.seller]) {
        const a = addr(v);
        if (a) set.add(a);
      }
      if (!first || r.sold_at < first) first = r.sold_at;
      if (!lastSold || r.sold_at > lastSold) lastSold = r.sold_at;
    }
    if (rows.length < PAGE) break;
    last = rows[rows.length - 1].sale_id;
  }
  return { set, from: first?.slice(0, 10) ?? null, to: lastSold?.slice(0, 10) ?? null };
}

/** Renaiss marketplace buyers (sales of MIN_SALE_USD or more): spend, count, last purchase. */
async function marketBuyers() {
  const buyers = new Map<string, { usd: number; n: number; last: string }>();
  let last: string | null = null;
  for (;;) {
    let q = db().from("renaiss_sales").select("sale_id,buyer,price_usd,sold_at").gte("price_usd", MIN_SALE_USD).order("sale_id", { ascending: true }).limit(PAGE);
    if (last !== null) q = q.gt("sale_id", last);
    const { data, error } = await q;
    if (error) throw new Error(`renaiss_sales: ${error.message}`);
    const rows = (data ?? []) as { sale_id: string; buyer: string | null; price_usd: number; sold_at: string }[];
    for (const r of rows) {
      const a = addr(r.buyer);
      if (!a) continue;
      const e = buyers.get(a) ?? { usd: 0, n: 0, last: r.sold_at };
      e.usd += Number(r.price_usd);
      e.n++;
      if (r.sold_at > e.last) e.last = r.sold_at;
      buyers.set(a, e);
    }
    if (rows.length < PAGE) break;
    last = rows[rows.length - 1].sale_id;
  }
  return buyers;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (n: number, d: number) => (d > 0 ? Math.round((1000 * n) / d) / 10 : null);

async function main() {
  const out = arg("out");
  if (!out) throw new Error("pass --out=<file.json>");
  const t0 = Date.now();

  // ── 1. Lapsed high spenders, from the per-wallet aggregate ──
  const { rows: spendRows } = await readWalletSpend();
  const wallets = spendRows
    .map((r) => ({ a: addr(r.buyer), spend: Number(r.spend), pulls: Number(r.pulls), first: r.first_pull, last: r.last_pull }))
    .filter((w): w is { a: string; spend: number; pulls: number; first: string; last: string } => Boolean(w.a) && Number.isFinite(w.spend));
  const cutoffIso = wallets.reduce((m, w) => (w.last > m ? w.last : m), "");
  const cutoff = Date.parse(cutoffIso);
  const tierOf = (s: number) => (s >= 10_000 ? "$10K+" : s >= 1_000 ? "$1K–10K" : s >= 100 ? "$100–1K" : "under $100");
  const statusOf = (lastIso: string) => {
    const d = (cutoff - Date.parse(lastIso)) / DAY;
    return d <= 30 ? "active (pulled in the last 30 days)" : d <= 60 ? "quiet 30–60 days" : "quiet 60+ days";
  };
  const lapsed: Record<string, Record<string, { wallets: number; lifetimeSpendUsd: number }>> = {};
  for (const w of wallets) {
    const t = tierOf(w.spend);
    const s = statusOf(w.last);
    lapsed[t] ??= {};
    lapsed[t][s] ??= { wallets: 0, lifetimeSpendUsd: 0 };
    lapsed[t][s].wallets++;
    lapsed[t][s].lifetimeSpendUsd += w.spend;
  }
  const totalSpend = wallets.reduce((s, w) => s + w.spend, 0);
  console.log(`1. ${wallets.length} paying wallets, $${Math.round(totalSpend).toLocaleString()} lifetime, newest pull ${cutoffIso}`);

  // ── 2. The new-player funnel, from visit days ──
  const days = await visitDays();
  const cutoffDay = dayMs(cutoffIso);
  type Cohort = { firstTime: number; cameBackLaterDay: number; eligible7: number; back7: number; eligible30: number; back30: number; daysToSecond: number[] };
  const cohorts: Record<string, Cohort> = {};
  for (const set of days.values()) {
    const sorted = [...set].sort();
    const firstDay = dayMs(sorted[0]);
    const month = sorted[0].slice(0, 7);
    const c = (cohorts[month] ??= { firstTime: 0, cameBackLaterDay: 0, eligible7: 0, back7: 0, eligible30: 0, back30: 0, daysToSecond: [] });
    c.firstTime++;
    const gap = sorted.length > 1 ? (dayMs(sorted[1]) - firstDay) / DAY : null;
    if (gap != null) {
      c.cameBackLaterDay++;
      c.daysToSecond.push(gap);
    }
    if (cutoffDay - firstDay >= 7 * DAY) {
      c.eligible7++;
      if (gap != null && gap <= 7) c.back7++;
    }
    if (cutoffDay - firstDay >= 30 * DAY) {
      c.eligible30++;
      if (gap != null && gap <= 30) c.back30++;
    }
  }
  const funnel = Object.entries(cohorts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, c]) => ({
      month,
      firstTimePlayers: c.firstTime,
      cameBackOnALaterDayPct: pct(c.cameBackLaterDay, c.firstTime),
      backWithin7DaysPct: c.eligible7 ? pct(c.back7, c.eligible7) : null,
      backWithin30DaysPct: c.eligible30 ? pct(c.back30, c.eligible30) : null,
      medianDaysToSecondVisit: median(c.daysToSecond),
    }));
  console.log(`2. ${days.size} wallets with paid pulls across ${funnel.length} cohort months`);

  // ── 3. Shared audience, same-address matches ──
  const players = new Set(wallets.map((w) => w.a));
  const spendBy = new Map(wallets.map((w) => [w.a, w.spend]));
  const [courtyard, beezie, dyli, renaissMarket] = await Promise.all([
    traders("secondary_sales", "courtyard"),
    traders("secondary_sales", "beezie"),
    traders("dyli_sales"),
    traders("renaiss_sales"),
  ]);
  const overlap = (other: Set<string>) => {
    let n = 0;
    let spend = 0;
    for (const a of players) if (other.has(a)) { n++; spend += spendBy.get(a) ?? 0; }
    return { wallets: n, pctOfRenaissPlayers: pct(n, players.size), theirRenaissSpendUsd: Math.round(spend), pctOfRenaissSpend: pct(spend, totalSpend) };
  };
  const anyOther = new Set([...courtyard.set, ...beezie.set, ...dyli.set]);
  const shared = {
    renaissPlayers: players.size,
    venues: {
      courtyard: { traders: courtyard.set.size, span: [courtyard.from, courtyard.to], ...overlap(courtyard.set) },
      beezie: { traders: beezie.set.size, span: [beezie.from, beezie.to], ...overlap(beezie.set) },
      dyli: { traders: dyli.set.size, span: [dyli.from, dyli.to], ...overlap(dyli.set) },
      anyOfThem: overlap(anyOther),
    },
    renaissMarketplaceTraders: { traders: renaissMarket.set.size, span: [renaissMarket.from, renaissMarket.to], ...overlap(renaissMarket.set) },
  };
  const buyers = await marketBuyers();
  let alsoPull = 0, alsoPullUsd = 0, onlyN = 0, onlyUsd = 0, onlyRepeat = 0, onlyLast30 = 0;
  for (const [a, e] of buyers) {
    if (players.has(a)) { alsoPull++; alsoPullUsd += e.usd; continue; }
    onlyN++;
    onlyUsd += e.usd;
    if (e.n >= 2) onlyRepeat++;
    if (cutoff - Date.parse(e.last) <= 30 * DAY) onlyLast30++;
  }
  const marketUsd = alsoPullUsd + onlyUsd;
  const marketplace = {
    minSaleUsd: MIN_SALE_USD,
    buyers: buyers.size,
    buyersWhoAlsoPull: alsoPull,
    theirShareOfMarketplaceUsdPct: pct(alsoPullUsd, marketUsd),
    buyersWhoNeverPulled: onlyN,
    neverPulledMarketplaceUsd: Math.round(onlyUsd),
    neverPulledRepeatBuyers: onlyRepeat,
    neverPulledBoughtInLast30d: onlyLast30,
  };
  console.log(`3. ${players.size} players vs Courtyard ${courtyard.set.size}, Beezie ${beezie.set.size}, DYLI ${dyli.set.size} traders; ${onlyN} marketplace buyers never pulled`);

  const result = {
    generatedAt: new Date().toISOString(),
    newestPull: cutoffIso,
    note: "Counts and sums only. Same-address matches only for section 3 (a floor).",
    lapsed: { payingWallets: wallets.length, lifetimeSpendUsd: Math.round(totalSpend), byTier: lapsed },
    funnel,
    shared,
    marketplace,
    ms: Date.now() - t0,
  };
  writeFileSync(out, JSON.stringify(result, null, 1));
  console.log(`wrote ${out} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
