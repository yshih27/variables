export type RaribleBlockchain = "POLYGON" | "BASE" | "ETHEREUM" | "SOLANA";

export type RaribleCollectionId = `${RaribleBlockchain}:${string}`;

export type RaribleAssetType =
  | { "@type": "ERC721"; contract: string; tokenId: string; collection?: string }
  | { "@type": "ERC1155"; contract: string; tokenId: string; collection?: string }
  | { "@type": "ERC20"; contract: string }
  | { "@type": "ETH" }
  | { "@type": "COLLECTION"; contract: string; collection: string };

export type RaribleAsset = {
  type: RaribleAssetType;
  value: string;
};

export type RaribleSellActivity = {
  "@type": "SELL";
  id: string;
  date: string;
  cursor?: string;
  source?: string;
  transactionHash: string;
  blockchainInfo?: { blockNumber: number; logIndex: number };
  reverted?: boolean;
  nft: RaribleAsset;
  payment: RaribleAsset;
  buyer: string;
  seller: string;
  price?: string;
  priceUsd?: string;
  amountUsd?: string;
};

export type RaribleListActivity = {
  "@type": "LIST";
  id: string;
  date: string;
  cursor?: string;
  hash?: string;
  maker: string;
  make: RaribleAsset;
  take: RaribleAsset;
  price?: string;
  priceUsd?: string;
  source?: string;
};

export type RaribleActivity = RaribleSellActivity | RaribleListActivity | { "@type": string; id: string; date: string };

export type RaribleActivitiesResponse = {
  cursor?: string;
  activities: RaribleActivity[];
};

export type RaribleCollection = {
  id: string;
  blockchain: RaribleBlockchain;
  type: string;
  name: string;
  symbol?: string;
  status: string;
  hasTraits?: boolean;
  meta?: {
    name?: string;
    description?: string;
    content?: Array<{ "@type": string; url: string; width?: number; height?: number }>;
  };
};

export type RaribleOwnership = {
  id: string;
  blockchain: RaribleBlockchain;
  itemId: string;
  contract: string;
  collection: string;
  tokenId: string;
  owner: string;
  value: string;
};

export type RaribleOwnershipsResponse = {
  continuation?: string;
  ownerships: RaribleOwnership[];
};

export type RaribleItem = {
  id: string;
  blockchain: RaribleBlockchain;
  collection: string;
  contract: string;
  tokenId: string;
  ownerIfSingle?: string;
  mintedAt?: string;
  supply: string;
  deleted: boolean;
  meta?: {
    name?: string;
    description?: string;
    attributes?: Array<{ key: string; value?: string; type?: string }>;
    content?: Array<{ "@type": string; url: string; mimeType?: string }>;
  };
  lastSale?: {
    date: string;
    seller: string;
    buyer: string;
    value: string;
    price: string;
    currency: { "@type": string; contract?: string };
  };
};

export type RaribleItemsResponse = {
  continuation?: string;
  items: RaribleItem[];
};
