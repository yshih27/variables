/**
 * Re-derive DYLI's lane volumes for a window from DYLI's own /sales API, with
 * the same lane rules the warmer uses (classifyDyliLane), independent of our
 * database. Read-only.
 *
 *   npx tsx --env-file=.env.local scripts/dev/audit-dyli-volume.ts 2026-09-13 2026-10-13
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { fetchSalesPage } from "../../src/lib/dyli/sales";
import { classifyDyliLane } from "../../src/lib/dyli/lanes";

async function main() {
  const [fromDay, toDay] = process.argv.slice(2);
  const fromIso = `${fromDay}T00:00:00.000Z`;
  const toIso = `${toDay}T00:00:00.000Z`;
  const lanes = new Map<string, { usd: number; n: number }>();
  const months = new Map<string, Map<string, number>>();
  let rows = 0;
  for (let page = 1; page <= 400; page++) {
    const res = await fetchSalesPage({ page, createdAfter: fromIso, createdBefore: toIso });
    for (const r of res.rows) {
      if (r.sold_at < fromIso || r.sold_at >= toIso) continue;
      rows++;
      const lane = classifyDyliLane(r).lane;
      const usd = Number(r.price_usd) || 0;
      const l = lanes.get(lane) ?? { usd: 0, n: 0 };
      l.usd += usd;
      l.n += 1;
      lanes.set(lane, l);
    }
    if (!res.hasMore || res.rows.length === 0) break;
  }
  const m = lanes.get("marketplace")?.usd ?? 0;
  const g = lanes.get("gacha")?.usd ?? 0;
  console.log(`DYLI /sales ${fromDay} → ${toDay} (sold_at): ${rows.toLocaleString()} rows`);
  for (const [lane, v] of lanes) console.log(`  ${lane.padEnd(12)} ${v.n.toLocaleString()} sales · $${Math.round(v.usd).toLocaleString()}`);
  console.log(`  marketplace ÷ (marketplace + boxes) = ${((100 * m) / (m + g)).toFixed(1)}%`);
  void months;
}
main().catch((e) => { console.error(e); process.exit(1); });
