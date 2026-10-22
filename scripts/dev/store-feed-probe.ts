/**
 * What the secondary_sales store holds for one venue over the last N days: row
 * count, first and last sale, and the newest days' counts and volume. Read-only.
 * For checking what a writer will read when it falls back to the store (a venue
 * whose live feed is closed: resaleFeedState.ts).
 *
 *   npx tsx --env-file=.env.local scripts/dev/store-feed-probe.ts beezie 30
 */
import { readStoreFeed, type StorePlatform } from "../../src/lib/data/salesStore";

// tsx runs this repo's scripts as CommonJS, so no top-level await here.
async function main(): Promise<number> {
  const platform = process.argv[2] as StorePlatform | undefined;
  const days = Number(process.argv[3] ?? 30);
  if (!platform || !Number.isFinite(days) || days <= 0) {
    console.error("usage: store-feed-probe.ts <platform> [days]");
    return 2;
  }
  const sales = await readStoreFeed(platform, { sinceMs: Date.now() - days * 86_400_000 });
  const times = sales.map((s) => s.date).filter((d) => Number.isFinite(Date.parse(d))).sort();
  console.log(`${platform}: ${sales.length} stored sales in the last ${days}d · first ${times[0] ?? "—"} · last ${times[times.length - 1] ?? "—"}`);
  const byDay = new Map<string, { n: number; usd: number }>();
  for (const s of sales) {
    const day = s.date.slice(0, 10);
    const a = byDay.get(day) ?? { n: 0, usd: 0 };
    a.n += 1;
    a.usd += s.priceUsd;
    byDay.set(day, a);
  }
  for (const [day, a] of [...byDay.entries()].sort().slice(-6)) console.log(`  ${day}: ${a.n} sales · $${Math.round(a.usd).toLocaleString()}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
