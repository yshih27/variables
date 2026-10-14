/**
 * Audit Varible's Renaiss figures against Renaiss's own feed (GET /v1/gacha/pulls),
 * independent of our database. Reads the API only; writes local JSON only.
 *
 *   npx tsx --env-file=.env.local scripts/dev/audit-renaiss-feed.ts --drops=<renaiss-drops.json> --out=<dir>
 *   … --window=2026-10-07,2026-10-14   also recount every machine over [from, to)
 *
 * For each stored drop: re-reads the feed from 30 minutes before its first pull
 * to 2 hours after its last, and counts that product's rows by kind, distinct
 * ids, checkouts and transactions, paid sum and price spread, buyers, and the
 * products selling at the same price in the same hours.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchPullsPage, usdOf, type RenaissPullRow } from "../../src/lib/renaiss/pulls";
import { RENAISS_PAGE_SIZE, renaissCallCount } from "../../src/lib/renaiss/client";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;

type StoredDrop = { productId: string; name: string; priceUsd: number | null; packs: number; firstAt: string; lastAt: string; buyers: number };

/** Every feed row from `fromIso` until a row is pulled at or after `untilIso`. */
async function readFeed(fromIso: string, untilIso: string): Promise<RenaissPullRow[]> {
  const out: RenaissPullRow[] = [];
  let after: string | undefined;
  for (let page = 0; page < 400; page++) {
    const res = await fetchPullsPage(after ? { after, limit: RENAISS_PAGE_SIZE } : { from: fromIso, limit: RENAISS_PAGE_SIZE });
    out.push(...res.rows);
    const last = res.rows[res.rows.length - 1];
    if (!res.hasMore || !res.nextCursor || !last || last.pulledAt >= untilIso) break;
    after = res.nextCursor;
  }
  return out.filter((r) => r.pulledAt >= fromIso && r.pulledAt < untilIso);
}

function tally(rows: RenaissPullRow[]) {
  const checkout = rows.filter((r) => r.kind === "checkout");
  const prices = new Map<number, number>();
  for (const r of checkout) {
    const v = usdOf(r.pricePaid);
    prices.set(v ?? -1, (prices.get(v ?? -1) ?? 0) + 1);
  }
  const perTx = new Map<string, number>();
  for (const r of checkout) if (r.transaction) perTx.set(r.transaction, (perTx.get(r.transaction) ?? 0) + 1);
  const times = rows.map((r) => r.pulledAt).sort();
  return {
    rows: rows.length,
    checkout: checkout.length,
    observed: rows.length - checkout.length,
    distinctIds: new Set(rows.map((r) => r.id)).size,
    distinctCheckoutIds: new Set(checkout.map((r) => r.checkoutId).filter(Boolean)).size,
    distinctTx: perTx.size,
    maxPullsPerTx: Math.max(0, ...perTx.values()),
    paidUsd: checkout.reduce((s, r) => s + (usdOf(r.pricePaid) ?? 0), 0),
    prices: Object.fromEntries([...prices.entries()].sort((a, b) => b[1] - a[1])),
    buyers: new Set(checkout.map((r) => r.buyer?.toLowerCase()).filter(Boolean)).size,
    first: times[0] ?? null,
    last: times[times.length - 1] ?? null,
    names: [...new Set(rows.map((r) => r.machineName).filter(Boolean))],
    prizeValueKnown: rows.filter((r) => usdOf(r.prizeValue) != null).length,
    sampleTx: [...perTx.keys()].slice(0, 5),
  };
}

async function main() {
  const out = arg("out") ?? "audit-renaiss";
  mkdirSync(out, { recursive: true });
  const report: Record<string, unknown> = {};

  const dropsFile = arg("drops");
  if (dropsFile) {
    const drops = (JSON.parse(readFileSync(dropsFile, "utf8")).drops ?? []) as StoredDrop[];
    const rows: unknown[] = [];
    for (const d of drops) {
      const from = new Date(Date.parse(d.firstAt) - 30 * 60_000).toISOString();
      const until = new Date(Date.parse(d.lastAt) + 2 * 3_600_000).toISOString();
      const feed = await readFeed(from, until);
      const mine = tally(feed.filter((r) => r.machineId === d.productId));
      // Other products selling at the drop's price in the same hours: a drop split across ids would show here.
      const samePrice = new Map<string, number>();
      for (const r of feed) {
        if (r.machineId === d.productId || r.kind !== "checkout" || usdOf(r.pricePaid) !== d.priceUsd) continue;
        samePrice.set(r.machineId, (samePrice.get(r.machineId) ?? 0) + 1);
      }
      const row = { drop: `${d.firstAt.slice(0, 10)} ${d.name}`, productId: d.productId, ours: { packs: d.packs, buyers: d.buyers, price: d.priceUsd, first: d.firstAt, last: d.lastAt }, feed: mine, samePriceOtherProducts: Object.fromEntries(samePrice), feedRowsInWindow: feed.length };
      rows.push(row);
      console.log(
        `${row.drop.padEnd(36)} ours ${d.packs} packs/${d.buyers} buyers · feed ${mine.checkout} checkouts (+${mine.observed} observed), ${mine.distinctIds} ids, ${mine.distinctTx} tx (max ${mine.maxPullsPerTx}/tx), $${mine.paidUsd.toLocaleString()} paid, prices ${JSON.stringify(mine.prices)}, ${mine.buyers} buyers, name ${JSON.stringify(mine.names)} · other $${d.priceUsd} products ${JSON.stringify(Object.fromEntries(samePrice))}`,
      );
    }
    report.drops = rows;
  }

  const window = arg("window");
  if (window) {
    const [fromDay, toDay] = window.split(",");
    const feed = await readFeed(`${fromDay}T00:00:00.000Z`, `${toDay}T00:00:00.000Z`);
    const byMachine = new Map<string, RenaissPullRow[]>();
    for (const r of feed) byMachine.set(r.machineId, [...(byMachine.get(r.machineId) ?? []), r]);
    const machines = [...byMachine.entries()]
      .map(([id, rs]) => ({ id, ...tally(rs) }))
      .sort((a, b) => b.paidUsd - a.paidUsd)
      .map((m) => ({ ...m, sampleTx: undefined }));
    report.window = { from: fromDay, to: toDay, rows: feed.length, machines };
    console.log(`\nwindow ${fromDay} → ${toDay}: ${feed.length.toLocaleString()} feed rows`);
    for (const m of machines.slice(0, 15)) {
      console.log(`  ${(m.names[0] ?? m.id).toString().slice(0, 30).padEnd(30)} ${m.checkout} checkouts (+${m.observed} obs) · ${m.distinctIds} ids · $${Math.round(m.paidUsd).toLocaleString()} · prices ${JSON.stringify(m.prices)}`);
    }
  }

  writeFileSync(join(out, "audit.json"), JSON.stringify(report, null, 1));
  console.log(`\n${renaissCallCount()} API calls · wrote ${join(out, "audit.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
