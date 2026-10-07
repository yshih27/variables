/**
 * Renaiss holders and stated market cap — a DRY RUN that measures and prints
 * what warm-holders' Renaiss step would write (src/lib/renaiss/holders.ts).
 * Reads BNB Smart Chain over public RPCs and the two Renaiss stores; writes
 * nothing anywhere except `--out`.
 *
 *   npx tsx scripts/renaiss-holders.ts --limit=20          # the probe: 20 multicalls (10 tokenByIndex + 10 ownerOf, 300 each)
 *   npx tsx scripts/renaiss-holders.ts                     # every live token
 *   npx tsx scripts/renaiss-holders.ts --out=<dir>         # also <dir>/renaiss-holdings.json
 *   npx tsx scripts/renaiss-holders.ts --pull-pages=50     # cap the named-pulls read (a probe of the probe)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readLiveTokens, readOperatedWallets, readPulledTokens, readSoldTokenIps, readSoldTokens, summarizeHoldings, walletActivity, RENAISS_HOLDINGS_SNAPSHOT_KEY } from "../src/lib/renaiss/holders";

const argv = process.argv.slice(2);
const val = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? null;
const LIMIT = val("limit") ? Number(val("limit")) : Infinity;
const PULL_PAGES = val("pull-pages") ? Number(val("pull-pages")) : Infinity;
const OUT = val("out");
/** `--by=pull` reads named pulls on the primary key (no index needed; slow); default `token` uses the new partial index. */
const BY = (val("by") ?? "token") as "token" | "pull";
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

async function main(): Promise<number> {
  const t0 = Date.now();
  const operated = await readOperatedWallets();
  console.log(`Renaiss holders — DRY RUN${Number.isFinite(LIMIT) ? ` · probe of ${LIMIT} multicalls` : " · every live token"}`);
  console.log(`  wallets the contract names (${((Date.now() - t0) / 1000).toFixed(1)}s):`);
  for (const [a, roles] of operated) console.log(`    ${a}  ${roles.join(", ")}`);

  const live = await readLiveTokens({ maxMulticalls: Number.isFinite(LIMIT) ? Math.ceil(LIMIT / 2) : Infinity });
  const per = live.multicalls ? live.ms / live.multicalls : NaN;
  console.log(
    `  chain: totalSupply ${live.totalSupply.toLocaleString()} · ${live.owners.size.toLocaleString()} tokens read in ${live.multicalls} multicalls ` +
      `(300 tokens per call; ${live.calls} RPC requests, every chunk raced across 3 endpoints) · ${(live.ms / 1000).toFixed(1)}s · ` +
      `${per.toFixed(0)} ms per multicall, chunks in parallel · unanswered ${live.unanswered}`,
  );
  if (Number.isFinite(LIMIT)) {
    const full = Math.ceil(live.totalSupply / 300) * 2;
    console.log(`  projection: ${full} multicalls for all ${live.totalSupply.toLocaleString()} live tokens (tokenByIndex + ownerOf) ≈ ${((full * per) / 1000).toFixed(0)}s if run one after another; in parallel chunks, about this probe's wall time per batch`);
  }

  const tp = Date.now();
  const pulled = await readPulledTokens({ maxPages: PULL_PAGES, by: BY });
  const sold = await readSoldTokens();
  console.log(`  stores: ${pulled.tokens.size.toLocaleString()} tokens named by a pull (${pulled.pages} keyset pages, ${(pulled.ms / 1000).toFixed(1)}s) · ${sold.size.toLocaleString()} sold tokens · ${((Date.now() - tp) / 1000).toFixed(1)}s`);
  const ipOfSold = await readSoldTokenIps([...sold]);
  const complete = !Number.isFinite(LIMIT) && Number.isFinite(PULL_PAGES) === false;

  const { summary } = summarizeHoldings({ live, operated, pulled: pulled.tokens, sold, ipOfSold, complete });
  console.log(`\n  holders ${summary.holders.toLocaleString()} (distinct owners outside Renaiss's wallets) · ${summary.tokensHeld.toLocaleString()} tokens held · ${summary.liveTokens.toLocaleString()} live`);
  console.log(`  top owners by count:`);
  for (const o of summary.topOwners) {
    const act = await walletActivity(o.address).catch(() => null);
    console.log(
      `    ${o.address}  ${o.tokens.toLocaleString().padStart(6)}  ${o.operated ? `EXCLUDED (${o.roles.join(", ") || "zero/burn"})` : "holder"}` +
        `${act ? ` · ${act.packPulls.toLocaleString()} pack pulls as buyer · ${act.marketplaceBuys} marketplace buys · ${act.marketplaceSells} sells` : ""}`,
    );
  }
  console.log(`  excluded wallets: ${summary.excluded.map((e) => `${e.address} (${e.roles.join(", ")}) ${e.tokens.toLocaleString()}`).join(" · ")}`);
  console.log(
    `  universe ${summary.universe.toLocaleString()} tokens pulled or sold · burned (likely redeemed) ${Number.isFinite(summary.burnedLikelyRedeemed) ? summary.burnedLikelyRedeemed.toLocaleString() : "— (capped probe: not every live token was read)"} · ` +
      `live tokens no pull or sale names ${summary.liveOutsideUniverse.toLocaleString()}`,
  );
  const s = summary.stated;
  console.log(
    `  stated market cap ${usd(s.mcapUsd)} on ${s.valued.toLocaleString()} of ${s.held.toLocaleString()} held tokens = coverage ${s.coveragePct.toFixed(1)}% → ${s.publishable ? "PUBLISHABLE (≥ 80%)" : "WITHHELD (< 80%)"}`,
  );
  for (const [ip, r] of Object.entries(summary.byIp).sort((a, b) => b[1].tokens - a[1].tokens)) {
    console.log(`    ${ip.padEnd(12)} ${r.holders.toLocaleString().padStart(6)} holders · ${r.tokens.toLocaleString().padStart(6)} tokens · ${usd(r.mcapUsd)} on ${r.valued.toLocaleString()} valued`);
  }
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${RENAISS_HOLDINGS_SNAPSHOT_KEY}.json`), JSON.stringify(summary, null, 2));
    console.log(`  wrote LOCAL ${join(OUT, `${RENAISS_HOLDINGS_SNAPSHOT_KEY}.json`)}`);
  }
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s in all`);
  return 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
