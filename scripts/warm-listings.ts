/**
 * Paginate Rarible's active sell orders, normalize to USD, write the cheapest
 * active price per token to .cache/listings.json.
 *
 *   npx tsx scripts/warm-listings.ts
 *   npx tsx scripts/warm-listings.ts --max-orders=50000  # tighter cap for Courtyard
 *
 * Notes:
 *   - Processes Beezie first (smaller universe, fastest to a useful snapshot)
 *   - Writes the cache file after each platform finishes — partial progress
 *     is never lost
 *   - Filters out listings < MIN_PRICE_USD as dust
 *   - Caps each platform at MAX_ORDERS to keep runtime bounded; Courtyard
 *     alone can exceed 750K active orders
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { raribleGet } from "../src/lib/rarible/client";
import { toUsd } from "../src/lib/data/prices";
import {
  readListings,
  writeListings,
  type ListingEntry,
} from "../src/lib/data/listings";
import { PLATFORM_SOURCES, type PlatformSource } from "../src/lib/data/sources";
import { fetchPhygitalsListings } from "../src/lib/phygitals/client";
import { fetchCCListingsPage } from "../src/lib/cc/marketplace";
import { runWarmer } from "../src/lib/db/runWarmer";

const MIN_PRICE_USD = 1.0;
const argMax = process.argv.find((a) => a.startsWith("--max-orders="));
const MAX_ORDERS = argMax ? Number(argMax.split("=")[1]) : 200_000;

type RaribleOrder = {
  id: string;
  platform: string;
  status: string;
  take: { type: { "@type": string; contract?: string }; value: string };
  make: {
    type: { "@type": string; contract?: string; tokenId?: string; collection?: string };
    value: string;
  };
};

type RaribleOrdersPage = { orders: RaribleOrder[]; continuation?: string };

async function* paginate(collectionId: string, capPerPlatform: number): AsyncGenerator<RaribleOrder> {
  let continuation: string | undefined;
  let yielded = 0;
  while (yielded < capPerPlatform) {
    const r = await raribleGet<RaribleOrdersPage>("/orders/all", {
      collection: collectionId,
      status: "ACTIVE",
      size: 1000,
      continuation,
    });
    for (const o of r.orders) {
      yield o;
      yielded += 1;
      if (yielded >= capPerPlatform) return;
    }
    if (!r.continuation || r.orders.length === 0) return;
    continuation = r.continuation;
  }
}

async function warmPlatform(
  source: PlatformSource & { kind: "rarible" },
  out: Map<string, ListingEntry>,
): Promise<{ total: number; priced: number; dust: number; unpriced: number }> {
  const chainHint = source.chain.toLowerCase() as "polygon" | "base" | "ethereum";
  let total = 0;
  let priced = 0;
  let dust = 0;
  let unpriced = 0;
  const t0 = Date.now();

  for await (const order of paginate(source.collectionId, MAX_ORDERS)) {
    total += 1;
    const make = order.make.type;
    const tokenId = make.tokenId;
    if (!tokenId) continue;

    const priceUsd = await toUsd(order.take.value, order.take.type, chainHint);
    if (priceUsd == null) {
      unpriced += 1;
      continue;
    }
    if (priceUsd < MIN_PRICE_USD) {
      dust += 1;
      continue;
    }
    priced += 1;

    const itemId = `${source.collectionId}:${tokenId}`;
    const existing = out.get(itemId);
    if (!existing || priceUsd < existing.priceUsd) {
      out.set(itemId, { itemId, priceUsd, platform: source.key, source: order.platform });
    }

    if (total % 5000 === 0) {
      console.log(
        `  ${source.name}: ${total} scanned · ${priced} priced · ${dust} dust · ${unpriced} unpriced · ${((Date.now() - t0) / 1000).toFixed(0)}s`,
      );
    }
  }
  console.log(
    `  ${source.name}: done. ${total} orders · ${priced} priced · ${dust} dust · ${unpriced} unpriced (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
  );
  return { total, priced, dust, unpriced };
}

/**
 * Phygitals (Solana cNFT) active listings, from api.phygitals.com — which
 * already aggregates Tensor / Magic Eden / native, sorted cheapest-first. Keyed
 * `SOLANA:<mint>` to match the Solana card ids + getCardMarket's lookup. Same
 * cheapest-per-token + dust rules as the Rarible path.
 */
