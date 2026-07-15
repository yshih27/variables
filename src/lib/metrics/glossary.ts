/**
 * The ONE metrics glossary (R5-3) — every metric's plain-language definition,
 * surfaced through <MetricInfo> ⓘ affordances on table headers, KPIs and chart
 * legends. Keeping the definitions here (not inline `title=` strings scattered
 * across components) means one place to keep them honest, and each links to the
 * relevant /methodology section for the full formula.
 */
export type MetricDef = {
  /** Display term in the tooltip heading. */
  term: string;
  /** One- or two-sentence plain-language definition. */
  text: string;
  /** Methodology anchor (defaults to /methodology). */
  href?: string;
};

export const METHODOLOGY = "/methodology";

export const METRICS = {
  marketCap: {
    term: "Market cap",
    text: "Sum of the insured / appraised value of every tracked card on the platform — a stock, not a flow. Tracked for Beezie & Collector Crypt only.",
  },
  volume24h: {
    term: "24h volume",
    text: "USD value of secondary-market (resale) sales in the last 24 hours.",
  },
  volume7d: {
    term: "7d volume",
    text: "USD value of secondary-market sales over the trailing 7 days.",
  },
  momentum7d: {
    term: "Δ 7d",
    text: "Momentum: this platform's trailing-7-day total activity (marketplace + gacha) vs the prior 7 days. '—' until about two weeks of history exist.",
  },
  marketplace: {
    term: "Marketplace (secondary)",
    text: "Collector↔collector resale — the platform takes a fee. The secondary market, and the clearest exit-liquidity signal.",
  },
  trades: {
    term: "Trades",
    text: "Count of secondary-market sales in the window.",
  },
  avgTrade: {
    term: "Avg trade",
    text: "Volume ÷ trades — the mean sale price in the window.",
  },
  holders: {
    term: "Holders",
    text: "Unique wallets holding at least one tracked card. The homepage total is a cross-platform union (a wallet on two platforms counts once); per-IP counts can overlap — a wallet holding two IPs is counted in both.",
  },
  activeWallets: {
    term: "Active wallets",
    text: "Unique wallets that bought or sold in the window.",
  },
  cardsTraded: {
    term: "Cards traded",
    text: "Distinct card tokens that changed hands in the window.",
  },
  huntPressure: {
    term: "Hunt pressure",
    text: "Trades ÷ active listings — high means many sales chasing few listings. Shown as a multiple only when 2+ copies are listed; otherwise the raw sold / listed counts.",
  },
  momentum: {
    term: "Momentum",
    text: "Change in trade count vs the prior equal-length window. Collector Crypt only for now — the other feeds have no prior window yet.",
  },
  float: {
    term: "Float",
    text: "Active marketplace listings for this card type right now (from the latest listings snapshot).",
  },
  gacha: {
    term: "Gacha (primary)",
    text: "Pack rips — the platform selling packs straight to collectors (primary market, first sale). Realized on-chain spend.",
  },
  directSales: {
    term: "Direct sales",
    text: "Non-gacha first sales — a platform minting or dropping cards directly (e.g. Courtyard tokenization). A primary-market flow, distinct from gacha.",
  },
  primaryOnly: {
    term: "Primary only",
    text: "Coverage note: we ingest this platform's primary market (gacha / mints) but not its secondary trading yet — e.g. Phygitals resale on Tensor / Magic Eden isn't ingested.",
  },
  total24h: {
    term: "Total 24h",
    text: "All 24h activity: marketplace resale + gacha + direct sales. The honest 'how big is this platform' figure.",
  },
  salePrice: {
    term: "Sale price",
    text: "What this card actually SOLD for in the last 24h — a realized on-chain sale, not a listing, bid or appraisal. Taken from the platform's own sale feed and converted to USD at the time of the trade.",
  },
  share: {
    term: "Share",
    text: "This platform's share of total 24h activity across all tracked platforms.",
  },
  marketShare: {
    term: "Market share",
    text: "This platform's share of tracked 24h secondary volume.",
  },
  dominance: {
    term: "Dominance",
    text: "Share of the selected metric held by each set / grade / IP right now.",
  },
  priceIndex: {
    term: "Price index",
    text: "Weekly stratified-median of actual sale prices within set×grade cells, trade-weighted — a constant-quality price, not market cap.",
  },
  variableIndex: {
    term: "The Varible Index (the V)",
    text: "The market-wide constant-quality price index — one number for the whole tokenized-card market. Sub-indices per IP and category carry V- tickers (V-MKT is the market, V-PKM Pokémon, V-TCG the TCG category).",
    href: "/methodology#naming",
  },
  vsBenchmarks: {
    term: "vs benchmarks",
    text: "The market price-index return minus a benchmark's (BTC / ETH / S&P 500 / NASDAQ) return over the same window.",
  },
} as const satisfies Record<string, MetricDef>;

export type MetricKey = keyof typeof METRICS;

export function metricDef(key: MetricKey): MetricDef {
  return METRICS[key];
}
