/**
 * Primary-market revenue warmer.
 *
 *   primary_revenue = Σ(USDC inflow to platform's `primary.receivers`
 *                       from senders NOT in `primary.internalExclusions`)
 *
 * Plus optional amount-bucket filter (CC pulls = $25/50/75/80/100/250/1000).
 *
 * Writes the `primary-revenue` Postgres snapshot covering every platform
 * with a `primary` block in PLATFORM_SOURCES.
 *
 *   npx tsx scripts/warm-primary-revenue.ts
 *
 * Run every 6h (core batch, alongside warm-listings / warm-marketcap).
 *
 * Sources used:
 *   EVM (Polygon, Base):  Etherscan v2 unified API
 *                         set ETHERSCAN_API_KEY in .env.local for 5/sec
 *   Solana:               Helius enhanced-tx (uses HELIUS_API_KEY)
 *
 * Notes:
 *   - Receivers / exclusions are case-insensitive (we lowercase both).
 *   - Self-transfers between receivers are dropped automatically by the
 *     internalExclusions rule for CC; for other platforms we additionally
 *     drop sender == any receiver in the same platform's list, so we don't
 *     double-count house moves.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { PLATFORM_SOURCES, type PlatformSource, type PrimaryWalletConfig } from "../src/lib/data/sources";
import { getTokenTransfers } from "../src/lib/etherscan/client";
import { getProgramTransactionsPage } from "../src/lib/helius/queries";
import {
  writePrimaryRevenue,
  type PrimaryPlatformEntry,
  type PrimaryRevenueSnapshot,
} from "../src/lib/data/primaryRevenueCache";
import { runWarmer } from "../src/lib/db/runWarmer";

const DAY_S = 24 * 60 * 60;
const WEEK_S = 7 * DAY_S;

// Chain-id mapping for the Etherscan v2 API.
const CHAIN_IDS: Record<string, number> = {
  Polygon: 137,
  Base: 8453,
  Ethereum: 1,
};

type Bucket = { count: number; vol: number };
type AmountMap = Record<string, Bucket>;

type Tally = {
  vol24: number;
  vol7: number;
  n24: number;
  n7: number;
  /** True iff every receiver's scan crossed the 7d cutoff (i.e. we have a
   *  trustworthy 7d total). Flips to false the moment any receiver hits
   *  the page cap before crossing back 7 days. */
  complete7d: boolean;
  /** Per-amount buckets for the gacha page. Key = amount as integer string. */
  byAmount24h: AmountMap;
  byAmount7d: AmountMap;
};

function newTally(): Tally {
  return {
    vol24: 0,
    vol7: 0,
    n24: 0,
    n7: 0,
    complete7d: true,
    byAmount24h: {},
    byAmount7d: {},
  };
}

function lc(s: string): string {
  return s.toLowerCase();
}

/**
 * Bucket an amount. For platforms with `validAmounts` we use the exact value;
 * otherwise we round to the nearest dollar so we don't end up with thousands
 * of single-occurrence buckets like `$73.4321`.
 */
function bucketKey(amount: number, validAmounts?: Set<number>): string {
  if (validAmounts && validAmounts.has(amount)) return String(amount);
  return String(Math.round(amount));
}

function addToBucket(map: AmountMap, key: string, amount: number): void {
  const b = (map[key] ??= { count: 0, vol: 0 });
  b.count += 1;
  b.vol += amount;
}

function tallyToEntry(t: Tally): PrimaryPlatformEntry {
  return {
    vol24hUsd: t.vol24,
    vol7dUsd: t.complete7d ? t.vol7 : null,
    count24h: t.n24,
    count7d: t.complete7d ? t.n7 : null,
    complete7d: t.complete7d,
    byAmount24h: t.byAmount24h,
    byAmount7d: t.complete7d ? t.byAmount7d : {},
  };
}

/**
 * Walk the qualifying inbound transfers for one platform and tally
 * 24h + 7d volumes. Generic over chain — caller supplies the iterator
 * of `(amountUsd, senderLower, unixTimestamp)` triples, plus a
 * `complete7d` flag indicating whether the underlying scan actually
 * covered the full 7d window for every receiver.
 */
