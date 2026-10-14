/**
 * Courtyard's buyback arbitrage per UTC day, measured from Polygon, for the
 * spine's history before the exchange feed's store reaches back
 * (`backfill-courtyard-exchange-history.ts --arbitrage=<dir>` applies it).
 *
 *   npx tsx scripts/measure-courtyard-arbitrage.ts --from=2025-09-09 --to=2026-09-15 --cache=<dir> [--streams=3]
 *
 * For each day in [from, to): peer-to-peer trades and dollars, the part that is
 * buyback arbitrage (src/lib/courtyard/arbitrage.ts) and the buybacks, one JSON
 * per day in --cache. Each stream reads a contiguous span of days plus the 24
 * hours after it (the window a purchase's buyback can fall in), in chain order,
 * and a day is written only once every purchase on it has had its full window
 * read. Cached days are skipped, so a run that dies resumes where it stopped.
 * Public RPC only: it reads nothing else and writes nothing but the cache.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { blockAtOrAfter, blockTimeMs, fetchExchangeTrades, polygonSafeTip, LOG_CHUNK_BLOCKS } from "../src/lib/courtyard/exchange";
import { ArbitrageMatcher, ARBITRAGE_WINDOW_MS, emptyTally, exchangeSaleId, type DayTally } from "../src/lib/courtyard/arbitrage";

const DAY = 86_400_000;
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? null;
const READ_BLOCKS = LOG_CHUNK_BLOCKS * 12;

export type ArbitrageDay = { day: string; p2pN: number; p2pUsd: number; arbN: number; arbUsd: number; buybackN: number; buybackUsd: number; measuredAt: string };

const dayIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const fileOf = (cache: string, day: string) => join(cache, `arb-${day}.json`);

/**
 * One RPC step, retried in place: the public endpoint times out under load and
 * refuses connections for minutes at a time (measured Oct 13: ~7 minutes of
 * "fetch failed" ended a run). A failed step must not send the span back to its
 * first unwritten day, and it must outlast an outage.
 */
async function withRetry<T>(label: string, tag: string, step: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await step();
    } catch (e) {
      if (attempt >= 30) throw e;
      const wait = Math.min(attempt * 20_000, 300_000);
      console.warn(`  [${tag}] ${label}: ${(e as Error).message} — retry ${attempt} in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/** Contiguous runs of day starts. */
function runs(days: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const d of days) {
    const last = out[out.length - 1];
    if (last && last[1] === d) last[1] = d + DAY;
    else out.push([d, d + DAY]);
  }
  return out;
}

/** One span [d0, d1): read through d1 + the window, write each day once it is final. */
async function measureSpan(d0: number, d1: number, cache: string, tag: string): Promise<number> {
  const tip = await withRetry("tip", tag, () => polygonSafeTip());
  const a0 = await withRetry("first block", tag, () => blockAtOrAfter(d0));
  const endMs = d1 + ARBITRAGE_WINDOW_MS;
  const a1 = Math.min(tip, (await withRetry("last block", tag, () => blockAtOrAfter(endMs))) - 1);
  const matcher = new ArbitrageMatcher();
  const purchases = new Map<string, { day: number; usd: number }>();
  const buybacks = new Map<number, { n: number; usd: number }>();
  const arb = new Set<string>();
  let nextDay = d0;
  let written = 0;
  const t0 = Date.now();

  const finalize = (upToMs: number) => {
    // A day is final when its last purchase's window has been read.
    while (nextDay < d1 && nextDay + DAY + ARBITRAGE_WINDOW_MS <= upToMs) {
      const t: DayTally = emptyTally();
      for (const [id, p] of purchases) {
        if (p.day !== nextDay) continue;
        if (arb.has(id)) {
          t.arbN++;
          t.arbUsd += p.usd;
        } else {
          t.resaleN++;
          t.resaleUsd += p.usd;
        }
        purchases.delete(id);
        arb.delete(id);
      }
      const bb = buybacks.get(nextDay) ?? { n: 0, usd: 0 };
      const row: ArbitrageDay = {
        day: dayIso(nextDay),
        p2pN: t.resaleN + t.arbN,
        p2pUsd: t.resaleUsd + t.arbUsd,
        arbN: t.arbN,
        arbUsd: t.arbUsd,
        buybackN: bb.n,
        buybackUsd: bb.usd,
        measuredAt: new Date().toISOString(),
      };
      writeFileSync(fileOf(cache, row.day), JSON.stringify(row));
      written++;
      const share = row.p2pUsd > 0 ? ((100 * row.arbUsd) / row.p2pUsd).toFixed(1) : "0.0";
      console.log(`  [${tag}] ${row.day}: p2p ${row.p2pN.toLocaleString()} $${Math.round(row.p2pUsd).toLocaleString()} · arbitrage ${row.arbN.toLocaleString()} $${Math.round(row.arbUsd).toLocaleString()} (${share}%) · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      buybacks.delete(nextDay);
      nextDay += DAY;
    }
  };

  for (let a = a0; a <= a1; a += READ_BLOCKS) {
    const b = Math.min(a1, a + READ_BLOCKS - 1);
    const batch = await withRetry(`blocks ${a.toLocaleString()}–${b.toLocaleString()}`, tag, () => fetchExchangeTrades(a, b));
    for (const t of batch) {
      const ms = Date.parse(t.ts);
      const day = Math.floor(ms / DAY) * DAY;
      if (t.kind === "p2p") {
        const id = exchangeSaleId(t);
        matcher.purchase({ id, bidder: t.bidder, tokenId: t.tokenId, ms });
        if (day >= d0 && day < d1) purchases.set(id, { day, usd: t.usd });
      } else {
        if (day >= d0 && day < d1) {
          const bb = buybacks.get(day) ?? { n: 0, usd: 0 };
          bb.n++;
          bb.usd += t.usd;
          buybacks.set(day, bb);
        }
        const hit = matcher.buyback(t.asker, t.tokenId, ms);
        if (hit) arb.add(hit);
      }
    }
    if (batch.length) {
      const lastMs = Date.parse(batch[batch.length - 1].ts);
      matcher.prune(lastMs);
      finalize(lastMs);
    }
  }
  // The read reached d1 + the window, or the tip when that came first: every day
  // whose window ends by then is final.
  finalize(a1 === tip ? await withRetry("tip time", tag, () => blockTimeMs(tip)) : endMs);
  return written;
}

