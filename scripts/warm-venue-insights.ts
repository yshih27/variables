/**
 * Venue insights → the `venue-insights` snapshot (src/lib/data/venueInsights.ts):
 * every venue's share and rank of all pack spend per complete month, from the
 * spine's `gacha_volume_usd`, and what each venue's buyers paid against the same
 * card sold on another venue in the same month, from the index's sale panel.
 * Runs in the core batch right after warm-sale-panel, so the comparison reads
 * the panel that run just built.
 *
 *   npx tsx --env-file=.env.local scripts/warm-venue-insights.ts           # DRY RUN: prints, writes nothing
 *   npx tsx --env-file=.env.local scripts/warm-venue-insights.ts --apply   # writes the snapshot
 *   npx tsx --env-file=.env.local scripts/warm-venue-insights.ts --out=<dir> # LOCAL: <dir>/venue-insights.json (SNAPSHOT_LOCAL_DIR)
 *
 * Two reads, no API call, no Dune.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readMetricSeriesBulk } from "../src/lib/data/metricSnapshots";
import { readSalePanel } from "../src/lib/data/salePanel";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildVenueInsights, writeVenueInsights, VENUE_INSIGHTS_SNAPSHOT_KEY } from "../src/lib/data/venueInsights";
import { runWarmer } from "../src/lib/db/runWarmer";

const APPLY = process.argv.includes("--apply");
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? null;
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}%`);

async function main() {
  const [gacha, panel] = await Promise.all([readMetricSeriesBulk("platform", "gacha_volume_usd"), readSalePanel()]);
  if (!panel?.rows?.length) throw new Error("no sale panel to compare against");
  const insights = buildVenueInsights(
    gacha,
    panel.rows.map((r) => ({ identity: r.identity, platform: r.platform, ts: r.ts, priceUsd: r.priceUsd })),
    Date.now(),
  );

  const { market } = insights;
  const last = market.months.length - 1;
  console.log(`Market position · ${market.months[0]} → ${market.months[last]} · ${market.venueCounts[last]} venues · $${Math.round(market.totalsUsd[last]).toLocaleString()} pack spend in ${market.months[last]}`);
  for (const [venue, v] of Object.entries(market.venues).sort((a, b) => (a[1].rank[last] ?? 99) - (b[1].rank[last] ?? 99))) {
    console.log(`  ${venue.padEnd(16)} #${v.rank[last] ?? "—"} · ${pct(v.sharePct[last])} · $${Math.round(v.spendUsd[last]).toLocaleString()}`);
  }
  for (const [venue, g] of Object.entries(insights.sameCard)) {
    console.log(`Same card · ${venue} · ${g.months[0]} → ${g.months[g.months.length - 1]} · ${g.sharedIdentities} of ${g.identities} identities also sold elsewhere`);
    const line = (label: string, x: { n: number; medianRatio: number; higherPct: number; lowerPct: number } | null) =>
      x ? `  ${label.padEnd(22)} n=${x.n} · ${x.medianRatio.toFixed(2)}× · higher ${x.higherPct.toFixed(0)}% · lower ${x.lowerPct.toFixed(0)}%` : `  ${label.padEnd(22)} under the floor`;
    console.log(line("all", g.all));
    for (const l of g.byLanguage) console.log(line(l.language, l));
    for (const o of g.byVenue) console.log(line(`vs ${o.venue}`, o));
  }

  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${VENUE_INSIGHTS_SNAPSHOT_KEY}.json`), JSON.stringify(insights));
    console.log(`\nwrote ${join(OUT, `${VENUE_INSIGHTS_SNAPSHOT_KEY}.json`)} (local, for SNAPSHOT_LOCAL_DIR)`);
    return { rowsWritten: 0 };
  }
  if (!APPLY) {
    console.log("\nDry run: nothing written. Pass --apply to write.");
    return { rowsWritten: 0 };
  }
  await writeVenueInsights(insights);
  console.log("\nwrote venue-insights");
  return { rowsWritten: 1 };
}

(APPLY ? runWarmer("venue-insights", main) : main()).catch((e) => {
  console.error(e);
  process.exit(1);
});
