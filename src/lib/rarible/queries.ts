import { raribleGet, raribleGetBatch } from "./client";
import type {
  RaribleActivitiesResponse,
  RaribleCollection,
  RaribleItemsResponse,
  RaribleOwnershipsResponse,
  RaribleSellActivity,
} from "./types";

export type CollectionId = string;

export async function getCollection(id: CollectionId): Promise<RaribleCollection> {
  return raribleGet<RaribleCollection>(`/collections/${id}`);
}

export type ActivityType = "SELL" | "LIST" | "TRANSFER" | "MINT" | "BURN" | "BID" | "CANCEL_LIST" | "CANCEL_BID";

export type GetActivitiesOpts = {
  collection: CollectionId;
  types: ActivityType[];
  cursor?: string;
  size?: number;
  sort?: "LATEST_FIRST" | "EARLIEST_FIRST";
};

export async function getActivitiesPage(opts: GetActivitiesOpts): Promise<RaribleActivitiesResponse> {
  return raribleGetBatch<RaribleActivitiesResponse>(`/activities/byCollection`, {
    collection: opts.collection,
    type: opts.types,
    cursor: opts.cursor,
    size: opts.size ?? 200,
    sort: opts.sort ?? "LATEST_FIRST",
  });
}

export async function* iterateActivities(
  opts: Omit<GetActivitiesOpts, "cursor">,
  stopAt?: { date: string },
): AsyncGenerator<RaribleActivitiesResponse["activities"][number]> {
  let cursor: string | undefined;
  while (true) {
    const page = await getActivitiesPage({ ...opts, cursor });
    for (const a of page.activities) {
      if (stopAt && a.date < stopAt.date) return;
      yield a;
    }
    if (!page.cursor || page.activities.length === 0) return;
    cursor = page.cursor;
  }
}

export async function getOwnershipsPage(
  collection: CollectionId,
  continuation?: string,
  size = 1000,
): Promise<RaribleOwnershipsResponse> {
  return raribleGet<RaribleOwnershipsResponse>(`/ownerships/byCollection`, {
    collection,
    continuation,
    size,
  });
}

export async function getItemsPage(
  collection: CollectionId,
  continuation?: string,
  size = 200,
): Promise<RaribleItemsResponse> {
  return raribleGet<RaribleItemsResponse>(`/items/byCollection`, {
    collection,
    continuation,
    size,
  });
}

export type CollectionStats = {
  collectionId: CollectionId;
  windowFrom: string;
  windowTo: string;
  salesCount: number;
  volumeUsd: number;
  uniqueBuyers: number;
  uniqueSellers: number;
  avgTradeUsd: number;
};

export type NormalizedSale = {
  date: string;
  tokenId: string;
  buyer: string;
  seller: string;
  priceUsd: number;
};

export async function* iterateSales(
  collection: CollectionId,
  windowMs: number,
): AsyncGenerator<NormalizedSale> {
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  for await (const a of iterateActivities(
    { collection, types: ["SELL"], sort: "LATEST_FIRST" },
    { date: cutoff },
  )) {
    if (a["@type"] !== "SELL") continue;
    const sale = a as RaribleSellActivity;
    if (sale.reverted) continue;
    const usd = parseFloat(sale.amountUsd ?? sale.priceUsd ?? "0");
    if (!Number.isFinite(usd)) continue;
    const nftType = sale.nft.type;
    if (!("tokenId" in nftType)) continue;
    yield {
      date: sale.date,
      tokenId: nftType.tokenId,
      buyer: sale.buyer,
      seller: sale.seller,
      priceUsd: usd,
    };
  }
}

export async function collectSales(
  collection: CollectionId,
  windowMs: number,
): Promise<NormalizedSale[]> {
  const out: NormalizedSale[] = [];
  for await (const sale of iterateSales(collection, windowMs)) out.push(sale);
  return out;
}

export async function computeStatsFromSales(
  collection: CollectionId,
  windowMs: number,
): Promise<CollectionStats> {
  const now = Date.now();
  const windowFrom = new Date(now - windowMs).toISOString();
  const windowTo = new Date(now).toISOString();

  let count = 0;
  let volume = 0;
  const buyers = new Set<string>();
  const sellers = new Set<string>();

  for await (const a of iterateActivities(
    { collection, types: ["SELL"], sort: "LATEST_FIRST" },
    { date: windowFrom },
  )) {
    if (a["@type"] !== "SELL") continue;
    const sale = a as RaribleSellActivity;
    if (sale.reverted) continue;
    const usd = parseFloat(sale.amountUsd ?? sale.priceUsd ?? "0");
    if (!Number.isFinite(usd)) continue;
    volume += usd;
    count += 1;
    buyers.add(sale.buyer);
    sellers.add(sale.seller);
  }

  return {
    collectionId: collection,
    windowFrom,
    windowTo,
    salesCount: count,
    volumeUsd: volume,
    uniqueBuyers: buyers.size,
    uniqueSellers: sellers.size,
    avgTradeUsd: count > 0 ? volume / count : 0,
  };
}

export async function countHolders(collection: CollectionId, maxPages = 50): Promise<{
  cards: number;
  holders: number;
  truncated: boolean;
}> {
  const owners = new Set<string>();
  let total = 0;
  let cont: string | undefined;
  let pages = 0;
  while (pages < maxPages) {
    const page = await getOwnershipsPage(collection, cont, 1000);
    for (const o of page.ownerships) {
      owners.add(o.owner);
      total += 1;
    }
    if (!page.continuation || page.ownerships.length === 0) {
      return { cards: total, holders: owners.size, truncated: false };
    }
    cont = page.continuation;
    pages += 1;
  }
  return { cards: total, holders: owners.size, truncated: true };
}
