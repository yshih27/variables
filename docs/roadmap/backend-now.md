# Backend — now (MVP track)

_Worker brief. Read [mvp-overview.md](./mvp-overview.md) first — especially "Shared contracts" and the index-history caveat._

**Context files:** [metricSnapshots.ts](../../src/lib/data/metricSnapshots.ts) (`readMetricSeries`/`readMetricSeriesBulk`/`writeMetricSnapshots`), [sources.ts](../../src/lib/data/sources.ts) (platform→chain + contracts), [cards.ts](../../src/lib/data/cards.ts), [prices.ts](../../src/lib/data/prices.ts) (CoinGecko already wired), [listings.ts](../../src/lib/data/listings.ts), [ipCatalog.ts](../../src/lib/data/ipCatalog.ts).

Ordered by dependency × value. **B1 is the primary track** (feeds 3 pages + the scorecard); B2–B5 are small unblockers you can interleave.

---

## B1 — Indices engine + external benchmarks  ← START HERE

**Goal:** a constant-quality **price-return index** for IPs / categories / market, plus a separate **market-size** track and traditional-market benchmarks, all on one rebased axis — so the frontend can honestly chart "Pokémon price vs BTC vs S&P."

**Two tracks — keep them distinct (this is the credibility point):**
- **Market size** (`kind:"mcap"`) — rebased `mcap_usd` from the spine. Moves with *supply*, so it is NOT a fair BTC comparison; label it "market size," compare vs total crypto mcap. Forward-only (~2026-06-24 inception). _This is the rebased-mcap work already in flight — it becomes the size track, not wasted._
- **Price return** (`kind:"price"`) — the constant-quality index you overlay on BTC/ETH/S&P.

**Substrate (build first):** a **sale-price panel** — `tokenId × ts × priceUsd × {ip, set, grade}` — from the row-level feeds (CC Dune `7675297` 30d, Courtyard `7845248` full, Beezie `/activity` months, Phygitals sales) joined to [cards.ts](../../src/lib/data/cards.ts). Filter same-wallet/wash trades (you have buyer+seller); winsorize outliers; USD at trade-time via [prices.ts](../../src/lib/data/prices.ts). Every estimator runs on this panel (and it front-loads a slice of the deferred card-series `G`).

**v1 estimator — stratified median** (chosen): partition each IP's sales into `set×grade` cells, index each cell's median over time, weight cells by trade share → constant-quality without a curated basket. **Weekly** frequency. Emit per-point trade count `n` and a **confidence band** (`lo`/`hi`) that widens as `n` falls. **Liquidity floor:** below a min `n`, return "insufficient data" — never publish a fake line.

**Category / market roll-up:** market-cap-weight the constituent IP price indices with a **divisor** so IPs entering/leaving (new tokenizations) don't create jumps — S&P's mechanism. Expose cap-weighted AND equal-weighted. **Lead at category/market level** (more liquidity → publishable now; most single-IP indices are too thin today except Pokémon).

**Benchmarks:** BTC/ETH via CoinGecko `market_chart` (already integrated in [prices.ts](../../src/lib/data/prices.ts) — extend it). **Equities via FRED** (decided 7/1): S&P 500 (`SP500`) + NASDAQ Composite (`NASDAQCOM`), free `FRED_API_KEY`, official + no anti-bot so it won't block Actions; keep Stooq→Yahoo only as an opportunistic fallback. Store closes in a daily snapshot; resample to the index frequency; rebase to the same `from`.

- **Files:** new `src/lib/data/salePanel.ts` (panel builder), `src/lib/data/indices.ts` (`readIndexSeries`, `indexStats`), `src/lib/data/benchmarks.ts` (`readBenchmarkSeries`); warmers `scripts/warm-sale-panel.ts` + `scripts/warm-benchmarks.ts`.
- **Signatures:** see updated Shared contracts in the overview.
- **Acceptance:** `readIndexSeries("category","tcg",{kind:"price"})` returns a weekly rebased series with `n`/`lo`/`hi`, aligned to `readBenchmarkSeries("BTC")`; `indexStats` returns 30/90d return + beta + correlation vs BTC; thin IPs gate to "insufficient data," not a flat line.
- **v2 (fast-follow):** repeat-sales (Case-Shiller) index for Pokémon + the market on the same panel, for real backtest depth.

