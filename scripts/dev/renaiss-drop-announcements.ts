/**
 * Does announcing a Renaiss limited drop change play on its regular machines?
 * Lines up regular-machine play (every product that isn't a drop) on each
 * drop's announcement, read from Renaiss's own posts on X, three ways:
 *
 *   1. The hours after each announcement against the hours before it, set
 *      against the same before/after split at the same clock time on nearby
 *      days with no announcement and no opening (placebos). A ratio of ratios,
 *      so the weekday and the hour of day cancel. Summed across drops first,
 *      since a few wallets play in any short window, with a 95% interval from
 *      resampling the drops and the range left by dropping any one of them.
 *   2. The 24 hours from two days before each opening to one day before: after
 *      the announcement in most weeks, before it in weeks announced under a day
 *      ahead. Each against the same clock hours earlier that week.
 *   3. Each drop's sell-out, buyers and opening rush, by how far ahead it was announced.
 *
 * Play is measured as spend and as paying wallets: a few large players swing
 * spend in any short window, and a wallet count shows whether people came.
 *
 *   npx tsx --env-file=.env.local scripts/dev/renaiss-drop-announcements.ts [--announcements=<json>] --out=<dir>
 *
 * <json> defaults to scripts/dev/renaiss-drop-announcements.json (run from the repo root): each
 * drop's first announcement post on @renaissxyz, its time read from the post.
 * [{ "open": "2026-10-23", "name": "Spooky Pack", "announcedAt": "2026-10-21T10:00:00Z" }, …]
 * An entry with "guardOnly": true is a drop older than the history: its
 * announcement and opening are kept out of the placebos, nothing more.
 *
 * The JSON keeps full precision; the console rounds to three places.
 *
 * Reads only; prints counts and ratios, never a wallet; writes local JSON.
 * ⚠️ PRIVATE PARTNER DATA: the output stays local.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectDrops, readDropPulls, readRenaissDrops, walletsOf } from "../../src/lib/renaiss/drops";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Before/after window lengths, in hours. */
const SPANS = [3, 6];
/** Placebos: the same clock time this many days before the announcement. */
const PLACEBO_DAYS = [1, 2, 3, 4, 5, 6];
/** An opening disturbs regular play from 3 hours before it to 6 hours after (renaiss-drop-anticipation.ts). */
const OPEN_BEFORE = 3 * HOUR;
const OPEN_AFTER = 6 * HOUR;
/** A placebo is dropped when an announcement came inside it or this long before it. */
const ANN_AFTERGLOW = DAY;
/** Lead-time groups, in hours: under a day ahead, about two days, about three. */
const leadGroup = (h: number) => (h < 36 ? "short" : h <= 60 ? "usual" : "long");

type Pull = { w: string; t: number; usd: number };
type Measure = { usd: number; wallets: number };
type Group = { set: Set<string>; in: boolean } | null;
const METRICS = ["usd", "wallets"] as const;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r3 = (x: number | null) => (x == null ? null : Math.round(x * 1000) / 1000);
const div = (a: number, b: number) => (b > 0 ? a / b : null);
const isNum = (x: number | null): x is number => x != null;
const binom = (n: number, k: number) => {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - i + 1)) / i;
  return r;
};
/** Two-sided sign test against "no effect" (half below 1). */
const signP = (below: number, n: number) => {
  if (!n) return null;
  let c = 0;
  for (let i = 0; i <= Math.min(below, n - below); i++) c += binom(n, i);
  return Math.min(1, (2 * c) / 2 ** n);
};
/** Exact one-sided rank-sum test: how often a random pick of |a| values ranks at least as high as `a` does. */
const rankSumP = (a: number[], b: number[]) => {
  const all = [...a.map((x) => ({ x, a: true })), ...b.map((x) => ({ x, a: false }))].sort((p, q) => p.x - q.x);
  const observed = all.reduce((t, v, i) => t + (v.a ? i + 1 : 0), 0);
  let hits = 0;
  let total = 0;
  const pick = (start: number, left: number, sum: number) => {
    if (!left) {
      total++;
      if (sum >= observed) hits++;
      return;
    }
    for (let i = start; i <= all.length - left; i++) pick(i + 1, left - 1, sum + i + 1);
  };
  pick(0, a.length, 0);
  return total ? hits / total : null;
};
/** Seeded (mulberry32), so a rerun gives the same intervals. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};
const BOOTSTRAP = 5000;
/** Per drop: [after the post, before it, placebo after (mean), placebo before (mean)]. */
type Sums = [number, number, number, number];
/** All drops summed first, so a quiet window can't swing the result: (Σ after ÷ Σ before) ÷ (Σ placebo after ÷ Σ placebo before). */
const pooledOf = (s: Sums[]) => {
  const tot = (i: number) => s.reduce((t, v) => t + v[i], 0);
  const ev = div(tot(0), tot(1));
  const pl = div(tot(2), tot(3));
  return ev != null && pl ? ev / pl : null;
};
/** pooledOf with each drop left out in turn: the lowest and highest result. */
const leaveOneOutOf = (s: Sums[]): [number | null, number | null] => {
  const xs = s.map((_, i) => pooledOf(s.filter((__, j) => j !== i))).filter(isNum);
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : [null, null];
};
/** 95% interval for pooledOf, resampling whole drops. */
const intervalOf = (s: Sums[]): [number | null, number | null] => {
  const rand = seeded(20261025);
  const xs: number[] = [];
  for (let b = 0; b < BOOTSTRAP; b++) {
    const v = pooledOf(s.map(() => s[Math.floor(rand() * s.length)]));
    if (v != null) xs.push(v);
  }
  xs.sort((a, b) => a - b);
  return xs.length ? [xs[Math.floor(0.025 * xs.length)], xs[Math.floor(0.975 * xs.length)]] : [null, null];
};

