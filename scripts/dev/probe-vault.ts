/**
 * PROBE — value real wallets end to end, READ-ONLY, and print what it cost.
 *
 *   SNAPSHOT_LOCAL_DIR=<--out dir> npx tsx --env-file=.env.local scripts/dev/probe-vault.ts --pick
 *   SNAPSHOT_LOCAL_DIR=<dir> npx tsx --env-file=.env.local scripts/dev/probe-vault.ts <address> [<address> …] [--recall] [--show-unkeyed]
 *   … probe-vault.ts --busiest                                    # the most frequent buyer per venue
 *   HELIUS_CREDIT_BUDGET=1 … probe-vault.ts <solana address>      # the partial path
 *
 * `--pick` takes the most recent BUYER per venue (who still holds one, on
 * chain) from the secondary-sales store (addresses are public on-chain) — one Solana wallet (Collector Crypt)
 * and one each for Polygon (Courtyard) and Base (Beezie) — and values them.
 *
 * For each address: holdings found, keyed, valued by basis, unvalued by
 * reason, `partial`, Helius credits / DAS pages / Rarible pages spent, cold and
 * warm timings (cold = the first read in this process: panel + index + listings
 * inflate, plus the chain read; warm = the same read again with those memos
 * warm — the chain is read again, because the 10-minute `unstable_cache` lives
 * only inside Next), and the payload size.
 *
 * ⚠️ NEVER WRITES. Beezie tokens with no card row are read with the tokenURI
 * reader directly (`beezieMetadata: "read-only"`), not `getBeezieMetadata`,
 * which would persist them.
 *
 * `--recall` (EVM): measures each index's recall against the chain (below).
 */
import { gzipSync } from "node:zlib";
import { parseWalletAddress, type WalletAddress } from "../../src/lib/vault/address";
import { readVaultValuation, type VaultValuation } from "../../src/lib/data/vault";
import { enumerateHoldings } from "../../src/lib/vault/holdings";
import { heliusCreditsUsed } from "../../src/lib/helius/client";
import { raribleGet, rariblePost } from "../../src/lib/rarible/client";
import { ownersOf } from "../../src/lib/onchain/ownerOf";
import { readSecondarySales } from "../../src/lib/data/secondarySalesCache";
import { PLATFORM_SOURCES } from "../../src/lib/data/sources";

const args = process.argv.slice(2);
const BUSIEST = args.includes("--busiest");
const PICK = args.includes("--pick") || BUSIEST;
const RECALL = args.includes("--recall");
const SHOW_UNKEYED = args.includes("--show-unkeyed");

/**
 * The most recent buyer per venue who STILL HOLDS at least one token there.
 * ⚠️ Measured: the most recent Courtyard buyer held none (bought and moved on
 * within the day), which values nothing and measures nothing; skipped buyers
 * are printed, so the choice is visible.
 */
async function pickBuyers(): Promise<string[]> {
  const out: string[] = [];
  for (const venue of ["collector-crypt", "courtyard", "beezie"]) {
    const sales = await readSecondarySales(venue);
    const recent = [...sales].sort((a, b) => b.date.localeCompare(a.date));
    const norm = (b: unknown) => String(b ?? "").replace(/^[A-Z]+:/, "");
    // --busiest: the buyer with the most purchases in the window (a bigger vault).
    const count = new Map<string, number>();
    for (const s of sales) count.set(norm(s.buyer), (count.get(norm(s.buyer)) ?? 0) + 1);
    const ordered = BUSIEST ? [...count].sort((a, b) => b[1] - a[1]).map(([b]) => b) : recent.map((s) => norm(s.buyer));
    const buyers = [...new Set(ordered)].filter((b) => parseWalletAddress(b) && !out.includes(b));
    let hit: string | null = null;
    for (const b of buyers.slice(0, 10)) {
      const r = await enumerateHoldings(parseWalletAddress(b)!);
      const here = r.holdings.filter((h) => h.platform === venue).length;
      if (here > 0) {
        hit = b;
        break;
      }
      console.log(`  skip ${venue.padEnd(16)} ${b} — holds 0 on ${venue} now`);
    }
    console.log(`  pick ${venue.padEnd(16)} ${hit ?? "— (none of the 10 most recent buyers holds one)"}  (of ${sales.length} sales in the store)`);
    if (hit) out.push(hit);
  }
  return out;
}

/**
 * `--recall`: for each EVM leg, every candidate any index proposes (Rarible
 * search, Rarible byOwner, Blockscout) checked with `ownerOf`; each source's
 * recall is the owned tokens it found over all owned tokens found. This is
 * the measurement behind the per-venue index choice in holdings.ts.
 */
async function blockscoutIds(host: string, addr: string, contract: string): Promise<string[]> {
  const out: string[] = [];
  let next: Record<string, string | number> | null = null;
  for (let pages = 0; pages < 40; pages++) {
    const url = new URL(`https://${host}/api/v2/addresses/${addr}/nft`);
    url.searchParams.set("type", "ERC-721");
    for (const [k, v] of Object.entries(next ?? {})) url.searchParams.set(k, String(v));
    const j = (await (await fetch(url)).json()) as { items: { id: string; token?: { address_hash?: string } }[]; next_page_params?: Record<string, string | number> | null };
    out.push(...j.items.filter((i) => i.token?.address_hash?.toLowerCase() === contract).map((i) => i.id));
    next = j.next_page_params ?? null;
    if (!next) break;
  }
  return out;
}

