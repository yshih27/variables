/**
 * Price-index warmer — builds the sale-price panel, computes the MONTHLY identity-
 * comparables index (v4) per IP, builds category + market indices over POOLED
 * identities, measures the selection premium, and stores it all in the
 * `price-index` snapshot blob.
 *
 *   npx tsx --env-file=.env.local scripts/warm-sale-panel.ts
 *   npx tsx --env-file=.env.local scripts/warm-sale-panel.ts --out=/tmp/blob   # LOCAL: write
 *       <out>/price-index.json instead of Postgres, for gating / rendering a
 *       rebuilt blob without touching production (readSnapshot honours
 *       SNAPSHOT_LOCAL_DIR=<out>).
 *
 * WHAT IS IN THE BLOB, AND WHY EVERY SURFACE READS IT RATHER THAN TYPING ANYTHING:
 *   series[entity]           month-END-stamped IndexPoints, n = identities in the
 *                            step, lo/hi = bootstrap band, spansWeeks on gaps.
 *   cadence                  "monthly".
 *   biasTests.invariance     the holding-period test for V-MKT (INV-12).
 *   biasTests.entities[e]    selectionPremiumPP (the disclosed resale skew), the
 *                            market-cap anchor over the series' span, and
 *                            heldReason="selection-premium" when the skew is past
 *                            the hard limit — readIndexSeries then withholds it.
 *
 * The v2 token repeat-sales and weekly identity builders stay exported from their
 * modules for comparison only; nothing here calls them.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { buildSalePanel, type SaleRow } from "../src/lib/data/salePanel";
import { identityIndex, MIN_IDENTITIES_BROAD, MIN_IDENTITIES_IP } from "../src/lib/data/identityIndex";
import type { IndexPoint } from "../src/lib/data/indices";
import { ipsInCategory, type IPCategory } from "../src/lib/data/ipCatalog";
import { writeSnapshot } from "../src/lib/db/snapshots";
import { holdingPeriodInvariance, INDEX_HARD_SKEW_PP } from "../src/lib/data/biasTests";
import { readMetricSeries } from "../src/lib/data/metricSnapshots";
import { runWarmer } from "../src/lib/db/runWarmer";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1] ?? null;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type EntityMeta = {
  selectionPremiumPP: number | null;
  heldReason: "selection-premium" | null;
  anchorPct: number | null;
  anchorSince: string | null;
};

/**
 * The market-cap anchor: tracked cap change over the SAME span as the series,
 * from the spine. Market/category sum their members' IP series. Null when either
 * end is missing — the receipt then simply omits the clause.
 */
async function capAnchor(entity: string, key: string, series: IndexPoint[]): Promise<{ pct: number | null; since: string | null }> {
  if (series.length < 2) return { pct: null, since: null };
  const ips =
    entity === "ip" ? [key] : entity === "category" ? ipsInCategory(key as IPCategory) : ipsInCategory("tcg").concat(ipsInCategory("sports"));
  const perDay = new Map<string, number>();
  for (const ip of ips) {
    for (const p of await readMetricSeries("ip", ip, "mcap_usd")) {
      if (!(p.value > 0)) continue;
      const d = p.ts.slice(0, 10);
      perDay.set(d, (perDay.get(d) ?? 0) + p.value);
    }
  }
  const days = [...perDay.keys()].sort();
  if (!days.length) return { pct: null, since: null };
  const startMs = Date.parse(series[0].ts), endMs = Date.parse(series[series.length - 1].ts);
  // First cap reading on/after the base month-end, last on/before the latest one.
  const a = days.find((d) => Date.parse(d) >= startMs) ?? days[0];
  const b = [...days].reverse().find((d) => Date.parse(d) <= endMs) ?? days[days.length - 1];
  const va = perDay.get(a)!, vb = perDay.get(b)!;
  return { pct: va > 0 ? (vb / va - 1) * 100 : null, since: MON[new Date(a).getUTCMonth()] };
}

