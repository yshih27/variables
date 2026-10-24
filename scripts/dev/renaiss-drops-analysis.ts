/**
 * Renaiss's limited drops, analysed from our own tables: per drop (speed,
 * buyers, packs per buyer, prizes and Renaiss's stated value, what became of
 * the prizes) and across drops (loyalty, first-time players, share of pack
 * spend). Reads only; prints counts and sums, never a wallet; writes local JSON.
 *
 *   npx tsx --env-file=.env.local scripts/dev/renaiss-drops-analysis.ts --drops=<renaiss-drops.json> --out=<dir>
 *   … --openings   only print how each drop opened (minutes from its first paid pull to its 2nd–5th, 10th, 50th and last)
 *
 * ⚠️ PRIVATE PARTNER DATA. The output stays local: the repo and its Actions logs
 * are public, and several figures here are Renaiss's to see first.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../../src/lib/db/client";
import { readWalletSpend } from "../../src/lib/renaiss/players";
import { readMetricSeries } from "../../src/lib/data/metricSnapshots";
import { dropLabel } from "../../src/lib/renaiss/dropNames";
import { openingOf, readDropPulls as readPaidPulls, type DropRow } from "../../src/lib/renaiss/drops";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
const DAY = 86_400_000;
const PAGE = 1000;

type Pull = {
  pull_id: string;
  kind: string;
  buyer: string | null;
  price_usd: number | string | null;
  pulled_at: string;
  prize_instance_id: string | null;
  prize_canonical_id: string | null;
  prize_value_usd: number | string | null;
  prize_card_name: string | null;
  prize_set_name: string | null;
  prize_grade_label: string | null;
  prize_language: string | null;
};
type Sale = { token_id: string; sold_at: string; price_usd: number | string | null; buyer: string | null; seller: string | null };

const num = (v: number | string | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (n: number | null, d = 1) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);
const tally = (xs: (string | null)[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x ?? "(none)", (m.get(x ?? "(none)") ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

async function pageAll<T>(q: (from: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let { data, error } = await q(from);
    for (let attempt = 1; error && attempt <= 3; attempt++) {
      await new Promise((r) => setTimeout(r, attempt * 2_000));
      ({ data, error } = await q(from));
    }
    if (error) throw new Error(`${what}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const PULL_COLS = "pull_id, kind, buyer, price_usd, pulled_at, prize_instance_id, prize_canonical_id, prize_value_usd, prize_card_name, prize_set_name, prize_grade_label, prize_language";

function readDropPulls(d: DropRow): Promise<Pull[]> {
  return pageAll<Pull>(
    (from) =>
      db()
        .from("renaiss_pulls")
        .select(PULL_COLS)
        .eq("product_id", d.productId)
        .gte("pulled_at", d.firstAt)
        .lte("pulled_at", d.lastAt)
        .order("pull_id", { ascending: true })
        .range(from, from + PAGE - 1),
    `drop pulls ${d.firstAt.slice(0, 10)}`,
  );
}

function readSales(sinceIso: string): Promise<Sale[]> {
  return pageAll<Sale>(
    (from) =>
      db()
        .from("renaiss_sales")
        .select("token_id, sold_at, price_usd, buyer, seller")
        .gte("sold_at", sinceIso)
        .order("sale_id", { ascending: true })
        .range(from, from + PAGE - 1),
    "sales",
  );
}

async function main() {
  const out = arg("out") ?? "renaiss-drops-analysis";
  mkdirSync(out, { recursive: true });
  const snap = JSON.parse(readFileSync(arg("drops")!, "utf8")) as { historyFrom: string; drops: DropRow[] };
  const drops = [...snap.drops].sort((a, b) => a.firstAt.localeCompare(b.firstAt)); // oldest first
  const t0 = Date.now();

  const pullsByDrop = new Map<string, Pull[]>();
  for (const d of drops) pullsByDrop.set(d.productId, await readDropPulls(d));
  if (process.argv.includes("--openings")) {
    // How each drop opened: minutes from its first paid pull to its 2nd–5th, 10th and 50th, and to the last.
    for (const d of drops) {
      const t = (pullsByDrop.get(d.productId) ?? []).filter((p) => p.kind === "checkout" && (num(p.price_usd) ?? 0) > 0).map((p) => Date.parse(p.pulled_at)).sort((x, y) => x - y);
      const m = (i: number) => (t[i] != null ? Math.round((t[i] - t[0]) / 60_000) : null);
      console.log(`${d.firstAt.slice(0, 16)} first→2nd ${m(1)}m 3rd ${m(2)}m 4th ${m(3)}m 5th ${m(4)}m 10th ${m(9)}m 50th ${m(49)}m last ${m(t.length - 1)}m · 10th→last ${t[9] != null ? Math.round((t[t.length - 1] - t[9]) / 60_000) : "—"}m · 10th at ${t[9] != null ? new Date(t[9]).toISOString().slice(11, 16) : "—"}`);
    }
    return;
  }
  const [wallets, spine, sales] = await Promise.all([
    readWalletSpend(),
    readMetricSeries("platform", "renaiss", "gacha_volume_usd"),
    readSales(snap.historyFrom),
  ]);
  console.log(`read ${[...pullsByDrop.values()].reduce((s, l) => s + l.length, 0)} drop pulls, ${wallets.rows.length} wallets, ${spine.length} spine days, ${sales.length} sales · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const fullFrom = Math.floor(Date.parse(drops[0].firstAt) / DAY) * DAY - 30 * DAY;
  const everyPull = (await readPaidPulls(fullFrom, Date.now()))
    .filter((p) => p.buyer && (num(p.price_usd) ?? 0) > 0)
    .map((p) => ({ w: p.buyer!.toLowerCase(), t: Date.parse(p.pulled_at), usd: num(p.price_usd)!, product: p.product_id }))
    .sort((a, b) => a.t - b.t);
  console.log(`read ${everyPull.length.toLocaleString()} paid pulls from ${new Date(fullFrom).toISOString().slice(0, 10)} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const dropIds = new Set(drops.map((d) => d.productId));
  /** Paid pulls in [a, b), by every machine or the regular ones only. */
  const between = (a: number, b: number) => {
    let lo = 0, hi = everyPull.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (everyPull[m].t < a) lo = m + 1; else hi = m; }
    const out = [];
    for (let i = lo; i < everyPull.length && everyPull[i].t < b; i++) out.push(everyPull[i]);
    return out;
  };
  const cutoff = wallets.rows.reduce((m, w) => Math.max(m, Date.parse(w.last_pull)), 0); // newest pull of all
  const walletBy = new Map(wallets.rows.map((w) => [w.buyer.toLowerCase(), { key: w.buyer.toLowerCase(), spend: Number(w.spend), pulls: Number(w.pulls), first: Date.parse(w.first_pull), last: Date.parse(w.last_pull) }]));

  // ── Per drop ──────────────────────────────────────────────────────────────
  const salesByToken = new Map<string, Sale[]>();
  for (const s of sales) salesByToken.set(s.token_id, [...(salesByToken.get(s.token_id) ?? []), s]);

  const perDrop = drops.map((d) => {
    const all = pullsByDrop.get(d.productId) ?? [];
    const paid = all.filter((p) => p.kind === "checkout" && (num(p.price_usd) ?? 0) > 0);
    const times = paid.map((p) => Date.parse(p.pulled_at)).sort((a, b) => a - b);
    const first = openingOf(times) ?? Date.parse(d.firstAt);
    const minsTo = (f: number) => (times.length ? round(Math.max(0, times[Math.max(0, Math.ceil(f * times.length) - 1)] - first) / 60_000, 0) : null);
    const inFirst = (mins: number) => times.filter((t) => t >= first && t - first <= mins * 60_000).length;
    const byBuyer = new Map<string, number>();
    for (const p of paid) {
      const b = p.buyer?.toLowerCase();
      if (b) byBuyer.set(b, (byBuyer.get(b) ?? 0) + 1);
    }
    const perBuyer = [...byBuyer.values()];
    const stated = paid.filter((p) => num(p.prize_value_usd) != null);
    const statedSum = stated.reduce((s, p) => s + num(p.prize_value_usd)!, 0);
    const statedPaid = stated.reduce((s, p) => s + num(p.price_usd)!, 0);
    const values = stated.map((p) => num(p.prize_value_usd)!);
    const top = [...all].filter((p) => num(p.prize_value_usd) != null).sort((a, b) => num(b.prize_value_usd)! - num(a.prize_value_usd)!).slice(0, 3);
    // Resales of this drop's prizes on Renaiss's marketplace after the pull.
    let resold = 0;
    let resold30 = 0;
    const resaleVsStated: number[] = [];
    for (const p of paid) {
      const tok = p.prize_instance_id?.startsWith("rn-") ? p.prize_instance_id.slice(3) : null;
      if (!tok) continue;
      const after = (salesByToken.get(tok) ?? []).filter((s) => Date.parse(s.sold_at) > Date.parse(p.pulled_at)).sort((a, b) => a.sold_at.localeCompare(b.sold_at));
      if (!after.length) continue;
      resold++;
      if (Date.parse(after[0].sold_at) - Date.parse(p.pulled_at) <= 30 * DAY) resold30++;
      const v = num(p.prize_value_usd);
      const price = num(after[0].price_usd);
      if (v && price) resaleVsStated.push(price / v);
    }
    const label = dropLabel(d);
    const buyers = new Set(byBuyer.keys());
    const last = Date.parse(d.lastAt);
    const before30 = new Set(between(first - 30 * DAY, first).map((p) => p.w));
    const week = between(first, first + 7 * DAY);
    const weekWallets = new Set(week.map((p) => p.w));
    const reactivated = [...buyers].filter((w) => (walletBy.get(w)?.first ?? Infinity) < first && !before30.has(w)).length;
    const regularBy = (pulls: { w: string; usd: number; product: string }[]) => pulls.filter((p) => buyers.has(p.w) && !dropIds.has(p.product)).reduce((s, p) => s + p.usd, 0);
    const behaviour = {
      weekActiveWallets: weekWallets.size,
      shareOfWeekPct: round((100 * buyers.size) / Math.max(1, weekWallets.size), 1),
      reactivated,
      activeBefore30: [...buyers].filter((w) => before30.has(w)).length,
      regularSpendBuyers7dBefore: Math.round(regularBy(between(first - 7 * DAY, first))),
      regularSpendBuyers7dAfter: Math.round(regularBy(between(last, last + 7 * DAY))),
      regularSpendBuyersSameDay: Math.round(regularBy(between(Math.floor(first / DAY) * DAY, Math.floor(first / DAY) * DAY + DAY))),
    };
    return {
      behaviour,
      date: new Date(first).toISOString().slice(0, 10),
      openUtc: new Date(first).toISOString().slice(11, 19),
      weekday: new Date(first).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      startUtc: d.firstAt.slice(11, 16),
      name: label?.name ?? "Drop",
      nameSource: label?.source ?? null,
      packs: paid.length,
      revenueUsd: paid.reduce((s, p) => s + num(p.price_usd)!, 0),
      prices: tally(paid.map((p) => String(num(p.price_usd)))),
      buyers: byBuyer.size,
      packsPerBuyerMean: round(paid.length / Math.max(1, byBuyer.size), 2),
      packsPerBuyerMedian: median(perBuyer),
      buyersOnePack: perBuyer.filter((n) => n === 1).length,
      minsTo: { p25: minsTo(0.25), p50: minsTo(0.5), p75: minsTo(0.75), p90: minsTo(0.9), p100: minsTo(1) },
      packsInFirst: { m1: inFirst(1), m5: inFirst(5), m10: inFirst(10), m30: inFirst(30), m60: inFirst(60) },
      newPlayers: d.newPlayers,
      returningBuyers: d.returningBuyers,
      named: all.filter((p) => p.prize_instance_id).length,
      stated: {
        n: stated.length,
        valueBackPct: statedPaid ? round((100 * statedSum) / statedPaid, 1) : null,
        median: round(median(values), 2),
        hitSharePct: stated.length ? round((100 * stated.filter((p) => num(p.prize_value_usd)! >= num(p.price_usd)!).length) / stated.length, 1) : null,
        over500: values.filter((v) => v >= 500).length,
        over1000: values.filter((v) => v >= 1000).length,
        under50: values.filter((v) => v < 50).length,
        top: top.map((p) => ({ card: p.prize_card_name, set: p.prize_set_name, grade: p.prize_grade_label, valueUsd: num(p.prize_value_usd) })),
      },
      mix: {
        language: tally(paid.map((p) => p.prize_language)).slice(0, 4),
        grade: tally(paid.map((p) => p.prize_grade_label)).slice(0, 4),
        set: tally(paid.map((p) => p.prize_set_name)).slice(0, 5),
        distinctCards: new Set(paid.map((p) => p.prize_canonical_id).filter(Boolean)).size,
      },
      resale: { resold, resold30, medianResaleVsStated: round(median(resaleVsStated), 2) },
      buyerWallets: [...byBuyer.keys()],
    };
  });

  // ── Across drops ──────────────────────────────────────────────────────────
  const dropsBought = new Map<string, number>();
  for (const d of perDrop) for (const w of d.buyerWallets) dropsBought.set(w, (dropsBought.get(w) ?? 0) + 1);
  const bucket = (lo: number, hi: number) => [...dropsBought.values()].filter((n) => n >= lo && n <= hi).length;
  const named5 = perDrop.filter((d) => d.nameSource === "varible").map((d) => new Set(d.buyerWallets));
  const inAll = (sets: Set<string>[]) => (sets.length ? [...sets[0]].filter((w) => sets.every((s) => s.has(w))).length : 0);
  const allSets = perDrop.map((d) => new Set(d.buyerWallets));
  const sepOct = perDrop.filter((d) => d.date >= "2026-09-01").map((d) => new Set(d.buyerWallets));

  const nextRepeat = perDrop.slice(0, -1).map((d, i) => {
    const next = new Set(perDrop[i + 1].buyerWallets);
    return { from: d.date, to: perDrop[i + 1].date, pct: round((100 * d.buyerWallets.filter((w) => next.has(w)).length) / d.buyerWallets.length, 1) };
  });
  // Drop buyers whose first Renaiss pull of all was in that drop (the table's first-time players).
  const viaDrop = new Set<string>();
  for (const [i, d] of drops.entries()) {
    const [a, b] = [Date.parse(d.firstAt), Date.parse(d.lastAt)];
    for (const w of perDrop[i].buyerWallets) {
      const f = walletBy.get(w)?.first;
      if (f != null && f >= a && f <= b) viaDrop.add(w);
    }
  }
  // First-timers whose first Renaiss pull came in a drop, against every first-timer since the history began.
  const dropWindows = drops.map((d) => [Date.parse(d.firstAt), Date.parse(d.lastAt)] as const);
  const histFrom = Date.parse(snap.historyFrom);
  const lastDropEnd = Math.max(...dropWindows.map(([, b]) => b));
  const cohort = (pred: (w: { first: number; key: string }) => boolean) => {
    const ws = [...walletBy.values()].filter((w) => w.first >= histFrom && w.first <= lastDropEnd && pred(w));
    return {
      wallets: ws.length,
      backAfterFirstDay: ws.filter((w) => w.last - w.first > DAY).length,
      backAfter7Days: ws.filter((w) => w.last - w.first > 7 * DAY).length,
      activeLast30d: ws.filter((w) => w.last >= cutoff - 30 * DAY).length,
      medianSpend: median(ws.map((w) => w.spend)),
      p25Spend: ws.length ? [...ws.map((w) => w.spend)].sort((x, y) => x - y)[Math.floor(ws.length * 0.25)] : null,
      p75Spend: ws.length ? [...ws.map((w) => w.spend)].sort((x, y) => x - y)[Math.floor(ws.length * 0.75)] : null,
      totalSpend: ws.reduce((s, w) => s + w.spend, 0),
    };
  };
  const inADrop = (w: { first: number; key?: string }) => viaDrop.has(w.key ?? "");
  const dropFirstTimers = cohort(inADrop);
  const otherFirstTimers = cohort((w) => !inADrop(w));

  // Drop buyers in the whole player base (lifetime pack spend).
  const allSpend = wallets.rows.reduce((s, w) => s + Number(w.spend), 0);
  const dropBuyerSpend = [...dropsBought.keys()].reduce((s, w) => s + (walletBy.get(w)?.spend ?? 0), 0);
  const dropSpendByWallet = new Map<string, number>();
  for (const d of perDrop) for (const w of d.buyerWallets) dropSpendByWallet.set(w, 0);
  for (const d of drops) for (const p of pullsByDrop.get(d.productId) ?? []) {
    const b = p.buyer?.toLowerCase();
    if (b && p.kind === "checkout") dropSpendByWallet.set(b, (dropSpendByWallet.get(b) ?? 0) + (num(p.price_usd) ?? 0));
  }
  const dropBuyersQuiet = [...dropsBought.keys()].filter((w) => (walletBy.get(w)?.last ?? 0) < cutoff - 30 * DAY).length;

  // Pack spend over the history: drops against the whole venue, and regular machines on drop days.
  const spineIn = spine.filter((p) => Date.parse(p.ts) >= histFrom && Date.parse(p.ts) < Math.floor(cutoff / DAY) * DAY);
  const venueSpend = spineIn.reduce((s, p) => s + p.value, 0);
  const dropRevenue = perDrop.reduce((s, d) => s + d.revenueUsd, 0);
  const dropRevenueByDay = new Map<string, number>();
  for (const d of drops) for (const p of pullsByDrop.get(d.productId) ?? []) {
    if (p.kind !== "checkout") continue;
    const day = new Date(Math.floor(Date.parse(p.pulled_at) / DAY) * DAY).toISOString().slice(0, 10);
    dropRevenueByDay.set(day, (dropRevenueByDay.get(day) ?? 0) + (num(p.price_usd) ?? 0));
  }
  const regular = spineIn.map((p) => ({ day: p.ts.slice(0, 10), regular: p.value - (dropRevenueByDay.get(p.ts.slice(0, 10)) ?? 0), dropDay: dropRevenueByDay.has(p.ts.slice(0, 10)) }));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  // Each drop day against the 3 days before and after it (none of them drop days).
  const around = regular.filter((r) => r.dropDay).map((r) => {
    const i = regular.findIndex((x) => x.day === r.day);
    const near = [...regular.slice(Math.max(0, i - 3), i), ...regular.slice(i + 1, i + 4)].filter((x) => !x.dropDay).map((x) => x.regular);
    return { day: r.day, regular: Math.round(r.regular), nearAvg: Math.round(avg(near) ?? 0) };
  });

  const across = {
    window: { from: snap.historyFrom.slice(0, 10), throughNewestPull: new Date(cutoff).toISOString() },
    drops: perDrop.length,
    packs: perDrop.reduce((s, d) => s + d.packs, 0),
    dropRevenueUsd: dropRevenue,
    venuePackSpendUsd: Math.round(venueSpend),
    dropSharePct: round((100 * dropRevenue) / venueSpend, 1),
    distinctBuyers: dropsBought.size,
    dropsBoughtBuckets: { "1": bucket(1, 1), "2-4": bucket(2, 4), "5-9": bucket(5, 9), "10-14": bucket(10, 14), "15-18": bucket(15, 18) },
    boughtAll18: inAll(allSets),
    boughtAllNamed5: inAll(named5),
    boughtAllSepOct: { drops: sepOct.length, wallets: inAll(sepOct) },
    dropFirstTimers,
    otherFirstTimers,
    playerBase: {
      payingWallets: wallets.rows.length,
      dropBuyers: dropsBought.size,
      dropBuyersShareOfWalletsPct: round((100 * dropsBought.size) / wallets.rows.length, 1),
      dropBuyersShareOfLifetimeSpendPct: round((100 * dropBuyerSpend) / allSpend, 1),
      dropBuyersLifetimeSpendUsd: Math.round(dropBuyerSpend),
      dropSpendShareOfTheirSpendPct: round((100 * [...dropSpendByWallet.values()].reduce((s, x) => s + x, 0)) / dropBuyerSpend, 1),
      dropBuyersQuiet30d: dropBuyersQuiet,
    },
    nextDropRepeat: nextRepeat,
    allWalletsActive30d: wallets.rows.filter((w) => Date.parse(w.last_pull) >= cutoff - 30 * DAY).length,
    newestProducts: [...new Set(between(cutoff - 3 * DAY, cutoff + 1).map((p) => p.product))].map((id) => {
      const ps = everyPull.filter((p) => p.product === id);
      return { id: id.slice(0, 12), firstAt: new Date(ps[0].t).toISOString(), paidPulls: ps.length, prices: tally(ps.map((p) => String(p.usd))).slice(0, 2), buyers: new Set(ps.map((p) => p.w)).size };
    }).filter((x) => Date.parse(x.firstAt) >= cutoff - 3 * DAY),
    regularOnDropDays: { dropDaysAvg: Math.round(avg(around.map((a) => a.regular)) ?? 0), nearDaysAvg: Math.round(avg(around.map((a) => a.nearAvg)) ?? 0), days: around },
  };

  const report = { generatedAt: new Date().toISOString(), across, perDrop: perDrop.map((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== "buyerWallets"))) };
  writeFileSync(join(out, "analysis.json"), JSON.stringify(report, null, 1));

  // Console: counts and sums only.
  console.log("\n| Drop | Day | Start | Packs | Buyers | Packs/buyer | 1-pack buyers | 50% in | 90% in | Last | Value back | Median prize | Hit share | Top prize |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const d of perDrop) {
    const t = d.stated.top[0];
    console.log(`| ${d.date} ${d.name} | ${d.weekday} | ${d.startUtc} | ${d.packs} | ${d.buyers} | ${d.packsPerBuyerMean} | ${d.buyersOnePack} | ${d.minsTo.p50}m | ${d.minsTo.p90}m | ${d.minsTo.p100}m | ${d.stated.valueBackPct ?? "—"}% (n ${d.stated.n}) | $${d.stated.median ?? "—"} | ${d.stated.hitSharePct ?? "—"}% | ${t ? `${t.card} ${t.grade} $${t.valueUsd}` : "—"} |`);
  }
  console.log("\n| Drop | Week's paying wallets | Drop buyers share | Active in prior 30d | Back after 30d+ away | New | Buyers' regular spend 7d before | 7d after | same day | Packs 1m/5m/10m |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const d of perDrop) {
    const b = d.behaviour;
    console.log(`| ${d.date} ${d.name} | ${b.weekActiveWallets} | ${b.shareOfWeekPct}% | ${b.activeBefore30} | ${b.reactivated} | ${d.newPlayers} | $${b.regularSpendBuyers7dBefore.toLocaleString()} | $${b.regularSpendBuyers7dAfter.toLocaleString()} | $${b.regularSpendBuyersSameDay.toLocaleString()} | ${d.packsInFirst.m1}/${d.packsInFirst.m5}/${d.packsInFirst.m10} |`);
  }
  console.log(`\n${JSON.stringify(across, (k, v) => (k === "days" ? undefined : v), 1)}`);
  console.log(`\nwrote ${join(out, "analysis.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
