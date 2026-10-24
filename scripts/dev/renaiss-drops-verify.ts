/**
 * Recount one drop's behaviour figures from Renaiss's own feed (GET
 * /v1/gacha/pulls), independent of our database: paying wallets in the drop's
 * week, and the drop's buyers with no paid pull in the 30 days before it.
 * Reads the API only; prints counts, never a wallet.
 *
 *   npx tsx --env-file=.env.local scripts/dev/renaiss-drops-verify.ts --product=<id> --first=<iso>
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { fetchPullsPage, usdOf, type RenaissPullRow } from "../../src/lib/renaiss/pulls";
import { RENAISS_PAGE_SIZE, renaissCallCount } from "../../src/lib/renaiss/client";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
const DAY = 86_400_000;

/** Every feed row pulled in [fromIso, untilIso). */
async function readFeed(fromIso: string, untilIso: string): Promise<RenaissPullRow[]> {
  const out: RenaissPullRow[] = [];
  let after: string | undefined;
  for (let page = 0; page < 2000; page++) {
    const res = await fetchPullsPage(after ? { after, limit: RENAISS_PAGE_SIZE } : { from: fromIso, limit: RENAISS_PAGE_SIZE });
    out.push(...res.rows);
    const last = res.rows[res.rows.length - 1];
    if (!res.hasMore || !res.nextCursor || !last || last.pulledAt >= untilIso) break;
    after = res.nextCursor;
  }
  return out.filter((r) => r.pulledAt >= fromIso && r.pulledAt < untilIso);
}

const paidWallets = (rows: RenaissPullRow[]) =>
  new Set(rows.filter((r) => r.kind === "checkout" && (usdOf(r.pricePaid) ?? 0) > 0 && r.buyer).map((r) => r.buyer!.toLowerCase()));

async function main() {
  const product = arg("product")!;
  const first = Date.parse(arg("first")!);
  const iso = (ms: number) => new Date(ms).toISOString();
  const prior = await readFeed(iso(first - 30 * DAY), iso(first));
  const week = await readFeed(iso(first), iso(first + 7 * DAY));
  const buyers = paidWallets(week.filter((r) => r.machineId === product));
  const priorSet = paidWallets(prior);
  const away = [...buyers].filter((w) => !priorSet.has(w)).length;
  console.log(`feed: prior 30d ${prior.length.toLocaleString()} rows, week ${week.length.toLocaleString()} rows`);
  console.log(`drop buyers ${buyers.size} · week paying wallets ${paidWallets(week).size} · buyers with no paid pull in the prior 30 days ${away}`);
  console.log(`${renaissCallCount()} API calls`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