async function warmPhygitals(out: Map<string, ListingEntry>): Promise<number> {
  const ITEMS = 100;
  const MAX_PAGES = 120; // ~12K cap (≈7.4K listed today)
  const t0 = Date.now();
  let scanned = 0;
  let priced = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { listings, total } = await fetchPhygitalsListings(page, ITEMS, {});
    if (listings.length === 0) break;
    for (const l of listings) {
      scanned += 1;
      const mint = l.address;
      if (!mint || l.price == null) continue;
      const priceUsd = Number(l.price) / 1e6; // USDC raw → USD
      if (!Number.isFinite(priceUsd) || priceUsd < MIN_PRICE_USD) continue;
      priced += 1;
      const itemId = `SOLANA:${mint}`;
      const existing = out.get(itemId);
      if (!existing || priceUsd < existing.priceUsd) {
        out.set(itemId, { itemId, priceUsd, platform: "phygitals", source: l.marketplace ?? "PHYGITALS" });
      }
    }
    if (total && page * ITEMS >= total) break;
  }
  console.log(
    `  Phygitals: ${scanned} listed scanned · ${priced} priced (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
  );
  return priced;
}

/**
 * Collector Crypt active listings via api.collectorcrypt.com/marketplace — its
 * own native marketplace (CC cards don't route through Rarible/Tensor/ME). The
 * query returns LISTED cards only, 96/page (API caps page size), price already
 * in whole USD. ~57.8K listed → ~600 pages, paginated sequentially. Keyed
 * SOLANA:<nftAddress>, same cheapest-per-token + dust rules.
 */
async function warmCC(out: Map<string, ListingEntry>): Promise<number> {
  const MAX_PAGES = 700; // safety bound; ~603 today
  const t0 = Date.now();
  let priced = 0;
  let totalPages = MAX_PAGES;
  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page++) {
    let resp: Awaited<ReturnType<typeof fetchCCListingsPage>>;
    try {
      resp = await fetchCCListingsPage(page);
    } catch (e) {
      console.warn(`  CC page ${page}: ${(e as Error).message} — stopping, keeping progress`);
      break;
    }
    if (resp.totalPages > 0) totalPages = resp.totalPages;
    if (resp.cards.length === 0) break;
    for (const c of resp.cards) {
      if (c.priceUsd < MIN_PRICE_USD) continue;
      const itemId = `SOLANA:${c.nftAddress}`;
      const existing = out.get(itemId);
      if (!existing || c.priceUsd < existing.priceUsd) {
        out.set(itemId, { itemId, priceUsd: c.priceUsd, platform: "collector-crypt", source: "COLLECTOR_CRYPT" });
      }
      priced += 1;
    }
    if (page % 100 === 0) {
      console.log(`  CC: ${page}/${totalPages} pages · ${priced} priced (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
  }
  console.log(`  CC: done. ${priced} listings (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  return priced;
}

async function main() {
  // Beezie first (smaller, faster) so we always end up with at least its
  // listings even if Courtyard scan is interrupted.
  const ordered = [...PLATFORM_SOURCES].sort((a, b) => {
    if (a.key === "beezie") return -1;
    if (b.key === "beezie") return 1;
    return 0;
  });

  // Seed from any existing cache so we never regress
  const existing = await readListings();
  const byItem = new Map<string, ListingEntry>(
    existing ? Object.entries(existing.byItem) : [],
  );

  for (const p of ordered) {
    if (p.kind !== "rarible") continue;
    console.log(`→ ${p.name} active listings (${p.collectionId})`);
    try {
      await warmPlatform(p, byItem);
    } catch (err) {
      console.warn(
        `  ${p.name} interrupted: ${(err as Error).message}. Saving partial progress.`,
      );
    }
    // Save after each platform so partial runs are still useful
    await writeListings({ generatedAt: new Date().toISOString(), byItem: Object.fromEntries(byItem) });
    console.log(`  → wrote listings snapshot (${byItem.size} tokens so far)`);
  }
  // ── Phygitals (Solana) — not a Rarible source, fetched separately ──
  console.log(`→ Phygitals active listings (api.phygitals.com)`);
  try {
    const before = byItem.size;
    await warmPhygitals(byItem);
    console.log(`  → +${byItem.size - before} Phygitals tokens (${byItem.size} total)`);
  } catch (err) {
    console.warn(`  Phygitals interrupted: ${(err as Error).message}. Saving partial progress.`);
  }
  await writeListings({ generatedAt: new Date().toISOString(), byItem: Object.fromEntries(byItem) });

  // ── Collector Crypt (Solana) — native marketplace API ──
  console.log(`→ Collector Crypt active listings (api.collectorcrypt.com)`);
  try {
    const before = byItem.size;
    await warmCC(byItem);
    console.log(`  → +${byItem.size - before} CC tokens (${byItem.size} total)`);
  } catch (err) {
    console.warn(`  CC interrupted: ${(err as Error).message}. Saving partial progress.`);
  }
  await writeListings({ generatedAt: new Date().toISOString(), byItem: Object.fromEntries(byItem) });

  console.log(`\nDone. ${byItem.size} tokens have a USD-priced listing.`);
  return { rowsWritten: byItem.size };
}

runWarmer("listings", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
