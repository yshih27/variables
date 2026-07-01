# Variable — MVP roadmap (overview)

_Last updated 2026-06-30. Orchestrator doc. Worker specs: [backend-now.md](./backend-now.md), [frontend-now.md](./frontend-now.md)._

## North star

**Variable = the index & intelligence terminal for tokenized collectibles.** The dashboard answers one investor question: _"Is this a real market, how does it compare to BTC/ETH/stocks, and what should I be watching?"_

Three pillars, serving three ranked audiences:

1. **Crypto-native investor** (primary) → **Benchmark** (indices vs BTC/ETH/S&P/NASDAQ).
2. **Web2 collector** (on-ramp) → **Discover** (trending cards → card page → buy-links).
3. **Inventory holder / tokenizer** (tertiary) → **Understand** (liquidity proof; mostly framing).

## MVP scope

**In:** 5 pages + a lean card page + 1 hero module.

| Surface | Job |
|---|---|
| Homepage `/` | Market scorecard (vs BTC/S&P) + trending panel + leaderboards |
| Category landing `/ips` | IP-class comparison; **OP vs Pokémon** index |
| Platform landing `/platforms` | Marketplace leaderboard + **by-chain** facet |
| IP deep dive `/ip/[key]` | Full IP analytics + **IP vs market** index |
| Platform deep dive `/platform/[key]` | Full platform analytics; primary vs secondary |
| **Lean card page** `/card/[id]` | Image + facts + grade + **buy-links** (Rarible-first/yellow). Charts deferred. |

**Out (deferred, with reason):**

- Full card page charts / price history — needs card-series backfill (`G`).
- Movers strip, Watchlist — good, but cut to keep MVP lean (revisit post-MVP).
- Per-IP gacha attribution (`F`), real `market` totals row (`C`), stored category entity-type — cleanup/enrichment, nothing blocks on them.
- `avg_trade` is **not** a backend item — it's `volume_usd ÷ trades`, both already in the spine; frontend derives it.

## Sequencing & rationale

Backend leads with the **indices engine** even though it was the user's _#2_ on paper: with the card page deferred, trending shrank to one homepage panel, while indices feed **3 of 5 pages + the scorecard**. The two workers run in parallel — frontend builds chart UIs against _internal_ rebased series immediately and drops in the external benchmark overlay when the engine lands. They converge at the overlay; neither blocks the other.

## Key caveat — index history depth

Two tracks, two depths. The **market-size** track (`mcap_usd`) is forward-only (~2026-06-24 inception) — ~1 week deep and growing; fine if labeled honestly. The **price-return** track is built from the row-level sale panel (CC `7675297` 30d, Courtyard `7845248` full, Beezie `/activity` months), so it has real weeks-to-months of history now, gated by a liquidity floor (thin IPs show "insufficient data"). Depth improves as coverage grows; the **repeat-sales v2** adds rigor + backtest depth on the same panel.

The two are different questions — never plot market-cap against BTC price (mcap moves with *supply*; only the price-return index is a fair comparison).

## Shared contracts (both workers code against these)

```ts
// Indices  (B1 → F2 scorecard, F3 charts) — rebased to 100 at `from`, aligned to `freq`.
// kind:"price" = constant-quality return index (overlay vs BTC/S&P).  kind:"mcap" = market size (vs crypto mcap). Keep them on separate axes.
type IndexPoint = { ts: string; value: number; n?: number; lo?: number; hi?: number };  // n = underlying trades; lo/hi = confidence band (price index)
readIndexSeries(entity: "market" | "category" | "ip", key: string,
  opts: { kind: "price" | "mcap"; from: string; freq?: "weekly" | "daily" }): Promise<IndexPoint[]>;
readBenchmarkSeries(symbol: "BTC" | "ETH" | "SP500" | "NASDAQ", opts: { from: string; freq?: "weekly" | "daily" }): Promise<IndexPoint[]>;  // crypto: CoinGecko; equities: FRED (SP500 + NASDAQCOM)
indexStats(entity: "market" | "category" | "ip", key: string, opts: { from: string }): Promise<{ return30d: number; return90d: number; betaVsBtc: number; corrVsBtc: number }>;

// Buy-links  (B2 → F5 card page)  — ordered, Rarible first when isRarible
type BuyLink = { platform: string; label: string; url: string; isRarible: boolean };
buyLinks(card: { platform: string; chain: string; contract: string; tokenId: string }): BuyLink[];

// Trending  (B3 → F6 homepage panel)
type TrendingCard = {
  cardId: string; href: string; name: string; ip: string; set: string | null; grade: string; platform: string;
  trades: number; tradesPrev: number; momentum: number;        // momentum = trades - tradesPrev
  activeListings: number; huntPressure: number;                // huntPressure = trades / max(activeListings, 1)
  topPriceUsd: number; buyLinks: BuyLink[];
};
getTrendingCards(opts: { window: "24h" | "7d"; limit: number }): Promise<TrendingCard[]>;

// Chain rollup  (B4 → F4 platform landing)  — getChainDetail mirrors getPlatformDetail so <SliceView> consumes it unchanged
readChainSeries(chain: "Solana" | "Base" | "Polygon", metric: string): Promise<SeriesPoint[]>;
getChainDetail(chain: string): Promise<PlatformDetailShape>;

// Taxonomy SSOT  (B5 → F3 category)  — single source in ipCatalog.ts
categoryOf(ipKey: string): "tcg" | "sports" | "other";
```

## Decisions log

- 2026-06-30 — Audience ranked: investor > collector > tokenizer. Deliverable: strategy + worker briefs.
- 2026-06-30 — MVP narrowed to 5 pages; full card page deferred.
- 2026-06-30 — Buy-links live on the card page (not table rows) → pulled a _lean_ card page into MVP to host them.
- 2026-06-30 — Add-ons: Market scorecard **in**; Movers + Watchlist **deferred**.
- 2026-06-30 — Backend sequencing: **indices-first**. "Jupiter" idea dropped.
- 2026-07-01 — Index methodology: split **market-size** (rebased mcap) from **price-return** (constant-quality). v1 price index = **stratified median** (set×grade cells, weekly, confidence bands + liquidity floor) on a **sale-price panel** from row-level feeds. Category roll-up = cap-weighted + divisor; lead at category/market level. Repeat-sales = v2.
- 2026-07-01 — Equity benchmarks via **FRED** (`SP500` + `NASDAQCOM`, free `FRED_API_KEY`) — not Stooq/Yahoo (anti-bot blocked). **S&P 500, not S&P 100.** B1 merges to main with FRED so equities populate on the first cron. F1 SliceView + F2 MarketScorecard (scaffold) shipped. B2 + B4 un-held next (frontend F5/F4 depend on them).