async function main() {
  const cache = arg("cache");
  const from = Date.parse(`${arg("from")}T00:00:00Z`);
  const to = Date.parse(`${arg("to")}T00:00:00Z`);
  const streams = Math.max(1, Number(arg("streams") ?? 3));
  if (!cache || !(from < to)) throw new Error("--from=YYYY-MM-DD --to=YYYY-MM-DD (exclusive) --cache=<dir> are required");
  if (to + ARBITRAGE_WINDOW_MS > Date.now()) throw new Error("--to must leave a full 24 h window read before now");
  mkdirSync(cache, { recursive: true });

  const todo: number[] = [];
  for (let d = from; d < to; d += DAY) if (!existsSync(fileOf(cache, dayIso(d)))) todo.push(d);
  console.log(`Courtyard arbitrage: ${(to - from) / DAY} day(s) in range, ${todo.length} to measure, ${streams} stream(s) · cache ${cache}`);

  // Contiguous chunks of up to CHUNK_DAYS, dealt round-robin: each stream gets a
  // mix of light and heavy months (a summer day reads ~10× the logs of an autumn
  // one), and a chunk costs one extra day of reading for its 24-hour window.
  const CHUNK_DAYS = 10;
  const chunks: [number, number][] = [];
  for (const [r0, r1] of runs(todo)) for (let c = r0; c < r1; c += CHUNK_DAYS * DAY) chunks.push([c, Math.min(r1, c + CHUNK_DAYS * DAY)]);
  const lanes = Array.from({ length: streams }, (_, i) => chunks.filter((_, j) => j % streams === i)).filter((l) => l.length);
  const results = await Promise.allSettled(
    lanes.map(async (lane, i) => {
      for (const [d0, d1] of lane) {
        for (let attempt = 1; ; attempt++) {
          try {
            // A retry resumes after the days the failed attempt already wrote.
            let start = d0;
            while (start < d1 && existsSync(fileOf(cache, dayIso(start)))) start += DAY;
            if (start >= d1) break;
            await measureSpan(start, d1, cache, `s${i + 1}`);
            break;
          } catch (e) {
            if (attempt >= 5) throw e;
            console.warn(`  [s${i + 1}] ${dayIso(d0)}…: ${(e as Error).message} — span retry ${attempt} in ${attempt * 60}s`);
            await new Promise((r) => setTimeout(r, attempt * 60_000));
          }
        }
      }
    }),
  );
  // One stream's failure never stops the others; the cache keeps every day any of
  // them finished, and a re-run measures only what is left.
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  for (const f of failed) console.error(`  a stream stopped: ${(f.reason as Error)?.message ?? f.reason}`);

  // The range as measured, per month.
  const months = new Map<string, { days: number; p2p: number; arb: number; arbN: number; p2pN: number }>();
  for (let d = from; d < to; d += DAY) {
    const f = fileOf(cache, dayIso(d));
    if (!existsSync(f)) continue;
    const r = JSON.parse(readFileSync(f, "utf8")) as ArbitrageDay;
    const m = months.get(r.day.slice(0, 7)) ?? { days: 0, p2p: 0, arb: 0, arbN: 0, p2pN: 0 };
    m.days++;
    m.p2p += r.p2pUsd;
    m.arb += r.arbUsd;
    m.p2pN += r.p2pN;
    m.arbN += r.arbN;
    months.set(r.day.slice(0, 7), m);
  }
  console.log(`\n| Month | Days | Peer-to-peer | Arbitrage | Share of dollars |\n|---|---|---|---|---|`);
  for (const [m, v] of [...months.entries()].sort()) {
    console.log(`| ${m} | ${v.days} | ${v.p2pN.toLocaleString()} · $${Math.round(v.p2p).toLocaleString()} | ${v.arbN.toLocaleString()} · $${Math.round(v.arb).toLocaleString()} | ${v.p2p > 0 ? ((100 * v.arb) / v.p2p).toFixed(1) : "0.0"}% |`);
  }
  const measured = [...months.values()].reduce((n, v) => n + v.days, 0);
  console.log(`
${measured} of ${(to - from) / DAY} day(s) measured${failed.length ? ` · ${failed.length} stream(s) stopped: re-run to finish` : ""}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
