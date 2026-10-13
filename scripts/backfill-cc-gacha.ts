/**
 * Collector Crypt gacha history, re-derived under the every-payment rule (#193).
 *
 * The daily query re-derives only the trailing 35 days, so every older spine day
 * of `platform / collector-crypt / gacha_volume_usd` still carries the old
 * price-list basis, and the series would step ~35 days back. This re-reads the
 * history with dune/cc-gacha-history.sql (saved to DUNE_CC_GACHA_HISTORY_QUERY_ID,
 * a reclaimed diagnostic slot), a few months per execution, and prints, per
 * month, the stored total against the re-derived one. Nothing is written
 * without --apply.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-cc-gacha.ts --from=2024-11-01 --to=2026-10-13
 *   npx tsx --env-file=.env.local scripts/backfill-cc-gacha.ts --from=2024-11-01 --to=2026-10-13 --apply
 *
 * --to is exclusive and must be a day boundary at or before today (a partial
 * day is never written). --months=N sets the window per execution (default 6).
 * Results are cached under --cache=<dir> so an --apply after a dry run spends
 * nothing on Dune.
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

function windows(fromMs: number, toMs: number, months: number): [string, string][] {
  const out: [string, string][] = [];
  let a = new Date(fromMs);
  while (a.getTime() < toMs) {
    const b = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + months, 1));
    const end = Math.min(b.getTime(), toMs);
    const fmt = (d: number) => new Date(d).toISOString().replace("T", " ").slice(0, 19);
    out.push([fmt(a.getTime()), fmt(end)]);
    a = new Date(end);
  }
  return out;
}

async function main() {
  const queryId = Number(process.env.DUNE_CC_GACHA_HISTORY_QUERY_ID ?? arg("query") ?? NaN);
  if (!Number.isFinite(queryId)) throw new Error("set DUNE_CC_GACHA_HISTORY_QUERY_ID (or --query=<id>) to the slot holding dune/cc-gacha-history.sql");
  const from = Date.parse(`${arg("from") ?? "2024-11-01"}T00:00:00Z`);
  const to = Date.parse(`${arg("to") ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const today = Math.floor(Date.now() / DAY) * DAY;
  if (!(from < to) || to > today || to % DAY !== 0) throw new Error("--from < --to, both day boundaries, --to at or before today (UTC)");
  const cacheDir = arg("cache");
  if (cacheDir) mkdirSync(cacheDir, { recursive: true });

  const before = await duneUsage();
  const fresh = new Map<string, number>(); // day ISO → volume
  for (const [s, e] of windows(from, to, Number(arg("months") ?? 6))) {
    const file = cacheDir ? join(cacheDir, `cc-gacha-${s.slice(0, 10)}_${e.slice(0, 10)}.json`) : null;
    let rows: Record<string, unknown>[];
    if (file && existsSync(file)) rows = JSON.parse(readFileSync(file, "utf8"));
    else {
      const t0 = Date.now();
      rows = (await runQuery(queryId, { params: { start: s, end: e }, maxWaitMs: 1_500_000, pollMs: 10_000 })) as Record<string, unknown>[];
      if (file) writeFileSync(file, JSON.stringify(rows));
      console.log(`  [${s.slice(0, 10)}, ${e.slice(0, 10)}): ${rows.length} days in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    for (const r of rows) {
      const raw = String(r.day ?? "");
      const t = Date.parse(raw.includes("T") ? raw : raw.replace(" UTC", "Z").replace(" ", "T"));
      const v = Number(r.volume_usd);
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
      fresh.set(new Date(Math.floor(t / DAY) * DAY).toISOString(), v);
    }
  }
  const after = await duneUsage();

  const stored = new Map<string, number>();
  for (const p of await readMetricSeries("platform", "collector-crypt", "gacha_volume_usd")) {
    const t = Date.parse(p.ts);
    if (t >= from && t < to) stored.set(new Date(t).toISOString(), p.value);
  }
  const months = new Map<string, { old: number; neu: number; days: number; onlyOld: number }>();
  for (const day of new Set([...stored.keys(), ...fresh.keys()])) {
    const m = day.slice(0, 7);
    const a = months.get(m) ?? { old: 0, neu: 0, days: 0, onlyOld: 0 };
    a.old += stored.get(day) ?? 0;
    a.neu += fresh.get(day) ?? 0;
    if (fresh.has(day)) a.days++;
    else a.onlyOld++;
    months.set(m, a);
  }
  console.log(`\n| Month | Days re-derived | Stored | Re-derived | Change |\n|---|---|---|---|---|`);
  let tOld = 0;
  let tNew = 0;
  for (const [m, a] of [...months.entries()].sort()) {
    tOld += a.old;
    tNew += a.neu;
    const ch = a.old > 0 ? `${(((a.neu - a.old) / a.old) * 100).toFixed(1)}%` : "—";
    console.log(`| ${m} | ${a.days}${a.onlyOld ? ` (+${a.onlyOld} stored only)` : ""} | $${Math.round(a.old).toLocaleString()} | $${Math.round(a.neu).toLocaleString()} | ${ch} |`);
  }
  console.log(`| all | ${fresh.size} | $${Math.round(tOld).toLocaleString()} | $${Math.round(tNew).toLocaleString()} | ${tOld > 0 ? (((tNew - tOld) / tOld) * 100).toFixed(1) + "%" : "—"} |`);
  if (before && after) console.log(`Dune credits: ${before.creditsUsed.toFixed(1)} → ${after.creditsUsed.toFixed(1)} (${(after.creditsUsed - before.creditsUsed).toFixed(1)} this run) of ${after.creditsIncluded} for the period from ${after.periodStart}`);

  if (!APPLY) {
    console.log("\nDry run: nothing written. Pass --apply to upsert the re-derived days.");
    return;
  }
  const rows: MetricRow[] = [...fresh.entries()].map(([ts, value]) => ({ entity_type: "platform", entity_key: "collector-crypt", metric: "gacha_volume_usd", value, ts }));
  const n = await writeMetricSnapshots(rows);
  console.log(`\nWrote ${n} days of platform / collector-crypt / gacha_volume_usd.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
