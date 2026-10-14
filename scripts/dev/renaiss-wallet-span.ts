/** How far back our Renaiss wallet history reaches: the earliest and latest first pull in renaiss_wallet_spend. Read-only. */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readWalletSpend } from "../../src/lib/renaiss/players";

async function main() {
  const { rows } = await readWalletSpend();
  const firsts = rows.map((w) => w.first_pull).filter(Boolean).sort();
  const byMonth = new Map<string, number>();
  for (const f of firsts) byMonth.set(f.slice(0, 7), (byMonth.get(f.slice(0, 7)) ?? 0) + 1);
  console.log(`wallets ${rows.length.toLocaleString()} · earliest first pull ${firsts[0]} · latest ${firsts[firsts.length - 1]}`);
  console.log("new wallets by month:", JSON.stringify(Object.fromEntries(byMonth)));
}
main().catch((e) => { console.error(e); process.exit(1); });
