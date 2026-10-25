/**
 * Do Renaiss's limited drops move its regular gacha? Reads every paid pull
 * around the drops in `renaiss-drops` and splits regular-machine spend (every
 * product that is not a drop) between each drop's buyers and everyone else, day
 * by day around the drop's 09:00 UTC opening. Each "day" is the 24 hours from
 * 09:00 UTC, so every window holds the same hours of the day and the daily
 * rhythm cancels. Also the hour-of-day profile of regular spend.
 *
 *   npx tsx --env-file=.env.local scripts/dev/renaiss-drop-anticipation.ts --out=<dir> [--through=<ISO time>]
 *
 * --through reads pulls only before that instant, so a rerun reproduces an earlier run.
 * The JSON keeps full precision; the console rounds to three places.
 *
 * Reads only; prints counts and sums, never a wallet; writes local JSON.
 * ⚠️ PRIVATE PARTNER DATA: the output stays local (the repo and its Actions logs
 * are public).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectDrops, readDropPulls, readRenaissDrops, walletsOf } from "../../src/lib/renaiss/drops";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Days around each opening: day 0 = [open, open + 24h). */
const DAYS = Array.from({ length: 13 }, (_, i) => i - 6);

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r3 = (x: number | null) => (x == null ? null : Math.round(x * 1000) / 1000);