function accumulate(
  iter: Iterable<{ amount: number; sender: string; ts: number }>,
  cutoff24: number,
  cutoff7: number,
  cfg: PrimaryWalletConfig,
  receiversLower: Set<string>,
  exclusionsLower: Set<string>,
  complete7d: boolean,
): Tally {
  const validAmts = cfg.validAmounts && cfg.validAmounts.length > 0 ? new Set(cfg.validAmounts) : undefined;
  const t = newTally();
  t.complete7d = complete7d;
  for (const { amount, sender, ts } of iter) {
    // Filter: drop transfers from exclusion list OR from another receiver
    // in the same platform (house-internal moves).
    if (exclusionsLower.has(sender) || receiversLower.has(sender)) continue;
    if (ts < cutoff7) continue;
    if (validAmts && !validAmts.has(amount)) continue;

    const key = bucketKey(amount, validAmts);
    t.vol7 += amount;
    t.n7 += 1;
    addToBucket(t.byAmount7d, key, amount);
    if (ts >= cutoff24) {
      t.vol24 += amount;
      t.n24 += 1;
      addToBucket(t.byAmount24h, key, amount);
    }
  }
  return t;
}

// ─── EVM (Polygon, Base) ──────────────────────────────────────────────

async function tallyEvm(
  source: PlatformSource,
  cfg: PrimaryWalletConfig,
  nowS: number,
): Promise<Tally> {
  const chainId = CHAIN_IDS[source.chain];
  if (!chainId) throw new Error(`No chain id mapping for ${source.chain}`);

  const cutoff24 = nowS - DAY_S;
  const cutoff7 = nowS - WEEK_S;
  const receiversLower = new Set(cfg.receivers.map(lc));
  const exclusionsLower = new Set(cfg.internalExclusions.map(lc));

  const allTransfers: { amount: number; sender: string; ts: number }[] = [];
  let complete7d = true;
  for (const receiver of cfg.receivers) {
    const PAGE_SIZE = 100;
    const MAX_PAGES = 100; // 10,000 transfers per receiver — high enough for any plausible 7d window
    const txs = await getTokenTransfers({
      chainId,
      address: receiver,
      contractAddress: cfg.currencyAddress,
      sinceUnix: cutoff7,
      pageSize: PAGE_SIZE,
      maxPages: MAX_PAGES,
    });
    // Did we actually cross the 7d cutoff? getTokenTransfers stops either at
    // the cutoff OR at the page cap. If we got back exactly MAX_PAGES * PAGE_SIZE
    // results AND the oldest is still newer than cutoff, we hit the cap.
    const oldestTs = txs.length > 0 ? Number(txs[txs.length - 1].timeStamp) : nowS;
    const hitCap = txs.length >= MAX_PAGES * PAGE_SIZE && oldestTs > cutoff7;
    if (hitCap) complete7d = false;
    const receiverLower = lc(receiver);
    for (const tx of txs) {
      if (lc(tx.to) !== receiverLower) continue; // only inbound to this receiver
      const decimals = Number(tx.tokenDecimal) || cfg.currencyDecimals;
      const amount = Number(tx.value) / 10 ** decimals;
      if (!Number.isFinite(amount) || amount <= 0) continue;
      allTransfers.push({ amount, sender: lc(tx.from), ts: Number(tx.timeStamp) });
    }
    const flag = hitCap ? "  ⚠ hit page cap, 7d undercounted" : "";
    process.stdout.write(`    ${receiver.slice(0, 10)}…  +${txs.length} tx${flag}\n`);
  }
  return accumulate(allTransfers, cutoff24, cutoff7, cfg, receiversLower, exclusionsLower, complete7d);
}

// ─── Solana (Collector Crypt, Phygitals) ──────────────────────────────

