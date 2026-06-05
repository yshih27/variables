import { dasCall, enhancedGet, type DasAsset, type DasGroupResponse, type EnhancedTransaction } from "./client";
import type { NormalizedSale } from "@/lib/rarible/queries";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// ─────────────────────────── DAS / collection ────────────────────────────

/**
 * Iterate every NFT in a verified Solana collection, paginated.
 */
export async function* iterateCollectionAssets(
  collectionAddress: string,
  pageSize = 1000,
): AsyncGenerator<DasAsset> {
  let page = 1;
  while (true) {
    const r = await dasCall<DasGroupResponse>("searchAssets", {
      grouping: ["collection", collectionAddress],
      page,
      limit: pageSize,
    });
    for (const asset of r.items) yield asset;
    if (r.items.length < pageSize) return;
    page += 1;
  }
}

export async function getAsset(id: string): Promise<DasAsset> {
  return dasCall<DasAsset>("getAsset", { id });
}

// ─────────────────────────── Enhanced TX / activity ────────────────────────────

export async function getProgramTransactionsPage(
  address: string,
  opts: { before?: string; until?: string; limit?: number } = {},
): Promise<EnhancedTransaction[]> {
  return enhancedGet<EnhancedTransaction[]>(`/addresses/${address}/transactions`, {
    limit: opts.limit ?? 100,
    before: opts.before,
    until: opts.until,
  });
}

/**
 * Page through all marketplace-program transactions until `cutoff` (Unix s).
 * The Helius cursor for older results is the signature of the oldest
 * returned tx (pass it as `before`).
 */
export async function* iterateProgramTransactions(
  address: string,
  cutoffUnix: number,
  pageSize = 100,
): AsyncGenerator<EnhancedTransaction> {
  let before: string | undefined;
  while (true) {
    const page = await getProgramTransactionsPage(address, { before, limit: pageSize });
    if (page.length === 0) return;
    for (const tx of page) {
      if (tx.timestamp < cutoffUnix) return;
      yield tx;
    }
    before = page[page.length - 1].signature;
    // Safety: if Helius returns less than pageSize, no more pages.
    if (page.length < pageSize) return;
  }
}

// ─────────────────────────── Sale parser ────────────────────────────

/**
 * Heuristic CC marketplace sale parser.
 * A sale is a tx with both:
 *   1. ≥1 USDC token transfer (mint = USDC_MINT)
 *   2. ≥1 non-USDC NFT transfer (mint != USDC, amount = 1)
 * The buyer is the receiver of the NFT; the seller is the sender.
 * The price is the sum of all USDC transfers in the tx.
 *
 * Returns null when the tx isn't a sale (listing, cancel, escrow move, etc).
 */
export function parseCCMarketplaceSale(tx: EnhancedTransaction): NormalizedSale | null {
  if (tx.transactionError) return null;
  const usdc = tx.tokenTransfers.filter((t) => t.mint === USDC_MINT);
  const nft = tx.tokenTransfers.filter((t) => t.mint !== USDC_MINT && t.tokenAmount === 1);
  if (usdc.length === 0 || nft.length === 0) return null;
  const priceUsd = usdc.reduce((s, t) => s + (t.tokenAmount ?? 0), 0);
  if (priceUsd <= 0) return null;
  const card = nft[0]; // primary NFT — the card being sold
  if (!card.toUserAccount || !card.fromUserAccount) return null;
  return {
    date: new Date(tx.timestamp * 1000).toISOString(),
    tokenId: card.mint,
    buyer: card.toUserAccount,
    seller: card.fromUserAccount,
    priceUsd,
  };
}

/**
 * Collect all CC marketplace sales over a window.
 */
export async function collectCCSales(
  programAddress: string,
  windowMs: number,
): Promise<NormalizedSale[]> {
  const cutoff = Math.floor((Date.now() - windowMs) / 1000);
  const sales: NormalizedSale[] = [];
  for await (const tx of iterateProgramTransactions(programAddress, cutoff)) {
    const sale = parseCCMarketplaceSale(tx);
    if (sale) sales.push(sale);
  }
  return sales;
}