async function main() {
  const out = arg("out") ?? "renaiss-drop-anticipation";
  mkdirSync(out, { recursive: true });
  const snap = await readRenaissDrops();
  if (!snap?.drops?.length) throw new Error("no renaiss-drops snapshot");
  const drops = [...snap.drops].sort((a, b) => (a.openAt ?? a.firstAt).localeCompare(b.openAt ?? b.firstAt));
  const dropIds = new Set(drops.map((d) => d.productId));
  const opens = drops.map((d) => Date.parse(d.openAt ?? d.firstAt));
  const fromMs = Math.floor((opens[0] - 8 * DAY) / DAY) * DAY;
  const through = arg("through") ? Date.parse(arg("through")!) : Date.now();
  if (!Number.isFinite(through)) throw new Error(`--through: not a time: ${arg("through")}`);
  const t0 = Date.now();
  const raw = await readDropPulls(fromMs, through);
  // A drop the history doesn't hold (older than it, or newer) still sells like a drop: the same rule finds it, and it stays out of regular spend.
  const others = detectDrops(raw, fromMs, through).filter((d) => !dropIds.has(d.productId));
  for (const d of others) dropIds.add(d.productId);
  const pulls = raw
    .filter((p) => p.buyer && Number(p.price_usd) > 0)
    .map((p) => ({ w: p.buyer!.toLowerCase(), t: Date.parse(p.pulled_at), usd: Number(p.price_usd), drop: dropIds.has(p.product_id) }))
    .sort((a, b) => a.t - b.t);
  const lastPull = pulls[pulls.length - 1]?.t ?? through;
  console.log(`read ${pulls.length.toLocaleString()} paid pulls from ${new Date(fromMs).toISOString().slice(0, 10)} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`${others.length} other drop(s) found by the same rule, kept out of regular spend`);

  /** Regular (non-drop) spend in [a, b), split by whether the wallet is in `group`. */
  const lowerBound = (x: number) => {
    let lo = 0, hi = pulls.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (pulls[m].t < x) lo = m + 1; else hi = m; }
    return lo;
  };
  const split = (a: number, b: number, group: Set<string>) => {
    let inG = 0, outG = 0, inN = 0, outN = 0;
    const walletsIn = new Set<string>(), walletsOut = new Set<string>();
    for (let i = lowerBound(a); i < pulls.length && pulls[i].t < b; i++) {
      const p = pulls[i];
      if (p.drop) continue;
      if (group.has(p.w)) { inG += p.usd; inN++; walletsIn.add(p.w); } else { outG += p.usd; outN++; walletsOut.add(p.w); }
    }
    return { inG, outG, inN, outN, walletsIn: walletsIn.size, walletsOut: walletsOut.size };
  };

  // ── Per drop: the buyers' share of regular spend, day by day ──
  const perDrop = drops.map((d, i) => {
    const open = opens[i];
    const buyers = new Set(walletsOf(d));
    const days = DAYS.map((k) => {
      const a = open + k * DAY, b = a + DAY;
      if (b > lastPull) return { day: k, complete: false };
      const s = split(a, b, buyers);
      const total = s.inG + s.outG;
      return { day: k, complete: true, buyersUsd: Math.round(s.inG), othersUsd: Math.round(s.outG), share: total > 0 ? s.inG / total : null, buyersActive: s.walletsIn, othersActive: s.walletsOut };
    });
    return { date: new Date(open).toISOString().slice(0, 10), name: d.named ? d.name : null, buyers: buyers.size, days };
  });

  // ── Pooled: every drop's day-k windows summed ──
  const pooled = DAYS.map((k) => {
    let b = 0, o = 0, n = 0;
    const shares: number[] = [];
    for (const d of perDrop) {
      const x = d.days.find((y) => y.day === k);
      if (!x || !x.complete) continue;
      b += x.buyersUsd!; o += x.othersUsd!; n++;
      if (x.share != null) shares.push(x.share);
    }
    return { day: k, drops: n, buyersUsd: b, othersUsd: o, pooledShare: b + o > 0 ? b / (b + o) : null, medianShare: median(shares) };
  });

  // ── The test: the buyers' share the day before the drop vs three days before (same hours of day) ──
  const compare = (dayA: number, dayB: number) => {
    const ratios: number[] = [];
    for (const d of perDrop) {
      const a = d.days.find((y) => y.day === dayA), b = d.days.find((y) => y.day === dayB);
      if (a?.complete && b?.complete && a.share != null && b.share != null && b.share > 0) ratios.push(a.share / b.share);
    }
    return { pair: `day ${dayA} ÷ day ${dayB}`, drops: ratios.length, below1: ratios.filter((x) => x < 1).length, medianRatio: median(ratios) };
  };
  const tests = [compare(-1, -3), compare(-1, -2), compare(-2, -3), compare(0, -3), compare(1, -3), compare(2, -3)];

  // ── Placebo: wallets on a regular machine in the 40 minutes after 09:00 UTC three days
  // before each drop (no drop then). Selected the same way drop buyers are (active in a
  // window that opens at 09:00), so their curve shows what activity alone does.
  const PLACEBO_WINDOW = 40 * 60_000;
  const placebo = drops.map((d, i) => {
    const t1 = opens[i] - 3 * DAY;
    const group = new Set<string>();
    for (let j = lowerBound(t1); j < pulls.length && pulls[j].t < t1 + PLACEBO_WINDOW; j++) if (!pulls[j].drop) group.add(pulls[j].w);
    const days = [-3, -2, -1, 0, 1, 2].map((k) => {
      const a = t1 + k * DAY;
      const sp = split(a, a + DAY, group);
      return { day: k, share: sp.inG + sp.outG > 0 ? sp.inG / (sp.inG + sp.outG) : null, groupUsd: Math.round(sp.inG) };
    });
    return { date: new Date(opens[i]).toISOString().slice(0, 10), wallets: group.size, days };
  });
  const ratioOf = (rows: { days: { day: number; share: number | null }[] }[], dayA: number, dayB: number) => {
    const xs: number[] = [];
    for (const r of rows) {
      const a = r.days.find((y) => y.day === dayA)?.share, b = r.days.find((y) => y.day === dayB)?.share;
      if (a != null && b != null && b > 0) xs.push(a / b);
    }
    return { drops: xs.length, below1: xs.filter((x) => x < 1).length, median: median(xs) };
  };
  const placeboTests = { "day -1 ÷ day -3": ratioOf(placebo, -1, -3), "day -1 ÷ day -2": ratioOf(placebo, -1, -2), "day 1 ÷ day -3": ratioOf(placebo, 1, -3) };
  const realTests = { "day -1 ÷ day -3": ratioOf(perDrop as never, -1, -3), "day -1 ÷ day -2": ratioOf(perDrop as never, -1, -2), "day 1 ÷ day -3": ratioOf(perDrop as never, 1, -3) };

  // ── The opening hours: regular spend in the 2 hours from 09:00 UTC on drop day vs the
  // same 2 hours on earlier days, split into the drop's buyers and everyone else.
  const opening = drops.map((d, i) => {
    const buyers = new Set(walletsOf(d));
    const at = (k: number) => {
      const a = opens[i] + k * DAY;
      const sp = split(a, a + 2 * HOUR, buyers);
      return { buyers: sp.inG, others: sp.outG };
    };
    const day0 = at(0), base = [-1, -2, -3, -6].map(at);
    const baseB = median(base.map((x) => x.buyers)) ?? 0, baseO = median(base.map((x) => x.others)) ?? 0;
    return { date: new Date(opens[i]).toISOString().slice(0, 10), buyers0: Math.round(day0.buyers), others0: Math.round(day0.others), buyersBase: Math.round(baseB), othersBase: Math.round(baseO) };
  });

  // ── Total regular spend (every wallet), hour by hour around each opening, against the
  // same clock hours on days -5..-2 (median): does a live drop pull spend off the machines?
  const totalIn = (a: number, b: number) => {
    let usd = 0;
    const ws = new Set<string>();
    for (let j = lowerBound(a); j < pulls.length && pulls[j].t < b; j++) if (!pulls[j].drop) { usd += pulls[j].usd; ws.add(pulls[j].w); }
    return { usd, wallets: ws.size };
  };
  const HOURS = Array.from({ length: 24 }, (_, i) => i - 12);
  // ratio = every drop summed; medianRatio = the typical drop (median of each drop's own ratio).
  const hourly = HOURS.map((h) => {
    let day0 = 0, base = 0, up = 0, n = 0;
    const ratios: number[] = [];
    for (const o of opens) {
      const a = o + h * HOUR;
      if (a + HOUR > lastPull) continue;
      const d0 = totalIn(a, a + HOUR).usd;
      const b = median([-5, -4, -3, -2].map((k) => totalIn(a + k * DAY, a + k * DAY + HOUR).usd)) ?? 0;
      day0 += d0; base += b; n++;
      if (d0 > b) up++;
      if (b > 0) ratios.push(d0 / b);
    }
    return { hour: h, drops: n, dropDayUsd: Math.round(day0), baselineUsd: Math.round(base), ratio: base > 0 ? day0 / base : null, medianRatio: median(ratios), dropsAbove: up };
  });
  // Whole 24h windows (09:00-aligned): day -1, 0, +1 against the median of days -6..-3.
  const daily = [-1, 0, 1].map((k) => {
    const ratios: number[] = [];
    let sumK = 0, sumB = 0;
    for (const o of opens) {
      const a = o + k * DAY;
      if (a + DAY > lastPull) continue;
      const vk = totalIn(a, a + DAY).usd;
      const vb = median([-6, -5, -4, -3].map((j) => totalIn(o + j * DAY, o + (j + 1) * DAY).usd)) ?? 0;
      sumK += vk; sumB += vb;
      if (vb > 0) ratios.push(vk / vb);
    }
    return { day: k, drops: ratios.length, below1: ratios.filter((x) => x < 1).length, medianRatio: median(ratios), pooledRatio: sumB > 0 ? sumK / sumB : null };
  });
  // How many wallets play the regular machines from 09:00 to 09:40 UTC on a day without a drop.
  const quietDays: number[] = [];
  const opensDays = new Set(opens.map((o) => Math.floor(o / DAY)));
  for (let day = Math.floor((lastPull - 60 * DAY) / DAY); day < Math.floor(lastPull / DAY); day++) {
    if (opensDays.has(day)) continue;
    quietDays.push(totalIn(day * DAY + 9 * HOUR, day * DAY + 9 * HOUR + PLACEBO_WINDOW).wallets);
  }
  const dropDayOpeningWallets = opens.map((o) => totalIn(o, o + PLACEBO_WINDOW).wallets);

  // ── Hour of day (UTC): regular spend, last 60 complete days ──
  const dayStart = Math.floor(lastPull / DAY) * DAY;
  const hodFrom = dayStart - 60 * DAY;
  const hod = Array.from({ length: 24 }, () => 0);
  let hodTotal = 0;
  for (let i = lowerBound(hodFrom); i < pulls.length && pulls[i].t < dayStart; i++) {
    const p = pulls[i];
    if (p.drop) continue;
    hod[new Date(p.t).getUTCHours()] += p.usd;
    hodTotal += p.usd;
  }
  const hodShare = hod.map((x, h) => ({ hourUtc: h, sharePct: Math.round((1000 * x) / hodTotal) / 10 }));
  // Drop days (the UTC calendar day of an opening) against every other day, same 60 days.
  const dropDays = new Set(opens.map((o) => Math.floor(o / DAY)));
  const hodDrop = Array.from({ length: 24 }, () => 0), hodOther = Array.from({ length: 24 }, () => 0);
  let nDrop = 0, nOther = 0;
  for (let day = Math.floor(hodFrom / DAY); day < Math.floor(dayStart / DAY); day++) {
    if (dropDays.has(day)) nDrop++;
    else nOther++;
  }
  for (let i = lowerBound(hodFrom); i < pulls.length && pulls[i].t < dayStart; i++) {
    const p = pulls[i];
    if (p.drop) continue;
    (dropDays.has(Math.floor(p.t / DAY)) ? hodDrop : hodOther)[new Date(p.t).getUTCHours()] += p.usd;
  }
  const hodSplit = Array.from({ length: 24 }, (_, h) => ({ hourUtc: h, dropDayAvgUsd: Math.round(hodDrop[h] / Math.max(1, nDrop)), otherDayAvgUsd: Math.round(hodOther[h] / Math.max(1, nOther)) }));

  const report = { generatedAt: new Date().toISOString(), lastPull: new Date(lastPull).toISOString(), pooled, tests, realTests, placeboTests, placebo, opening, hourly, daily, quietOpeningWallets: { median: median(quietDays), days: quietDays.length }, dropDayOpeningRegularWallets: { median: median(dropDayOpeningWallets) }, hodShare, hodSplit, hodDays: { drop: nDrop, other: nOther }, perDrop };
  writeFileSync(join(out, "anticipation.json"), JSON.stringify(report, null, 1));

  console.log("\nPooled across drops: drop buyers' share of regular (non-drop) spend, by day around the 09:00 UTC opening");
  console.log("| day | drops | buyers' regular $ | others' regular $ | pooled share | median share |");
  console.log("|---|---|---|---|---|---|");
  for (const p of pooled) console.log(`| ${p.day} | ${p.drops} | ${Math.round(p.buyersUsd).toLocaleString()} | ${Math.round(p.othersUsd).toLocaleString()} | ${p.pooledShare == null ? "—" : (100 * p.pooledShare).toFixed(1) + "%"} | ${p.medianShare == null ? "—" : (100 * p.medianShare).toFixed(1) + "%"} |`);
  console.log("\nPer-drop share ratios (same hours of day):");
  for (const t of tests) console.log(`  ${t.pair}: ${t.below1} of ${t.drops} drops below 1 · median ${r3(t.medianRatio)}`);
  console.log("\nRegular spend by hour (UTC), last 60 complete days:");
  console.log("  " + hodShare.map((h) => `${String(h.hourUtc).padStart(2, "0")}:${h.sharePct}`).join("  "));
  console.log("\nDrop buyers vs a placebo group (active 09:00–09:40 UTC three days before, no drop):");
  for (const k of Object.keys(realTests)) {
    const a = realTests[k as keyof typeof realTests], b = placeboTests[k as keyof typeof placeboTests];
    console.log(`  ${k}: drop buyers median ${r3(a.median)} (${a.drops - a.below1} of ${a.drops} up) · placebo median ${r3(b.median)} (${b.drops - b.below1} of ${b.drops} up)`);
  }
  console.log(`  placebo group size: median ${median(placebo.map((p) => p.wallets))} wallets`);
  console.log("\nRegular spend 09:00–11:00 UTC: drop day vs the median of days -1, -2, -3, -6 (same 2 hours):");
  const sum = (k: keyof (typeof opening)[number]) => opening.reduce((acc, o) => acc + (o[k] as number), 0);
  console.log(`  drop buyers: $${sum("buyers0").toLocaleString()} on drop days vs $${sum("buyersBase").toLocaleString()} baseline · others: $${sum("others0").toLocaleString()} vs $${sum("othersBase").toLocaleString()} (${opening.length} drops summed)`);
  console.log(`  drops where the opening 2h beat baseline (all wallets): ${opening.filter((o) => o.buyers0 + o.others0 > o.buyersBase + o.othersBase).length} of ${opening.length}`);
  console.log(`\nAverage regular $ per hour (UTC), drop days (${nDrop}) vs other days (${nOther}), last 60 days:`);
  console.log("  " + hodSplit.filter((h) => h.hourUtc >= 6 && h.hourUtc <= 14).map((h) => `${String(h.hourUtc).padStart(2, "0")}h ${h.dropDayAvgUsd.toLocaleString()}/${h.otherDayAvgUsd.toLocaleString()}`).join(" · "));
  console.log(`\nTotal regular spend by hour around the opening (h = hours from 09:00 UTC), drop day vs median of days -5..-2, ${opens.length} drops summed (typical drop after the slash):`);
  console.log("  " + hourly.map((h) => `${h.hour >= 0 ? "+" : ""}${h.hour}h ${r3(h.ratio)}/${r3(h.medianRatio)}(${h.dropsAbove}/${h.drops})`).join("  "));
  console.log("\nWhole days (09:00-aligned) vs the median of days -6..-3:");
  for (const d of daily) console.log(`  day ${d.day}: median ratio ${r3(d.medianRatio)}, pooled ${r3(d.pooledRatio)}, ${d.drops - d.below1} of ${d.drops} drops above`);
  console.log(`\nWallets on regular machines 09:00–09:40 UTC: median ${median(quietDays)} on ${quietDays.length} days without a drop · median ${median(dropDayOpeningWallets)} on drop days (regular machines only)`);
  console.log(`\nwrote ${join(out, "anticipation.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