async function main() {
  const out = arg("out") ?? "renaiss-drop-announcements";
  mkdirSync(out, { recursive: true });
  const annFile = arg("announcements") ?? join("scripts", "dev", "renaiss-drop-announcements.json");
  const ann = JSON.parse(readFileSync(annFile, "utf8")) as { open: string; name: string; announcedAt: string; guardOnly?: boolean }[];
  const snap = await readRenaissDrops();
  if (!snap?.drops?.length) throw new Error("no renaiss-drops snapshot");
  const annTimes = ann.map((a) => Date.parse(a.announcedAt));
  const fromMs = Math.floor((Math.min(...annTimes) - 8 * DAY) / DAY) * DAY;
  const raw = await readDropPulls(fromMs, Date.now());

  // Drops older than the history sell like any drop: the same rule finds them, so their pulls and openings stay out.
  const older = detectDrops(raw, fromMs, Date.now()).filter((d) => !snap.drops.some((x) => x.productId === d.productId));
  const dropRows = [...snap.drops, ...older];
  const dropIds = new Set(dropRows.map((d) => d.productId));
  const openOf = (d: { openAt?: string; firstAt: string }) => Date.parse(d.openAt ?? d.firstAt);
  const openings = dropRows.map(openOf);
  const dropTimes = new Map<string, number[]>();
  const pulls: Pull[] = [];
  for (const p of raw) {
    if (!p.buyer || !(Number(p.price_usd) > 0)) continue;
    const t = Date.parse(p.pulled_at);
    if (!dropIds.has(p.product_id)) pulls.push({ w: p.buyer.toLowerCase(), t, usd: Number(p.price_usd) });
    else if (dropTimes.has(p.product_id)) dropTimes.get(p.product_id)!.push(t);
    else dropTimes.set(p.product_id, [t]);
  }
  pulls.sort((a, b) => a.t - b.t);
  for (const ts of dropTimes.values()) ts.sort((a, b) => a - b);
  /** The first whole day read: a window starting earlier would count a part day. */
  const dataFrom = Math.ceil(pulls[0].t / DAY) * DAY;
  console.log(`read ${pulls.length.toLocaleString()} paid regular-machine pulls, whole days from ${new Date(dataFrom).toISOString().slice(0, 10)}`);
  console.log(`drops: ${snap.drops.length} in the history, ${older.length} older found by the same rule (${older.map((d) => new Date(openOf(d)).toISOString().slice(0, 16)).join(", ") || "none"})`);

  const events = ann.filter((a) => !a.guardOnly).map((a) => {
    const d = snap.drops.find((x) => new Date(openOf(x)).toISOString().slice(0, 10) === a.open);
    if (!d) throw new Error(`no drop in the history opened on ${a.open}`);
    const A = Date.parse(a.announcedAt);
    const O = openOf(d);
    return { name: a.name, open: a.open, A, O, lead: Math.round(((O - A) / HOUR) * 10) / 10, d, buyers: new Set(walletsOf(d)) };
  });
  for (const a of ann.filter((x) => x.guardOnly)) {
    if (!older.some((d) => new Date(openOf(d)).toISOString().slice(0, 10) === a.open)) throw new Error(`guardOnly ${a.name}: no older drop found opening ${a.open}`);
  }

  const lowerBound = (x: number) => {
    let lo = 0;
    let hi = pulls.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (pulls[m].t < x) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  const measure = (a: number, b: number, g: Group): Measure => {
    let usd = 0;
    const ws = new Set<string>();
    for (let i = lowerBound(a); i < pulls.length && pulls[i].t < b; i++) {
      const p = pulls[i];
      if (g && g.set.has(p.w) !== g.in) continue;
      usd += p.usd;
      ws.add(p.w);
    }
    return { usd, wallets: ws.size };
  };
  const nearOpening = (a: number, b: number) => openings.some((o) => a < o + OPEN_AFTER && b > o - OPEN_BEFORE);
  const announcedIn = (a: number, b: number) => annTimes.some((t) => t >= a && t < b);
  const eventOk = (T: number, L: number) => T - L * HOUR >= dataFrom && !nearOpening(T - L * HOUR, T + L * HOUR);
  const placebos = (A: number, L: number) =>
    PLACEBO_DAYS.map((k) => A - k * DAY).filter((T) => eventOk(T, L) && !announcedIn(T - L * HOUR - ANN_AFTERGLOW, T + L * HOUR));

  // 1. The hours after each announcement against the hours before it, against the placebos' same split.
  const groupsOf = (e: (typeof events)[number]): Record<string, Group> => ({
    all: null,
    buyers: { set: e.buyers, in: true },
    others: { set: e.buyers, in: false },
  });
  const test1 = SPANS.flatMap((L) => {
    const rows = events.map((e) => {
      const pts = placebos(e.A, L);
      if (!eventOk(e.A, L) || !pts.length) return { name: e.name, placebos: pts.length, did: null };
      const did: Record<string, Record<string, number | null>> = {};
      const sums: Record<string, Record<string, Sums>> = {};
      for (const [gk, g] of Object.entries(groupsOf(e))) {
        const ev = { pre: measure(e.A - L * HOUR, e.A, g), post: measure(e.A, e.A + L * HOUR, g) };
        const pl = pts.map((T) => ({ pre: measure(T - L * HOUR, T, g), post: measure(T, T + L * HOUR, g) }));
        did[gk] = {};
        sums[gk] = {};
        for (const m of METRICS) {
          const evR = div(ev.post[m], ev.pre[m]);
          const plR = median(pl.map((p) => div(p.post[m], p.pre[m])).filter(isNum));
          did[gk][m] = evR != null && plR ? evR / plR : null;
          const mean = (k: "pre" | "post") => pl.reduce((s, p) => s + p[k][m], 0) / pl.length;
          sums[gk][m] = [ev.post[m], ev.pre[m], mean("post"), mean("pre")];
        }
      }
      return { name: e.name, placebos: pts.length, did, sums };
    });
    return Object.keys(groupsOf(events[0])).flatMap((gk) =>
      METRICS.map((m) => {
        const xs = rows.map((r) => r.did?.[gk]?.[m] ?? null).filter(isNum);
        const below = xs.filter((x) => x < 1).length;
        const s = rows.flatMap((r) => (r.did && "sums" in r ? [r.sums[gk][m]] : []));
        const perDrop = rows.map((r) => ({ name: r.name, placebos: r.placebos, did: r.did?.[gk]?.[m] ?? null, sums: "sums" in r && r.sums ? r.sums[gk][m] : null }));
        return { hours: L, group: gk, metric: m, drops: xs.length, median: median(xs), below, signP: signP(below, xs.length), pooled: pooledOf(s), interval: intervalOf(s), leaveOneOut: leaveOneOutOf(s), perDrop };
      }),
    );
  });

  // The hour-by-hour shape around the announcement, each hour against the placebos' same hour.
  const byDropHour: { name: string; group: string; hour: number; wallets: number | null }[] = [];
  const profile = Array.from({ length: 12 }, (_, i) => i - 6).map((h) => {
    const per: Record<string, number[]> = { usd: [], wallets: [] };
    const sum: Record<string, [number, number]> = { usd: [0, 0], wallets: [0, 0] };
    for (const e of events) {
      const pts = placebos(e.A, 6);
      if (!eventOk(e.A, 6) || !pts.length) continue;
      const ev = measure(e.A + h * HOUR, e.A + (h + 1) * HOUR, null);
      const base = pts.map((T) => measure(T + h * HOUR, T + (h + 1) * HOUR, null));
      for (const m of METRICS) {
        const b = median(base.map((x) => x[m]))!;
        if (b > 0) per[m].push(ev[m] / b);
        sum[m][0] += ev[m];
        sum[m][1] += b;
        if (m === "wallets") byDropHour.push({ name: e.name, group: leadGroup(e.lead), hour: h, wallets: b > 0 ? ev[m] / b : null });
      }
    }
    return { hour: h, drops: per.usd.length, usdMedian: median(per.usd), usdPooled: div(sum.usd[0], sum.usd[1]), walletsMedian: median(per.wallets), walletsPooled: div(sum.wallets[0], sum.wallets[1]) };
  });

  // 2. 48h to 24h before each opening: after the announcement in most weeks, before it when announced under a day ahead.
  const test2Rows = events.map((e) => {
    const a = e.O - 48 * HOUR;
    const b = e.O - 24 * HOUR;
    const base = [2, 3, 4].map((k) => [a - k * DAY, b - k * DAY]).filter(([x, y]) => x >= dataFrom && !nearOpening(x, y) && !announcedIn(x - ANN_AFTERGLOW, y));
    const block = measure(a, b, null);
    const ratio = (m: (typeof METRICS)[number]) => {
      const bm = median(base.map(([x, y]) => measure(x, y, null)[m]));
      return bm ? block[m] / bm : null;
    };
    return { name: e.name, open: e.open, lead: e.lead, group: leadGroup(e.lead), announced: e.A <= a ? "before" : e.A >= b ? "after" : "inside", baseDays: base.length, usd: ratio("usd"), wallets: ratio("wallets") };
  });
  const test2 = Object.fromEntries(
    METRICS.map((m) => {
      const short = test2Rows.filter((r) => r.group === "short").map((r) => r[m]).filter(isNum);
      const rest = test2Rows.filter((r) => r.group !== "short").map((r) => r[m]).filter(isNum);
      return [m, { shortMedian: median(short), restMedian: median(rest), short: short.length, rest: rest.length, shortHigherP: rankSumP(short, rest) }];
    }),
  );

  // 3. Each drop's outcome by how far ahead it was announced.
  const test3 = events.map((e) => {
    const ts = dropTimes.get(e.d.productId) ?? [];
    const inFirst = (ms: number) => ts.filter((t) => t >= e.O && t < e.O + ms).length;
    return {
      name: e.name, open: e.open, lead: e.lead, group: leadGroup(e.lead), packs: e.d.packs,
      soldOutMin: Math.round((Date.parse(e.d.lastAt) - e.O) / 60_000), buyers: e.d.buyers, newPlayers: e.d.newPlayers,
      first10Min: inFirst(10 * 60_000), firstHourPct: e.d.packs ? Math.round((1000 * inFirst(HOUR)) / e.d.packs) / 10 : null,
    };
  });
  const eraOf = (packs: number) => (packs >= 1000 ? "1,000" : "666/888");
  const ranked = test3.map((r) => {
    const era = test3.filter((x) => eraOf(x.packs) === eraOf(r.packs));
    return { ...r, era: eraOf(r.packs), soldOutRank: `${[...era].sort((x, y) => x.soldOutMin - y.soldOutMin).findIndex((x) => x.name === r.name) + 1} of ${era.length}` };
  });

  // Why a same-clock baseline days earlier misleads: regular play by UTC weekday, drop days left out.
  const dayStats = new Map<number, { usd: number; ws: Set<string> }>();
  for (const p of pulls) {
    const d = Math.floor(p.t / DAY) * DAY;
    const s = dayStats.get(d) ?? { usd: 0, ws: new Set<string>() };
    s.usd += p.usd;
    s.ws.add(p.w);
    dayStats.set(d, s);
  }
  const dropDays = new Set(openings.map((o) => Math.floor(o / DAY) * DAY));
  const lastWhole = Math.floor(Date.now() / DAY) * DAY - DAY;
  const whole = [...dayStats.entries()].filter(([d]) => d >= dataFrom && d <= lastWhole && !dropDays.has(d));
  const allUsd = median(whole.map(([, s]) => s.usd))!;
  const allWs = median(whole.map(([, s]) => s.ws.size))!;
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name, wd) => {
    const ds = whole.filter(([d]) => new Date(d).getUTCDay() === wd);
    return { weekday: name, days: ds.length, usd: median(ds.map(([, s]) => s.usd))! / allUsd, wallets: median(ds.map(([, s]) => s.ws.size))! / allWs };
  });

  writeFileSync(join(out, "announcements.json"), JSON.stringify({ generatedAt: new Date().toISOString(), dataFrom: new Date(dataFrom).toISOString(), test1, profile, byDropHour, test2: { rows: test2Rows, summary: test2 }, test3: ranked, weekdays }, null, 1));

  console.log("\n1. After ÷ before each announcement, against the same split on placebo days (median across drops; 1 = no change):");
  console.log("| hours each side | group | measure | drops | median | below 1 | sign test p | pooled | pooled 95% interval | leaving one drop out |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const s of test1) console.log(`| ${s.hours} | ${s.group} | ${s.metric} | ${s.drops} | ${r3(s.median)} | ${s.below} | ${r3(s.signP)} | ${r3(s.pooled)} | ${r3(s.interval[0])}–${r3(s.interval[1])} | ${r3(s.leaveOneOut[0])}–${r3(s.leaveOneOut[1])} |`);
  const w3 = test1.find((s) => s.hours === 3 && s.group === "all" && s.metric === "wallets")!;
  const typical = median(w3.perDrop.flatMap((r) => (r.sums ? [r.sums[1]] : [])));
  console.log(`typical regular-machine wallets in the 3 hours before a post: ${r3(typical)}`);
  console.log(`placebo days per drop (${SPANS[0]}h): ${test1[0].perDrop.map((r) => r.placebos).join(", ")}`);
  console.log("\nHour by hour around the announcement (hour 0 starts at the post), against the placebos' same hour:");
  console.log("| hour | drops | spend median | spend pooled | wallets median | wallets pooled |");
  console.log("|---|---|---|---|---|---|");
  for (const p of profile) console.log(`| ${p.hour >= 0 ? "+" : ""}${p.hour} | ${p.drops} | ${r3(p.usdMedian)} | ${r3(p.usdPooled)} | ${r3(p.walletsMedian)} | ${r3(p.walletsPooled)} |`);
  console.log("Players 6 to 4 hours before the post, by lead group (median of drops):");
  for (const g of ["short", "usual", "long"]) {
    const cells = [-6, -5, -4].map((h) => `${h}h ${r3(median(byDropHour.filter((x) => x.group === g && x.hour === h && x.wallets != null).map((x) => x.wallets!)))}`);
    console.log(`  ${g}: ${cells.join(" · ")}  (${new Set(byDropHour.filter((x) => x.group === g).map((x) => x.name)).size} drops)`);
  }
  console.log("\n2. 48h to 24h before each opening, against the same hours 2–4 days earlier:");
  console.log("| drop | lead (h) | announced vs block | spend | wallets |");
  console.log("|---|---|---|---|---|");
  for (const r of test2Rows) console.log(`| ${r.name} | ${r.lead} | ${r.announced} | ${r3(r.usd)} | ${r3(r.wallets)} |`);
  for (const m of METRICS) console.log(`${m}: under-a-day weeks median ${r3(test2[m].shortMedian)} (${test2[m].short}) vs the rest ${r3(test2[m].restMedian)} (${test2[m].rest}); P(under-a-day weeks rank this high by chance) = ${r3(test2[m].shortHigherP)}`);
  console.log("\n3. Drop outcomes by lead time:");
  console.log("| drop | lead (h) | packs | sold out (min) | rank in its era | buyers | new to Renaiss | packs in first 10 min | % in first hour |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const r of ranked) console.log(`| ${r.name} | ${r.lead} | ${r.packs} | ${r.soldOutMin} | ${r.soldOutRank} | ${r.buyers} | ${r.newPlayers} | ${r.first10Min} | ${r.firstHourPct} |`);
  console.log("\nRegular play by UTC weekday, drop days left out (median day ÷ median of all days):");
  console.log(`| ${weekdays.map((w) => w.weekday).join(" | ")} |`);
  console.log(`| ${weekdays.map(() => "---").join(" | ")} |`);
  console.log(`| ${weekdays.map((w) => `${r3(w.usd)} / ${r3(w.wallets)}`).join(" | ")} |  (spend / wallets)`);
  console.log(`days per weekday: ${weekdays.map((w) => w.days).join(", ")}`);
  console.log(`\nwrote ${join(out, "announcements.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