async function main() {
  const panel = await buildSalePanel();

  // Group sales by IP (skip "other" — no publishable single-IP index).
  const byIp = new Map<string, SaleRow[]>();
  for (const r of panel) {
    if (r.ip === "other") continue;
    const a = byIp.get(r.ip);
    if (a) a.push(r);
    else byIp.set(r.ip, [r]);
  }

  const series: Record<string, IndexPoint[]> = {};
  const salesOf: Record<string, SaleRow[]> = {};
  const gated: string[] = [];
  for (const [ip, sales] of byIp) {
    const idx = identityIndex(sales, { minIdentities: MIN_IDENTITIES_IP, grain: "month" });
    if (idx.length) { series[`ip:${ip}`] = idx; salesOf[`ip:${ip}`] = sales; }
    else gated.push(`${ip}(${sales.length})`); // too few priced identities — publish nothing
  }

  // Categories + market: POOLED identities, same estimator, broader floor.
  for (const cat of ["tcg", "sports", "other"] as IPCategory[]) {
    const members = new Set(ipsInCategory(cat));
    const pooled = panel.filter((r) => members.has(r.ip));
    const idx = identityIndex(pooled, { minIdentities: MIN_IDENTITIES_BROAD, grain: "month" });
    if (idx.length) { series[`category:${cat}`] = idx; salesOf[`category:${cat}`] = pooled; }
  }
  const mktSales = panel.filter((r) => r.ip !== "other");
  const market = identityIndex(mktSales, { minIdentities: MIN_IDENTITIES_BROAD, grain: "month" });
  if (market.length) { series["market:total"] = market; salesOf["market:total"] = mktSales; }

  // INV-12 input + the disclosure receipt, per entity. The invariance spread IS
  // the "resale skew" every surface prints; past the hard limit the entity is
  // auto-held here and withheld by the reader.
  const invariance = holdingPeriodInvariance(mktSales, { grain: "month" });
  const entities: Record<string, EntityMeta> = {};
  for (const id of Object.keys(series)) {
    const [entity, key] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
    const inv = holdingPeriodInvariance(salesOf[id], { grain: "month" });
    const skew = Number.isFinite(inv.spreadPP) ? inv.spreadPP : null;
    const anchor = await capAnchor(entity, key, series[id]);
    entities[id] = {
      selectionPremiumPP: skew,
      heldReason: skew != null && skew > INDEX_HARD_SKEW_PP ? "selection-premium" : null,
      anchorPct: anchor.pct,
      anchorSince: anchor.since,
    };
  }
  console.log(
    `  V-MKT holding-period invariance: ${invariance.buckets.map((b) => `${b.label}=${b.perWeekPct.toFixed(2)}%/mo(n=${b.n})`).join(" ")} ` +
      `· spread ${invariance.spreadPP.toFixed(2)}pp · ${invariance.spreadPP > INDEX_HARD_SKEW_PP ? "AUTO-HELD" : invariance.pass ? "pass" : "disclosed"}`,
  );
  for (const [id, m] of Object.entries(entities)) {
    console.log(`  ${id.padEnd(20)} skew ${m.selectionPremiumPP == null ? "—" : m.selectionPremiumPP.toFixed(2) + "pp"} · cap anchor ${m.anchorPct == null ? "—" : (m.anchorPct >= 0 ? "+" : "") + m.anchorPct.toFixed(1) + "%"} since ${m.anchorSince ?? "—"}${m.heldReason ? " · HELD " + m.heldReason : ""}`);
  }

  const now = new Date().toISOString();
  const blob = { generatedAt: now, cadence: "monthly" as const, series, biasTests: { invariance, entities } };
  if (OUT_DIR) {
    mkdirSync(OUT_DIR, { recursive: true });
    const file = join(OUT_DIR, "price-index.json");
    writeFileSync(file, JSON.stringify(blob));
    console.log(`  wrote LOCAL blob → ${file} (production untouched)`);
  } else {
    await writeSnapshot("price-index", blob, now);
  }

  const published = Object.keys(series);
  console.log(
    `Wrote price-index: ${published.length} series from ${panel.length} panel sales · ` +
      `published: ${published.join(", ") || "none"} · gated(thin): ${gated.join(", ") || "none"}`,
  );
  return { rowsWritten: published.length };
}

runWarmer("price-index", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