async function tallySolana(
  source: PlatformSource,
  cfg: PrimaryWalletConfig,
  nowS: number,
): Promise<Tally> {
  const cutoff24 = nowS - DAY_S;
  const cutoff7 = nowS - WEEK_S;
  const receiversLower = new Set(cfg.receivers.map(lc));
  const exclusionsLower = new Set(cfg.internalExclusions.map(lc));

  const allTransfers: { amount: number; sender: string; ts: number }[] = [];
  let complete7d = true;

  for (const receiver of cfg.receivers) {
    // Walk enhanced-tx pages until we cross the 7d cutoff. Each enhanced tx
    // surfaces all SPL transfers in `tokenTransfers`; we keep ones where
    // the mint matches our currency and `toUserAccount` is this receiver.
    //
    // MAX_PAGES is generous so high-volume wallets (CC's GachaNgyXT can do
    // 100K+ enhanced-tx per week) actually walk back the full 7d window.
    const MAX_PAGES = 1000;
    const PAGE_SIZE = 100;
    let before: string | undefined;
    let pages = 0;
    let received = 0;
    let crossed = false;
    let endOfHistory = false;
    while (pages < MAX_PAGES) {
      const page = await getProgramTransactionsPage(receiver, { before, limit: PAGE_SIZE });
      if (page.length === 0) {
        endOfHistory = true;
        break;
      }
      for (const tx of page) {
        if (tx.timestamp < cutoff7) {
          crossed = true;
          break;
        }
        if (tx.transactionError) continue;
        for (const t of tx.tokenTransfers) {
          if (t.mint !== cfg.currencyAddress) continue;
          if (!t.toUserAccount || lc(t.toUserAccount) !== lc(receiver)) continue;
          if (!t.fromUserAccount) continue;
          const amount = t.tokenAmount; // Helius enhanced amounts are already human-units
          if (!Number.isFinite(amount) || amount <= 0) continue;
          allTransfers.push({
            amount,
            sender: lc(t.fromUserAccount),
            ts: tx.timestamp,
          });
          received += 1;
        }
      }
      if (crossed) break;
      if (page.length < PAGE_SIZE) {
        endOfHistory = true;
        break;
      }
      before = page[page.length - 1].signature;
      pages += 1;
    }
    // We're confident about 7d for this receiver iff we either crossed the
    // cutoff OR ran out of history. Hitting the page cap = undercount.
    const receiverComplete = crossed || endOfHistory;
    if (!receiverComplete) complete7d = false;
    const flag = receiverComplete ? "" : "  ⚠ hit page cap, 7d undercounted";
    process.stdout.write(`    ${receiver.slice(0, 10)}…  +${received} tx (${pages + 1} pages)${flag}\n`);
  }
  return accumulate(allTransfers, cutoff24, cutoff7, cfg, receiversLower, exclusionsLower, complete7d);
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const nowS = Math.floor(Date.now() / 1000);
  const platforms: Record<string, PrimaryPlatformEntry> = {};

  for (const source of PLATFORM_SOURCES) {
    if (!source.primary) {
      console.log(`→ ${source.key}: no primary config, skipping`);
      continue;
    }
    console.log(`→ ${source.key} (${source.chain}): ${source.primary.receivers.length} receivers`);
    const t0 = Date.now();
    try {
      const tally =
        source.chain === "Solana"
          ? await tallySolana(source, source.primary, nowS)
          : await tallyEvm(source, source.primary, nowS);
      platforms[source.key] = tallyToEntry(tally);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `   done in ${dt}s — 24h $${tally.vol24.toFixed(0)} (${tally.n24} tx) · 7d $${tally.vol7.toFixed(0)} (${tally.n7} tx)\n`,
      );
    } catch (err) {
      console.warn(
        `   FAILED for ${source.key}: ${(err as Error).message}\n`,
      );
      // Don't zero out an existing cache entry — leave the prior snapshot
      // alone for that platform by simply skipping it on write.
    }
  }

  const snap: PrimaryRevenueSnapshot = {
    generatedAt: new Date().toISOString(),
    platforms,
  };
  await writePrimaryRevenue(snap);
  console.log(
    `Wrote primary-revenue snapshot — ${Object.keys(platforms).length}/${PLATFORM_SOURCES.length} platforms snapshotted`,
  );
  return { rowsWritten: Object.keys(platforms).length };
}

runWarmer("primary-revenue", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