async function recall(address: string): Promise<string> {
  const lines: string[] = [];
  for (const s of PLATFORM_SOURCES) {
    if (s.kind !== "rarible") continue;
    const [B, contract] = s.collectionId.split(":");
    const owner = `ETHEREUM:${address}`;
    const search = (await rariblePost<{ items?: { tokenId: string }[] }>("/items/search", { size: 1000, filter: { blockchains: [B], owners: [owner], collections: [s.collectionId] } })).items?.map((i) => i.tokenId) ?? [];
    const byOwner: string[] = [];
    let continuation: string | undefined;
    for (let p = 0; p < 12; p++) {
      const r = await raribleGet<{ continuation?: string; items?: { tokenId: string; collection?: string }[] }>("/items/byOwner", { owner, blockchains: B, size: 1000, continuation });
      byOwner.push(...(r.items ?? []).filter((i) => i.collection?.toLowerCase() === s.collectionId.toLowerCase()).map((i) => i.tokenId));
      continuation = r.continuation;
      if (!continuation || (r.items ?? []).length < 1000) break;
    }
    const bs = await blockscoutIds(B === "BASE" ? "base.blockscout.com" : "polygon.blockscout.com", address, contract.toLowerCase());
    const all = [...new Set([...search, ...byOwner, ...bs])];
    const { owners } = await ownersOf(B === "BASE" ? "base" : "polygon", contract, all);
    const truth = new Set(all.filter((id) => owners.get(id) === address));
    const r = (xs: string[]) => `${xs.filter((x) => truth.has(x)).length}/${truth.size} of ${new Set(xs).size} candidates`;
    lines.push(`recall ${s.key}:${B} owned ${truth.size} (unanswered ${all.filter((id) => !owners.has(id)).length}) · Rarible search ${r(search)} · Rarible byOwner ${r(byOwner)} · Blockscout ${r(bs)}`);
  }
  return lines.join("\n      ");
}

function report(label: string, v: VaultValuation, ms: number, credits: number): void {
  const t = v.totals;
  const basis = { reference: 0, "last-sale": 0 };
  for (const h of v.holdings) if (h.value) basis[h.value.basis]++;
  const json = JSON.stringify(v);
  console.log(`    ${label}: ${ms}ms · credits Δ ${credits} · DAS pages ${v.reads.dasPages} · Rarible pages ${v.reads.rariblePages} · Blockscout pages ${v.reads.blockscoutPages} · Beezie tokenURI reads ${v.reads.beezieMetadataReads} · enumeration ${v.reads.ms}ms · resolve ${v.reads.resolveMs}ms · value ${v.reads.valueMs}ms`);
  console.log(`      holdings ${t.holdings} · keyed ${t.keyed} · valued ${t.valued} (reference ${basis.reference}, last sale ${basis["last-sale"]}) · your asks ${v.holdings.filter((h) => h.yourAsk).length}`);
  console.log(`      atValue $${t.atValue.usd.toFixed(2)} (n=${t.atValue.n}) · atReference $${t.atReference.usd.toFixed(2)} (n=${t.atReference.n}) · atFloor $${t.atFloor.usd.toFixed(2)} (n=${t.atFloor.n}) · spread ${t.spread ? `$${t.spread.usd.toFixed(2)} / ${t.spread.pct.toFixed(1)}% (n=${t.spread.n})` : "—"}`);
  console.log(`      unvalued ${t.unvalued.n} ${JSON.stringify(t.unvalued.reasons)} · unkeyed ${JSON.stringify(t.unvalued.unkeyed)}`);
  console.log(`      partial ${v.partial ? JSON.stringify(v.partial) : "none"} · legs ${v.reads.legs.map((l) => `${l.leg.split(":")[0]}:${l.pages}p/${l.holdings}${l.complete ? "" : `/${l.stop}`}${l.dropped ? ` (chain dropped ${l.dropped.burned} burned, ${l.dropped.moved} moved${l.unverified ? `, ${l.unverified} unverified` : ""})` : ""}`).join(" ")}`);
  console.log(`      byVenue ${v.byVenue.map((g) => `${g.label} ${g.holdings}/${g.valued} $${g.usd.toFixed(0)}`).join(" · ")}`);
  console.log(`      payload ${(json.length / 1024).toFixed(1)} KB raw · ${(gzipSync(json).length / 1024).toFixed(1)} KB gz · asOf ${v.asOf}`);
}

async function main() {
  const addrs = PICK ? await pickBuyers() : args.filter((a) => !a.startsWith("--"));
  if (!addrs.length) throw new Error("usage: probe-vault.ts --pick | <address> …");
  for (const a of addrs) {
    const parsed = parseWalletAddress(a) as WalletAddress | null;
    console.log(`\n→ ${a} (${parsed?.chain ?? "INVALID"})`);
    if (!parsed) continue;
    for (const label of ["cold", "warm"]) {
      const c0 = heliusCreditsUsed();
      const t0 = Date.now();
      const v = await readVaultValuation(parsed, { beezieMetadata: "read-only" });
      report(label, v, Date.now() - t0, heliusCreditsUsed() - c0);
      if (SHOW_UNKEYED && label === "cold") {
        for (const h of v.holdings.filter((x) => !x.identity || !x.value).slice(0, 25)) {
          console.log(`        ${h.cardId.slice(0, 18).padEnd(18)} ${String(h.unkeyed ?? h.unvalued).padEnd(22)} ip=${h.ip} grade=${h.grade} set=${h.set} # ${h.number} · ${h.name}`);
        }
      }
    }
    if (RECALL && parsed.chain === "evm") console.log(`      ${await recall(parsed.address)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
