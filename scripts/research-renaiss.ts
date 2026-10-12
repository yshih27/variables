/**
 * Renaiss research, read-only: the life of a pull, stated prize values against
 * resale, and (with --index) Renaiss marketplace prices against the Renaiss
 * Index. Writes JSON + markdown under --out; never writes production.
 *
 *   npx tsx --env-file=.env.local scripts/research-renaiss.ts --out=/tmp/rn
 *   npx tsx --env-file=.env.local scripts/research-renaiss.ts --out=/tmp/rn --index --max-calls=3000
 *
 * The pull and sale rows are cached under --out (pulls.json, sales.json); pass
 * --refresh to read them again. 637K named pulls is ~640 keyset pages.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../src/lib/db/client";
import {
  DAY_MS,
  VALUE_TIERS,
  fateTable,
  outcomesOf,
  quantiles,
  recycling,
  statedVsResale,
  tierOf,
  type ResearchPull,
  type ResearchSale,
} from "../src/lib/renaiss/research";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? null;
const OUT = arg("out");
const REFRESH = process.argv.includes("--refresh");

/**
 * Every named pull, keyset-paged on the PRIMARY KEY.
 *
 * ⚠️ NOT ON prize_instance_id. Paging on the token with a "start at the last
 * token, skip what was read" boundary stalls when one token fills a page:
 * measured Oct 12, a slab pulled 1,000+ times returned the same 1,000 rows on
 * the next page and the read stopped at 4,050 of 637,445 named pulls.
 */
