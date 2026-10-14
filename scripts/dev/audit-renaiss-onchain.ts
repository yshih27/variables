/**
 * Spot-check Renaiss drop checkouts on BNB Chain: for a random sample of a
 * drop's checkout transactions (from Renaiss's feed), read each receipt from a
 * public BSC RPC and sum the USDT (BEP-20) transfers the buyer sent. Reads the
 * feed and a public RPC only; writes nothing.
 *
 *   npx tsx --env-file=.env.local scripts/dev/audit-renaiss-onchain.ts <productId> <firstAtIso> <lastAtIso> [sample=10]
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { fetchPullsPage, usdOf, type RenaissPullRow } from "../../src/lib/renaiss/pulls";
import { RENAISS_PAGE_SIZE } from "../../src/lib/renaiss/client";

const RPC = "https://bsc-dataseed.bnbchain.org";
const USDT = "0x55d398326f99059ff775485246999027b3197955";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function rpc(method: string, params: unknown[]) {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

async function main() {
  const [productId, firstAt, lastAt, n = "10"] = process.argv.slice(2);
  const from = new Date(Date.parse(firstAt) - 60_000).toISOString();
  const until = new Date(Date.parse(lastAt) + 60_000).toISOString();
  const rows: RenaissPullRow[] = [];
  let after: string | undefined;
  for (let i = 0; i < 50; i++) {
    const page = await fetchPullsPage(after ? { after, limit: RENAISS_PAGE_SIZE } : { from, limit: RENAISS_PAGE_SIZE });
    rows.push(...page.rows);
    const last = page.rows[page.rows.length - 1];
    if (!page.hasMore || !page.nextCursor || !last || last.pulledAt >= until) break;
    after = page.nextCursor;
  }
  const checkouts = rows.filter((r) => r.machineId === productId && r.kind === "checkout" && r.transaction);
  const sample = [...checkouts].sort(() => Math.random() - 0.5).slice(0, Number(n));
  let ok = 0;
  for (const r of sample) {
    const rc = (await rpc("eth_getTransactionReceipt", [r.transaction])) as { status: string; from: string; logs: { address: string; topics: string[]; data: string }[] } | null;
    if (!rc) { console.log(`${r.transaction} · no receipt`); continue; }
    const usdt = rc.logs.filter((l) => l.address.toLowerCase() === USDT && l.topics[0] === TRANSFER);
    const fromBuyer = usdt.filter((l) => ("0x" + l.topics[1].slice(26)).toLowerCase() === (r.buyer ?? "").toLowerCase());
    const sent = fromBuyer.reduce((s, l) => s + Number(BigInt(l.data)) / 1e18, 0);
    const to = [...new Set(fromBuyer.map((l) => "0x" + l.topics[2].slice(26)))];
    const match = rc.status === "0x1" && Math.abs(sent - (usdOf(r.pricePaid) ?? 0)) < 0.01;
    if (match) ok++;
    console.log(`${(r.transaction ?? "").slice(0, 12)}… status ${rc.status} · buyer sent ${sent} USDT to ${to.map((a) => a.slice(0, 10) + "…").join(",") || "—"} · feed says $${usdOf(r.pricePaid)} · ${match ? "MATCH" : "MISMATCH"}`);
  }
  console.log(`\n${productId.slice(0, 20)}… ${checkouts.length} checkouts in the feed · on-chain sample ${ok}/${sample.length} match`);
}
main().catch((e) => { console.error(e); process.exit(1); });
