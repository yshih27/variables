export type Chain = "Polygon" | "Solana" | "Base" | "Ethereum";

export type Trend = "up" | "down" | "flat";

export type IPRow = {
  rank: number;
  key: string;
  name: string;
  short: string;
  color: string;
  /** Path to a brand logo (under /public). Branded IPs only. */
  logo?: string;
  /** CSS mix-blend-mode for the logo (e.g. "screen" to drop dark lines into the dark theme). */
  iconBlendMode?: "normal" | "screen" | "lighten";
  /** Single emoji for sports/streetwear/other. */
  emoji?: string;
  cards: number;
  platforms: number;
  /** Real holder count: unique on-chain owners of any card in this IP.
   *  NaN until `npm run warm-holders` has populated `.cache/holders.json`. */
  holders: number;
  /** Unique buyer wallets active in the 24h window. Always real. */
  buyers24h: number;
  /** Sale count in the 24h window — used for Avg Trade (vol / trades). */
  trades24h: number;
  vol24Usd: number;
  vol7Usd: number;
  volTotalUsd: number;
  mcapUsd: number;
  pct7d: number | null;
  trend: Trend;
  spark: number[];
  topCard: string | null;
  /** Link to the top card's detail page, or null if that platform has no
   *  per-card reader yet (Courtyard). */
  topCardHref?: string | null;
  /** Cheapest active listing across platforms, USD. NaN until warm-marketcap. */
  floorUsd: number;
  /** Sum of insured values for CC tokens in this IP, USD. 0 if N/A. */
  insuredUsd: number;
};

export type PlatformRow = {
  rank: number;
  /** Canonical key from PLATFORM_SOURCES (URL slug). */
  key: string;
  name: string;
  short: string;
  chain: Chain;
  vault: string | null;
  vol24Usd: number;
  vol7Usd: number;
  /** Primary-market revenue (gacha / tokenization), 24h, USD.
   *  Only populated for Courtyard today (MINT × $2 estimate).
   *  null when we don't have a primary contract for that platform. */
  primaryUsd: number | null;
  /** Unique wallets (buyers ∪ sellers) active in 24h. */
  active24h: number;
  /** Unique cards traded in the 24h window. */
  cards: number;
  holders: number;
  avgTradeUsd: number;
  spark: number[];
  trend: Trend;
};

export type HeroStats = {
  totalMcapUsd: number;
  mcapPct24h: number | null;
  vol24Usd: number;
  vol24Pct: number | null;
  vol7Usd: number;
  vol7Pct: number | null;
  totalCards: number;
  ipsTracked: number;
  platformsTracked: number;
  holders: number;
  holdersPct7d: number | null;
  trades24h: number;
  trades24hPct: number | null;
  updatedAt: string;
};

export type HotIP = {
  rank: number;
  key: string;
  name: string;
  short: string;
  color: string;
  logo?: string;
  iconBlendMode?: "normal" | "screen" | "lighten";
  emoji?: string;
  vol24Usd: number;
  buyers24h: number;
  spark: number[];
  trend: Trend;
};

export type TopSale = {
  cardName: string;
  ipName: string;
  ipKey: string;
  ipShort: string;
  ipColor: string;
  ipLogo?: string;
  ipIconBlendMode?: "normal" | "screen" | "lighten";
  ipEmoji?: string;
  priceUsd: number;
  image: string | null;
  imageFallback: string | null;
  platform: string;
  tokenId: string;
  date: string;
};

export type HomepagePayload = {
  hero: HeroStats;
  hotIPs: HotIP[];
  topSales: TopSale[];
  ips: IPRow[];
  platforms: PlatformRow[];
};