async function readPulls(): Promise<ResearchPull[]> {
  const PAGE = 1000;
  const out: ResearchPull[] = [];
  let cursor = "";
  for (let page = 0; ; page++) {
    const { data, error } = await db()
      .from("renaiss_pulls")
      .select("pull_id, prize_instance_id, pulled_at, buyer, price_usd, prize_value_usd, product_id, machine_name, prize_cert, prize_grade_label")
      .not("prize_instance_id", "is", null)
      .gt("pull_id", cursor)
      .order("pull_id", { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(`[renaiss_pulls] read failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      const num = (x: unknown) => (x == null ? null : Number.isFinite(Number(x)) ? Number(x) : null);
      out.push({
        pullId: String(r.pull_id),
        tokenId: String(r.prize_instance_id).replace(/^rn-/, ""),
        pulledAt: Date.parse(String(r.pulled_at)),
        buyer: r.buyer ? String(r.buyer).toLowerCase() : null,
        paidUsd: num(r.price_usd),
        statedUsd: num(r.prize_value_usd),
        machine: String(r.machine_name ?? r.product_id ?? "unknown"),
        cert: r.prize_cert ? String(r.prize_cert) : null,
        grade: r.prize_grade_label ? String(r.prize_grade_label) : null,
      });
    }
    if (page % 50 === 0) console.log(`  pulls page ${page}: ${out.length.toLocaleString()} rows`);
    if (rows.length < PAGE) break;
    cursor = String(rows[rows.length - 1].pull_id);
  }
  return out;
}

async function readSales(): Promise<ResearchSale[]> {
  const PAGE = 1000;
  const out: ResearchSale[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("renaiss_sales")
      .select("sale_id, token_id, sold_at, seller, buyer, price_usd, cert, grader, grade_raw")
      .order("sale_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`[renaiss_sales] read failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      const p = Number(r.price_usd);
      if (!(p >= 1)) continue; // the panel's dust floor: a sale under $1 is not a price
      out.push({
        tokenId: String(r.token_id),
        soldAt: Date.parse(String(r.sold_at)),
        seller: r.seller ? String(r.seller).toLowerCase() : null,
        buyer: r.buyer ? String(r.buyer).toLowerCase() : null,
        priceUsd: p,
        cert: r.cert ? String(r.cert) : null,
        grade: r.grader && r.grade_raw ? `${r.grader} ${String(r.grade_raw).split(" ")[0]}` : null,
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

async function cached<T>(file: string, read: () => Promise<T>): Promise<T> {
  if (OUT && !REFRESH && existsSync(join(OUT, file))) return JSON.parse(readFileSync(join(OUT, file), "utf8")) as T;
  const v = await read();
  if (OUT) writeFileSync(join(OUT, file), JSON.stringify(v));
  return v;
}

// ── The Renaiss Index side (--index): cert → card href → daily FMV ────────────
// Every response is cached under <out>/index-cache, so a rerun spends nothing on
// what it already read. RENAISS_MAX_CALLS caps a run (renaissGet enforces it).

type Lookup = { found: boolean; reason: string | null; href: string | null; grade: string | null; confidence: string | null; priceUsd: number | null };
type Series = { gradeLabel: string | null; fmvWindowDays: number; points: { t: string; usdCents: number }[] } | { error: string };

function loadJson<T>(file: string, empty: T): T {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : empty;
}

async function indexReads(certs: string[]): Promise<{ lookups: Record<string, Lookup>; series: Record<string, Series>; calls: number }> {
  const { renaissGet, renaissCallCount } = await import("../src/lib/renaiss/client");
  const dir = join(OUT!, "index-cache");
  mkdirSync(dir, { recursive: true });
  const lf = join(dir, "lookups.json");
  const sf = join(dir, "series.json");
  const lookups = loadJson<Record<string, Lookup>>(lf, {});
  const series = loadJson<Record<string, Series>>(sf, {});
  const todo = [...new Set(certs)].filter((c) => !(c in lookups));
  // 20 certs a call: a 50-cert batch hung for minutes on Oct 5; 20 took ~12 s.
  for (let i = 0; i < todo.length; i += 20) {
    const batch = todo.slice(i, i + 20);
    try {
      const { body } = await renaissGet<{ lookups?: Record<string, unknown>[] }>("/graded/lookup", { certs: batch.join(",") });
      for (const l of body.lookups ?? []) {
        // The live API sends the card as `card`; the spec's preferred name is `item`.
        const card = (l.item ?? l.card) as Record<string, unknown> | null;
        lookups[String(l.cert)] = {
          found: Boolean(l.found),
          reason: (l.reason as string) ?? null,
          href: card?.href ? String(card.href) : null,
          grade: (l.gradeLabel as string) ?? null,
          confidence: (card?.confidence as string) ?? null,
          priceUsd: card?.priceUsdCents == null ? null : Number(card.priceUsdCents) / 100,
        };
      }
      for (const c of batch) if (!(c in lookups)) lookups[c] = { found: false, reason: "unparsed", href: null, grade: null, confidence: null, priceUsd: null };
    } catch (e) {
      console.warn(`  lookup batch failed (${(e as Error).message}); stopping lookups`);
      break;
    }
    writeFileSync(lf, JSON.stringify(lookups));
    if ((i / 20) % 25 === 0) console.log(`  lookups ${Math.min(i + 20, todo.length)}/${todo.length} · calls ${renaissCallCount()}`);
  }
  const hrefs = [...new Set(Object.values(lookups).map((l) => l.href).filter((h): h is string => !!h))].filter((h) => !(h in series));
  for (let i = 0; i < hrefs.length; i++) {
    const h = hrefs[i];
    try {
      const { body } = await renaissGet<{ gradeLabel: string | null; fmvWindowDays: number; points: { t: string; usdCents: number }[] }>(`/items${h.replace(/^\/card/, "")}/fmv-series`, { window: 365 });
      series[h] = { gradeLabel: body.gradeLabel, fmvWindowDays: body.fmvWindowDays, points: body.points.map((p) => ({ t: p.t, usdCents: p.usdCents })) };
    } catch (e) {
      const m = (e as Error).message;
      if (/ceiling|rate/i.test(m)) {
        console.warn(`  series stopped: ${m}`);
        break;
      }
      series[h] = { error: m.slice(0, 120) };
    }
    if (i % 100 === 0) {
      writeFileSync(sf, JSON.stringify(series));
      console.log(`  series ${i + 1}/${hrefs.length} · calls ${renaissCallCount()}`);
    }
  }
  writeFileSync(sf, JSON.stringify(series));
  return { lookups, series, calls: renaissCallCount() };
}

/** The Index FMV for this card on the day BEFORE `ms` (so a sale never benchmarks against itself), within 7 days. */
function fmvBefore(s: Series | undefined, ms: number): number | null {
  if (!s || "error" in s) return null;
  const dayStart = Math.floor(ms / DAY_MS) * DAY_MS;
  let best: { t: number; v: number } | null = null;
  for (const p of s.points) {
    const t = Date.parse(p.t);
    if (t < dayStart && t >= dayStart - 7 * DAY_MS && p.usdCents > 0 && (!best || t > best.t)) best = { t, v: p.usdCents / 100 };
  }
  return best?.v ?? null;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const usd = (x: number | null) => (x == null ? "—" : `$${x.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
const r2 = (x: number | null) => (x == null ? "—" : x.toFixed(2));

async function main() {
  if (!OUT) throw new Error("--out=<dir> is required: this script never writes production");
  mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  const [pulls, sales] = await Promise.all([cached("pulls.json", readPulls), cached("sales.json", readSales)]);
  const now = Date.now();
  console.log(`read ${pulls.length.toLocaleString()} named pulls, ${sales.length.toLocaleString()} sales ≥ $1 in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const outcomes = outcomesOf(pulls, sales);
  const H = 30 * DAY_MS;
  const overall = fateTable(outcomes, () => "all", H, now);
  const byTier = fateTable(outcomes, (o) => tierOf(o.pull.statedUsd), H, now);
  const byMachine = fateTable(outcomes, (o) => o.pull.machine, H, now).slice(0, 15);
  const byMonth = fateTable(outcomes, (o) => new Date(o.pull.pulledAt).toISOString().slice(0, 7), H, now).sort((a, b) => a.group.localeCompare(b.group));
  const stated = statedVsResale(outcomes, () => "all", H);
  const statedTier = statedVsResale(outcomes, (o) => tierOf(o.pull.statedUsd), H);
  const statedMachine = statedVsResale(outcomes, (o) => o.pull.machine, H).filter((r) => r.n >= 30).slice(0, 15);
  const statedMonth = statedVsResale(outcomes, (o) => new Date(o.pull.pulledAt).toISOString().slice(0, 7), H).sort((a, b) => a.group.localeCompare(b.group));
  const recycle = recycling(pulls);
  const paidVsStated = quantiles(pulls.filter((p) => p.paidUsd && p.statedUsd).map((p) => p.statedUsd! / p.paidUsd!));
  const coverage = {
    namedPulls: pulls.length,
    withStated: pulls.filter((p) => p.statedUsd != null).length,
    firstNamed: new Date(pulls.reduce((m, p) => Math.min(m, p.pulledAt), Infinity)).toISOString(),
    lastNamed: new Date(pulls.reduce((m, p) => Math.max(m, p.pulledAt), -Infinity)).toISOString(),
    sales: sales.length,
    salesOfPulledTokens: (() => {
      const pulled = new Set(pulls.map((p) => p.tokenId));
      return sales.filter((s) => pulled.has(s.tokenId)).length;
    })(),
  };
  // ── 3. Marketplace price against the Renaiss Index (--index) ─────────────────
  // Each sale ÷ the Index FMV for the same cert's card at the same grade, on the
  // day before the sale. Sales since --since (default 2026-07-01), certs only.
  let indexBlock: Record<string, unknown> | null = null;
  let indexMd: string[] = [];
  if (process.argv.includes("--index")) {
    const since = Date.parse(arg("since") ?? "2026-07-01T00:00:00Z");
    const recent = sales.filter((s) => s.cert && s.soldAt >= since);
    const statedSince = Date.parse(arg("stated-since") ?? new Date(now - 14 * DAY_MS).toISOString());
    const statedPulls = pulls.filter((p) => p.cert && p.statedUsd != null && p.statedUsd > 0 && p.pulledAt >= statedSince);
    const { lookups, series, calls } = await indexReads([...recent.map((s) => s.cert!), ...statedPulls.map((p) => p.cert!)]);
    type Cmp = { ratio: number; price: number; fmv: number; grade: string | null; confidence: string | null; month: string };
    const cmps: Cmp[] = [];
    let noLookup = 0;
    let notFound = 0;
    let noFmv = 0;
    for (const s of recent) {
      const l = lookups[s.cert!];
      if (!l) { noLookup++; continue; }
      if (!l.found || !l.href) { notFound++; continue; }
      const fmv = fmvBefore(series[l.href], s.soldAt);
      if (fmv == null) { noFmv++; continue; }
      cmps.push({ ratio: s.priceUsd / fmv, price: s.priceUsd, fmv, grade: l.grade, confidence: l.confidence, month: new Date(s.soldAt).toISOString().slice(0, 7) });
    }
    const group = (key: (c: Cmp) => string) => {
      const m = new Map<string, Cmp[]>();
      for (const c of cmps) m.set(key(c), [...(m.get(key(c)) ?? []), c]);
      return [...m.entries()]
        .map(([g, cs]) => ({ group: g, n: cs.length, ratio: quantiles(cs.map((c) => c.ratio)), pooled: cs.reduce((a, c) => a + c.price, 0) / cs.reduce((a, c) => a + c.fmv, 0), above: cs.filter((c) => c.ratio > 1.1).length / cs.length, below: cs.filter((c) => c.ratio < 0.9).length / cs.length }))
        .sort((a, b) => b.n - a.n);
    };
    const band = (p: number) => (p < 50 ? "under $50" : p < 200 ? "$50–200" : p < 1000 ? "$200–1,000" : "$1,000+");
    const rows = {
      overall: group(() => "all"),
      byConfidence: group((c) => c.confidence ?? "unknown"),
      byGrade: group((c) => c.grade ?? "unknown").slice(0, 8),
      byPrice: group((c) => band(c.price)),
      byMonth: group((c) => c.month).sort((a, b) => a.group.localeCompare(b.group)),
    };
    // ── 2b. Stated prize value against the Index FMV for the same cert at its grade
    // (the card's CURRENT reference price; pulls in the last 14 days, so the
    // market has had little time to move).
    type SCmp = { ratio: number; stated: number; fmv: number; machine: string; confidence: string | null };
    const scmps: SCmp[] = [];
    let sNotFound = 0;
    for (const p of statedPulls) {
      const l = lookups[p.cert!];
      if (!l || !l.found || l.priceUsd == null || !(l.priceUsd > 0)) { sNotFound++; continue; }
      scmps.push({ ratio: p.statedUsd! / l.priceUsd, stated: p.statedUsd!, fmv: l.priceUsd, machine: p.machine, confidence: l.confidence });
    }
    const sgroup = (key: (c: SCmp) => string) => {
      const m = new Map<string, SCmp[]>();
      for (const c of scmps) m.set(key(c), [...(m.get(key(c)) ?? []), c]);
      return [...m.entries()]
        .map(([g, cs]) => ({ group: g, n: cs.length, ratio: quantiles(cs.map((c) => c.ratio)), pooled: cs.reduce((a, c) => a + c.stated, 0) / cs.reduce((a, c) => a + c.fmv, 0), exact: cs.filter((c) => Math.abs(c.ratio - 1) <= 0.01).length / cs.length, above: cs.filter((c) => c.ratio > 1.1).length / cs.length, below: cs.filter((c) => c.ratio < 0.9).length / cs.length }))
        .sort((a, b) => b.n - a.n);
    };
    const stated2 = { since: new Date(statedSince).toISOString(), pulls: statedPulls.length, compared: scmps.length, notFound: sNotFound, overall: sgroup(() => "all"), byMachine: sgroup((c) => c.machine).slice(0, 8), byConfidence: sgroup((c) => c.confidence ?? "unknown"), byTier: sgroup((c) => tierOf(c.stated) ?? "?") };
    const st = (rs: typeof stated2.overall) =>
      ["| Group | Pulls | Stated ÷ Index FMV, median (IQR) | Σ stated ÷ Σ FMV | within ±1% | > 10% above | > 10% below |", "|---|---|---|---|---|---|---|"]
        .concat(rs.map((r) => `| ${r.group} | ${r.n.toLocaleString()} | ${r2(r.ratio.median)} (${r2(r.ratio.p25)}–${r2(r.ratio.p75)}) | ${r2(r.pooled)} | ${pct(r.exact)} | ${pct(r.above)} | ${pct(r.below)} |`))
        .join("\n");
    indexMd.push(
      ``,
      `## 2b. Stated prize value against the Renaiss Index FMV for the same cert (current FMV; pulls since ${stated2.since.slice(0, 10)})`,
      `Pulls with a stated value and a cert: ${stated2.pulls.toLocaleString()}; compared ${stated2.compared.toLocaleString()} (cert not priced in the index: ${stated2.notFound.toLocaleString()}).`,
      st(stated2.overall),
      ``,
      st(stated2.byTier),
      ``,
      st(stated2.byMachine),
      ``,
      `By the card's Index confidence:`,
      st(stated2.byConfidence),
    );
    indexBlock = { stated2, since: new Date(since).toISOString(), sales: recent.length, compared: cmps.length, noLookup, notFound, noFmv, callsThisRun: calls, ...rows };
    const t = (rs: typeof rows.overall) =>
      ["| Group | Sales | Sale ÷ Index FMV, median (IQR) | Σ sale ÷ Σ FMV | > 10% above | > 10% below |", "|---|---|---|---|---|---|"]
        .concat(rs.map((r) => `| ${r.group} | ${r.n.toLocaleString()} | ${r2(r.ratio.median)} (${r2(r.ratio.p25)}–${r2(r.ratio.p75)}) | ${r2(r.pooled)} | ${pct(r.above)} | ${pct(r.below)} |`))
        .join("\n");
    indexMd = [
      ...indexMd,
      ``,
      `## 3. Renaiss marketplace price against the Renaiss Index (FMV on the day before the sale)`,
      `Sales since ${new Date(since).toISOString().slice(0, 10)} with a cert: ${recent.length.toLocaleString()}; compared ${cmps.length.toLocaleString()} (not looked up ${noLookup}, cert not in the index ${notFound}, no FMV in the 7 days before ${noFmv}). Renaiss API calls this run: ${calls}.`,
      t(rows.overall),
      ``,
      `By the card's current Index confidence:`,
      t(rows.byConfidence),
      ``,
      `By sale price:`,
      t(rows.byPrice),
      ``,
      `By grade:`,
      t(rows.byGrade),
      ``,
      `By month:`,
      t(rows.byMonth),
      ``,
      `Median sale ${usd(quantiles(cmps.map((c) => c.price)).median)}; median Index FMV ${usd(quantiles(cmps.map((c) => c.fmv)).median)}.`,
    ];
  }

  const result = { generatedAt: new Date(now).toISOString(), horizonDays: 30, coverage, overall, byTier, byMachine, byMonth, stated, statedTier, statedMachine, statedMonth, recycle, paidVsStated, index: indexBlock };
  writeFileSync(join(OUT, "research.json"), JSON.stringify(result, null, 2));

  const fateRows = (rows: typeof overall) =>
    ["| Group | Pulls | Resold by the puller | Back in a pack | Kept | Median days to resale |", "|---|---|---|---|---|---|"]
      .concat(rows.map((r) => `| ${r.group} | ${r.n.toLocaleString()} | ${pct(r.resold)} | ${pct(r.backInPack)} | ${pct(r.kept)} | ${r.medianDaysToResale == null ? "—" : r.medianDaysToResale.toFixed(1)} |`))
      .join("\n");
  const ratioRows = (rows: typeof stated) =>
    ["| Group | Resold within 30 days | Sale ÷ stated, median (IQR) | Σ sale ÷ Σ stated |", "|---|---|---|---|"]
      .concat(rows.map((r) => `| ${r.group} | ${r.n.toLocaleString()} | ${r2(r.ratio.median)} (${r2(r.ratio.p25)}–${r2(r.ratio.p75)}) | ${r2(r.pooled)} |`))
      .join("\n");
  const md = [
    `# Renaiss research (read ${result.generatedAt})`,
    ``,
    `Coverage: ${coverage.namedPulls.toLocaleString()} named pulls (${coverage.firstNamed.slice(0, 10)} → ${coverage.lastNamed.slice(0, 10)}), ${coverage.withStated.toLocaleString()} with a stated prize value; ${coverage.sales.toLocaleString()} marketplace sales ≥ $1, ${coverage.salesOfPulledTokens.toLocaleString()} of them of a token that came out of a pack.`,
    ``,
    `## 1. The life of a pull (fate 30 days after the pull; pulls at least 30 days old)`,
    fateRows(overall),
    ``,
    `By stated value:`,
    fateRows(byTier.sort((a, b) => VALUE_TIERS.findIndex(([l]) => l === a.group) - VALUE_TIERS.findIndex(([l]) => l === b.group))),
    ``,
    `By month of the pull:`,
    fateRows(byMonth),
    ``,
    `Top machines by pulls:`,
    fateRows(byMachine),
    ``,
    `Recycling: ${recycle.tokens.toLocaleString()} distinct slabs across ${recycle.pulls.toLocaleString()} named pulls; ${pct(recycle.repullShare)} of pulls were a slab already pulled before; most-pulled slab ${recycle.maxPulls}×; days between two pulls of the same slab: median ${r2(recycle.daysBetween.median)} (IQR ${r2(recycle.daysBetween.p25)}–${r2(recycle.daysBetween.p75)}). Pulls per slab: ${JSON.stringify(recycle.byCount)}.`,
    ``,
    `## 2. Stated prize value against the slab's own resale (first marketplace sale within 30 days of the pull)`,
    ratioRows(stated),
    ``,
    ratioRows(statedTier),
    ``,
    `By month of the pull:`,
    ratioRows(statedMonth),
    ``,
    `Machines with ≥ 30 resales:`,
    ratioRows(statedMachine),
    ``,
    `Stated value ÷ price paid per pull: median ${r2(paidVsStated.median)} (IQR ${r2(paidVsStated.p25)}–${r2(paidVsStated.p75)}), n ${paidVsStated.n.toLocaleString()}.`,
    ...indexMd,
    ``,
    `Elapsed ${((Date.now() - t0) / 1000).toFixed(0)}s.`,
  ].join("\n");
  writeFileSync(join(OUT, "research.md"), md);
  console.log(md);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
