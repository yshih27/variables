/**
 * Read Beezie's paged /activity the way the core run (30 days) and the legs
 * index build (~800 days) do, and print what came back. Public API only: no
 * key, no database, no writes.
 *
 *   npx tsx scripts/dev/beezie-activity-probe.ts [days...]
 */
import { fetchBeezieSales } from "../../src/lib/beezie/market";

async function main(): Promise<number> {
  const windows = process.argv.slice(2).map(Number).filter((n) => n > 0);
  for (const days of windows.length ? windows : [30, 800]) {
    const t0 = Date.now();
    const sales = await fetchBeezieSales(days * 86_400_000);
    const ts = sales.map((s) => s.date).sort();
    console.log(`${String(days).padStart(4)} days: ${sales.length.toLocaleString()} sales · ${ts[0] ?? "—"} → ${ts[ts.length - 1] ?? "—"} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
