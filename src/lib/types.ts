export type Chain = "Polygon" | "Solana" | "Base" | "Ethereum" | "Abstract";

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
  /** Distinct cards TRADED in the 24h window. 0 for an IP with a market cap but no
   *  24h trades (mcap-only rows) — never the total collection size (D10-2). */
  cards: number;
  /** Total tracked collection size for this IP, from the market-cap rollup — its own
   *  metric, do NOT conflate with `cards` (24h-traded). NaN when unknown. */
  cardsTracked: number;
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
  /** 7-day change (%) in the platform's 24h marketplace volume; null when the
   *  bucket history doesn't reach back a full week. The teaser momentum column. */
  pct7d?: number | null;
  spark: number[];
  trend: Trend;
};

export type HeroStats = {
  totalMcapUsd: number;
  /** Age (hours) of totalMcapUsd when it's the stale last-known fallback; null = live (X4). */
  mcapAgeHours: number | null;
  /** As-of timestamp of the DISPLAYED market cap: the live snapshot's generatedAt,
   *  or the last-known hourly point's timestamp when we fell back. Drives the
   *  overview "as of <date>" stale-guard (>36h) on / and /ips — honest even in the
   *  AF-1 case where the snapshot regenerated fresh-but-empty and we show an older
   *  value. Optional on the wire: snapshots written before this field lack it. */
  mcapAsOf?: string | null;
  mcapPct24h: number | null;
  /** 24h MARKETPLACE resale volume (Σ platform stats24h) + its Σ-based day-over-day
   *  %Δ from the daily spine (null until 2 complete days / base ≤ 0). */
  vol24Usd: number;
  vol24Pct: number | null;
  /** 24h GACHA-pull volume (Σ platform gacha vol24h) + its Σ-based day-over-day %Δ.
   *  Level pairs with `vol24Usd` (marketplace) for the /ips Overview metric column. */
  gachaVol24Usd: number;
  gachaVol24Pct: number | null;
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

// ─── SHELL_V2 contracts ──────────────────────────────────────────────────────
// Frozen contract, same rule as the rest of this file: ADD fields, never rename.
// Shapes match docs/roadmap/brief-backend-shell-v2-feeds.md exactly so the
// backend feeds drop in without a migration.

/**
 * One node of the left-rail taxonomy.
 *
 * `spark` is null — NEVER an array of zeros — when we have no series for this
 * node: a flat line is a claim that nothing moved, which is a different statement
 * from "we don't know". Same rule for `deltaPct`: null renders "—".
 *
 * ⚠️ `deltaPct` is a PERCENT (12.5 = +12.5%), and the MEASURE differs by node
 * kind because the payload carries different deltas for different rows — market
 * cap for the market and the IPs, volume momentum for the platforms. `deltaWindow`
 * is rendered beside the number and `title` names the measure, so an unlabeled
 * percent can never stand on its own.
 */
export type RailNode = {
  key: string;
  name: string;
  /** 2–3 char code for the 56px icon rail. From the naming SSOT (tickerOf, minus
   *  the "V-" prefix) for market/categories/IPs, and PlatformRow.short for
   *  platforms — never hand-written here. */
  short?: string;
  href: string;
  spark: number[] | null;
  deltaPct: number | null;
  deltaWindow: "24h" | "7d";
  /** What the delta measures, for the node's tooltip ("market cap", "volume"). */
  deltaLabel?: string;
};

export type RailModel = {
  market: RailNode;
  categories: (RailNode & { ips: RailNode[] })[];
  platforms: RailNode[];
  generatedAt: string;
};

/**
 * One realized event on the tape (SHELL_V2 S2).
 *
 * REALIZED, not listed — that is the whole point of the component: nobody in the
 * space shows the market actually clearing. A sale is a settlement, a pull is a
 * paid rip, an index mark is a computed close.
 *
 * `valueUsd: null` + `valueText: "—"` is the honest shape for an event whose USD
 * leg we don't have; it is NEVER filled with a zero.
 *
 * Shape matches docs/roadmap/brief-backend-shell-v2-feeds.md exactly, so the
 * backend's `buildTape()` drops into this contract without a migration.
 */
export type TapeItem = {
  /** ISO timestamp of the EVENT, not of the read. Drives the honest "4m ago". */
  ts: string;
  kind: "sale" | "pull" | "index";
  label: string;
  valueUsd: number | null;
  valueText: string;
  platform?: string;
  /** The receipt: /card/[id] for a sale, the platform or /gacha for a pull, /ips for a mark. */
  href: string;
  /** Stable dedupe key across refreshes. */
  id: string;
  /** Percent move, where the event HAS one (an index close). Never synthesised. */
  deltaPct?: number | null;
};