## B2 — Buy-links resolver  (unblocks the lean card page)

**Goal:** ordered outbound links per card, Rarible-first when the chain is Rarible-indexed.

- **File:** new `src/lib/links/buyLinks.ts`. Contracts/chains already in [sources.ts](../../src/lib/data/sources.ts); per-card `{tokenId, contract, chain, platform}` from [cards.ts](../../src/lib/data/cards.ts).
- **Signature:** `buyLinks(card) → BuyLink[]` (see contract). URL templates for Rarible, Beezie, Collector Crypt, Courtyard, Phygitals. `isRarible` by chain support — no live Rarible lookup per card in v1.
- **Acceptance:** any card across all 4 platforms returns ≥1 link; Rarible first when `isRarible`.

## B3 — getTrendingCards  (unblocks the homepage trending panel — your #1)

**Goal:** rank cards by velocity + scarcity ("trades < hunters").

- **File:** new `src/lib/data/fetchTrending.ts`.
- **Inputs:** `entity_type:"card"` `trades`/`volume_usd`/`active_wallets` from the spine; join [cards.ts](../../src/lib/data/cards.ts) for metadata; join [listings.ts](../../src/lib/data/listings.ts) for active float; attach `buyLinks` (B2).
- **Signature & shape:** `getTrendingCards({window,limit}) → TrendingCard[]` (see contract). `momentum = trades − tradesPrev`; `huntPressure = trades / max(activeListings,1)`.
- **Acceptance:** ranked list sortable by momentum or huntPressure; each row carries `href` to the card page.

## B4 — Chain rollup  (unblocks platform landing facet — your #4)

**Goal:** chain-level series + a platform-shaped detail object so the frontend's `<SliceView>` works for chains unchanged.

- **File:** extend [metricSnapshots.ts](../../src/lib/data/metricSnapshots.ts) + [fetchPlatform.ts](../../src/lib/data/fetchPlatform.ts).
- **Mapping:** Solana = collector-crypt + phygitals; Base = beezie; Polygon = courtyard.
- **Signatures:** `readChainSeries(chain,metric)` (sum member platforms); `getChainDetail(chain)` mirroring `getPlatformDetail`'s return shape.
- **Acceptance:** chain series == sum of member platforms; `getChainDetail` is drop-in for the slice template.

## B5 — Taxonomy SSOT  (category cleanup)

**Goal:** one source of truth for `ipKey → category`, so the category page can't silently misclassify a new IP.

- **File:** [ipCatalog.ts](../../src/lib/data/ipCatalog.ts) — add canonical `category` per IP; export `categoryOf(ipKey)`.
- **Acceptance:** both workers import the same map; an unmapped IP resolves to `"other"` _explicitly_ (log it), never silently.
- **Do NOT:** add a stored `category` entity-type — no history gain (category depth == per-IP depth). Frontend keeps summing per-IP.

---

## Trust / reliability tickets (parallel — verify first, they may be fixed)

- **T1 — Courtyard gacha mislabel.** Courtyard gacha was showing under "Other primary" on the homepage (`kind` should be `gacha`, not `tokenization`). Mislabeled revenue is a credibility leak. Confirm/fix.
- **T2 — `getPlatformDetail` cache >2MB.** `unstable_cache` set silently fails on the oversized payload (page renders uncached/slow). Gzip-wrap or trim, mirroring the listings-snapshot fix.

## Deferred (NOT MVP)

card series `G` · per-IP gacha attribution `F` · real `market` totals row `C` · platform tokenization-primary series · movers data · watchlist.
