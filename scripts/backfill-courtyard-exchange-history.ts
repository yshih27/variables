/**
 * Courtyard exchange history → the spine, before the live feed's window.
 *
 * The live feed (scripts/warm-courtyard-exchange.ts) stores row-level trades
 * from its first backfill on, and the daily spine writer re-derives Courtyard's
 * resale for its own 30-day window from them. Every older spine day still holds
 * OpenSea trades only, so the resale chart would jump where the feed starts.
 * This re-reads the exchange's history per day on Dune
 * (dune/courtyard-exchange-history.sql, a reclaimed diagnostic slot) and writes:
 *   platform/courtyard/volume_usd     = the stored (OpenSea) value + exchange peer-to-peer
 *   platform/courtyard/trades         = the stored (OpenSea) count + exchange peer-to-peer
 *   platform/courtyard/outflow_gross_usd = exchange buybacks (a new series)
 *
 * ⚠️ IDEMPOTENT THROUGH THE CACHE. "Stored + exchange" is only right once. The
 * first run saves the spine's values as they stood (stored-before.json under
 * --cache) and every later run, --apply included, adds to THOSE, never to what a
 * previous apply wrote. Keep the cache until the backfill is done.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-courtyard-exchange-history.ts --query=7644128 --from=2025-09-09 --to=2026-09-13 --cache=<dir>
 *   … add --apply to write
 *
 * --to is exclusive; set it to the first day the daily writer's 30-day window
 * owns, so the two never both write a day.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runQuery, duneUsage } from "../src/lib/dune/client";
import { readMetricSeries, writeMetricSnapshots, type MetricRow } from "../src/lib/data/metricSnapshots";

const DAY = 86_400_000;
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? null;
const APPLY = process.argv.includes("--apply");

type DayRow = { p2pN: number; p2pUsd: number; bbN: number; bbUsd: number };

function windows(fromMs: number, toMs: number, months: number): [string, string][] {
  const out: [string, string][] = [];
  let a = fromMs;
  const fmt = (d: number) => new Date(d).toISOString().replace("T", " ").slice(0, 19);
  while (a < toMs) {
    const d = new Date(a);
    const b = Math.min(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1), toMs);
    out.push([fmt(a), fmt(b)]);
    a = b;
  }
  return out;
}

async function main() {
  const queryId = Number(arg("query") ?? NaN);
  const cache = arg("cache");
  if (!Number.isFinite(queryId) || !cache) throw new Error("--query=<slot holding dune/courtyard-exchange-history.sql> and --cache=<dir> are required");
  mkdirSync(cache, { recursive: true });
  const from = Date.parse(`${arg("from") ?? "2025-09-09"}T00:00:00Z`);
  const to = Date.parse(`${arg("to")}T00:00:00Z`);
  if (!(from < to) || to > Date.now()) throw new Error("--from < --to, --to a past day boundary");

  // 1. The spine as it stood before any apply.
  const beforeFile = join(cache, "stored-before.json");
  let before: { volume: Record<string, number>; trades: Record<string, number> };
  if (existsSync(beforeFile)) before = JSON.parse(readFileSync(beforeFile, "utf8"));
  else {
    const pick = async (metric: string) =>
      Object.fromEntries((await readMetricSeries("platform", "courtyard", metric)).map((p) => [new Date(Date.parse(p.ts)).toISOString(), p.value]));
    before = { volume: await pick("volume_usd"), trades: await pick("trades") };
    writeFileSync(beforeFile, JSON.stringify(before));
    console.log(`saved the spine as it stands: ${Object.keys(before.volume).length} volume days, ${Object.keys(before.trades).length} trade days → ${beforeFile}`);
  }

  // 2. The exchange per day, cached per window.
  const usage0 = await duneUsage();
  const days = new Map<string, DayRow>();
  for (const [s, e] of windows(from, to, Number(arg("months") ?? 3))) {
    const file = join(cache, `cy-exchange-${s.slice(0, 10)}_${e.slice(0, 10)}.json`);
    let rows: Record<string, unknown>[];
    if (existsSync(file)) rows = JSON.parse(readFileSync(file, "utf8"));
    else {
      const t0 = Date.now();
      rows = (await runQuery(queryId, { params: { start: s, end: e }, maxWaitMs: 1_500_000, pollMs: 10_000 })) as Record<string, unknown>[];
      writeFileSync(file, JSON.stringify(rows));
      console.log(`  [${s.slice(0, 10)}, ${e.slice(0, 10)}): ${rows.length} days in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    for (const r of rows) {
      const raw = String(r.day ?? "");
      const t = Date.parse(raw.includes("T") ? raw : `${raw.slice(0, 10)}T00:00:00Z`);
      if (!Number.isFinite(t)) continue;
      days.set(new Date(Math.floor(t / DAY) * DAY).toISOString(), {
        p2pN: Number(r.p2p_trades) || 0,
        p2pUsd: Number(r.p2p_usd) || 0,
        bbN: Number(r.buyback_trades) || 0,
        bbUsd: Number(r.buyback_usd) || 0,
      });
    }
  }
  const usage1 = await duneUsage();

  // 3. Report per month, then write.
  const rows: MetricRow[] = [];
  const months = new Map<string, { stored: number; p2p: number; p2pN: number; bb: number; days: number }>();
  for (const [day, d] of [...days.entries()].sort()) {
    const sv = before.volume[day] ?? 0;
    const st = before.trades[day] ?? 0;
    rows.push({ entity_type: "platform", entity_key: "courtyard", metric: "volume_usd", value: sv + d.p2pUsd, ts: day });
    rows.push({ entity_type: "platform", entity_key: "courtyard", metric: "trades", value: st + d.p2pN, ts: day });
    rows.push({ entity_type: "platform", entity_key: "courtyard", metric: "outflow_gross_usd", value: d.bbUsd, ts: day });
    const m = months.get(day.slice(0, 7)) ?? { stored: 0, p2p: 0, p2pN: 0, bb: 0, days: 0 };
    m.stored += sv;
    m.p2p += d.p2pUsd;
    m.p2pN += d.p2pN;
    m.bb += d.bbUsd;
    m.days++;
    months.set(day.slice(0, 7), m);
  }
  console.log(`\n| Month | Days | Resale stored (OpenSea) | + exchange peer-to-peer | Buybacks |\n|---|---|---|---|---|`);
  for (const [m, v] of [...months.entries()].sort()) {
    console.log(`| ${m} | ${v.days} | $${Math.round(v.stored).toLocaleString()} | $${Math.round(v.p2p).toLocaleString()} (${v.p2pN.toLocaleString()}) | $${Math.round(v.bb).toLocaleString()} |`);
  }
  if (usage0 && usage1) console.log(`Dune credits ${usage0.creditsUsed.toFixed(1)} → ${usage1.creditsUsed.toFixed(1)} (${(usage1.creditsUsed - usage0.creditsUsed).toFixed(1)} this run)`);
  if (!APPLY) return console.log("\nDry run: nothing written. Pass --apply to write.");
  const n = await writeMetricSnapshots(rows);
  console.log(`\nWrote ${n} spine rows (${days.size} days × volume_usd, trades, outflow_gross_usd).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
