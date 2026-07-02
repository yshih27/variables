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
  /** Market-cap % change over 1d / 30d from the spine (leaderboard Δ columns).
   *  Percent units (e.g. -6.95). null when the spine lacks that much history. */
  pct1d?: number | null;
  pct30d?: number | null;
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
  /** Primary-market revenue (gacha pulls + tokenization mints), 24h, USD.
   *  null when we don't track a primary source for that platform. */
  primaryUsd: number | null;
  /** Gacha-only volume (pack-pull spend), USD. null for platforms with no gacha
   *  source. Courtyard's aggregate pack volume counts here as of R5.
   *  Pairs with vol24Usd/vol7Usd (marketplace resale) for the volume split. */
  gachaVol24Usd: number | null;
  gachaVol7Usd: number | null;
  /** Total 24h activity = marketplace resale + primary (gacha or tokenization), USD.
   *  The honest "how big is this platform" metric; the table's default sort. */
  total24Usd: number;
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
  /** Age (hours) of totalMcapUsd when it's the stale last-known fallback; null = live (X4). */
  mcapAgeHours: number | null;
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
  /** Recent industry market-cap series (oldest→newest) for the homepage card. */
  mcapSpark: number[];
  /** Total hourly volume over the last 24h (oldest→newest) for the homepage card. */
  volSpark: number[];
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
