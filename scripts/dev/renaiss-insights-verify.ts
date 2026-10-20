/**
 * Independent check for renaiss-insights.ts section 1: from Renaiss's own feed
 * (GET /v1/gacha/pulls), count the wallets with a priced pull in the 30 and the
 * 60 days up to --cutoff, the same definition renaiss_wallet_spend() reads
 * (price above 0, any kind). Compare with the store's "active" and "active or
 * quiet 30–60 days" wallet counts. Reads the API only; prints counts only.
 *
 *   npx tsx --env-file=.env.local scripts/dev/renaiss-insights-verify.ts --cutoff=<newest pull ISO>
 *   (about 2 pages of 500 per 1,000 pulls; ~60 days ≈ 250 calls of the 10,000 a day)
 */
import { fetchPullsPage, usdOf } from "../../src/lib/renaiss/pulls";
import { RENAISS_PAGE_SIZE, renaissCallCount } from "../../src/lib/renaiss/client";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
const DAY = 86_400_000;

async function main() {
  const cutoffIso = arg("cutoff");
  if (!cutoffIso) throw new Error("pass --cutoff=<ISO>");
  const cutoff = Date.parse(cutoffIso);
  const since = new Date(cutoff - 60 * DAY).toISOString();
  const in30 = new Set<string>();
  const in60 = new Set<string>();
  let after: string | undefined;
  let rows = 0;
  for (;;) {
    const page = await fetchPullsPage(after ? { after, limit: RENAISS_PAGE_SIZE } : { from: since, limit: RENAISS_PAGE_SIZE });
    let past = false;
    for (const p of page.rows) {
      const t = Date.parse(p.pulledAt);
      if (t > cutoff) { past = true; break; }
      rows++;
      const usd = usdOf(p.pricePaid);
      const buyer = typeof p.buyer === "string" ? p.buyer.toLowerCase() : null;
      if (!buyer || !(usd && usd > 0)) continue;
      if (t >= cutoff - 60 * DAY) in60.add(buyer);
      if (t >= cutoff - 30 * DAY) in30.add(buyer);
    }
    if (past || !page.hasMore || !page.nextCursor) break;
    after = page.nextCursor;
    if (renaissCallCount() % 50 === 0) console.log(`  ${renaissCallCount()} calls, ${rows} pulls`);
  }
  console.log(JSON.stringify({ since, cutoff: cutoffIso, pulls: rows, payingWalletsLast30d: in30.size, payingWalletsLast60d: in60.size, calls: renaissCallCount() }));
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
