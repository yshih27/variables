# Variable — Proposal & Go-To-Market Strategy (v2)

_Structured slide-by-slide. Each ## = one slide. Numbers as of July 2026 — every figure below is measured by our own live pipeline._

## 1. Title

**REAL CARDS. REAL PRICES. INDEXED.**
The market terminal and price indices for tokenized collectibles.

## 2. The problem

- Real graded trading cards are being vaulted and tokenized, and a genuine on-chain market now trades daily — we measure **millions of dollars in daily activity across 4 marketplaces and 3 chains** today.
- That market trades **blind**: each platform publishes only its own stats, there is no cross-market view, no shared price layer, and no benchmark.
- Every maturing asset class gets a reference index before serious capital arrives — stocks had the S&P, crypto had CoinGecko. Tokenized collectibles have nothing.
- Collectors can't answer "is this market up?"; investors can't compare it to anything; platforms can't prove legitimacy to skeptics.

## 3. The solution

**Variable** — one neutral terminal over the whole category:
- **The indices — "The Variable Index" family ("the V")**: ticker-named, constant-quality price indices — **V-MKT (market-wide), V-TCG (category), V-PKM / V-OP (per IP)** — built from actual on-chain sales: weekly stratified medians within set × grade cells, trade-weighted, wash-filtered, with liquidity floors. Methodology published at /methodology.
- **Benchmarked**: every index charts against BTC, ETH, S&P 500, NASDAQ, and gold on one axis. For the first time, "is tokenized TCG beating the market?" has a data answer. (Currently: **+145% since January, over a period when BTC fell.**)
- **The terminal**: market cap, volume split by type (resale / gacha / direct), trending cards, per-IP and per-platform deep dives, gacha odds & EV, and buy links into every marketplace.

## 4. Live today (traction)

- **145K+ collectibles tracked · ~$58M tracked market cap · ~40K holders · 4 platforms (Collector Crypt, Courtyard, Beezie, Phygitals) · 3 chains (Solana, Base, Polygon)** — effectively full coverage of the known tokenized-card platforms.
- A complete, shipped product: indices + benchmarks, trending, buy-links, gacha analytics, watchlist, search — with a published methodology page and a live per-feed data-status page.
- Hardened operations: health-gated data pipelines, automated freshness monitoring, API-cost circuit breakers.
- Built and shipped to production in **under two months**.

## 5. Why we win

1. **First mover in an empty niche** — nobody has built anything substantial for this market yet. The platforms publish their own stats; no one aggregates, normalizes, or benchmarks the category. We're live today with a working product.
2. **The taxonomy is the product** — generic NFT tools see tokens; we resolve every token to *IP × set × grade × platform*. That structure is what makes indices, comparisons, and cross-platform search possible, and it took the whole build to get right.
3. **Methodology-grade indices** — constant-quality construction (not raw averages), published methodology, honest liquidity gating. The number an analyst can defend and a journalist can cite.
4. **Neutrality + distribution flywheel** — we're not a marketplace; our buy-links send each platform its own buyers. Platforms benefit from us existing, which earns data access and deepens coverage.
5. **Execution speed** — the entire product shipped in weeks. In an empty niche, velocity compounds the first-mover position faster than anyone can respond.

## 6. Competitive map

| Alternative | Gap |
|---|---|
| **The platforms' own stats** (CC, Courtyard…) | Single-platform and self-reported; nobody covers their competitors |
| **Web2 price guides** (TCGPlayer, Card Ladder, PriceCharting) | Off-chain asks and comps; no on-chain settlement data, no holders, no tokenized supply, no gacha economy |
| **NFT analytics** (Dune dashboards, NFTGo, CryptoSlam) | No card taxonomy — can't distinguish a PSA-10 Base Set Charizard from a profile picture; no set/grade structure |

## 7. Audiences (ranked)

1. **Crypto-native investors** — evaluate tokenized collectibles as an asset class (indices, benchmarks, correlation).
2. **Web2 collectors** — discover the on-chain market (trending, search, buy-links, gacha odds).
3. **Inventory holders / tokenizers** — liquidity proof before committing physical inventory.
4. **The platforms** — market intelligence plus the legitimacy halo of a public, neutral index.

## 8. Go-to-market — Phase 1: Credibility (months 0–3)

**Goal: become the number people cite.**
- Ship the weekly **"TCG On-Chain Market Report"**, auto-generated from the index engine: index moves, performance vs benchmarks, top movers, biggest sales. Distributed on X, Substack, and each platform's community channels.
- **Data-driven comparison content**: clear, shareable charts putting collectibles side-by-side with assets people already understand — e.g. "Pokémon vs the S&P 500 this quarter", "One Piece vs BTC since April". Every chart branded and linked.
- Per-card / per-IP **OG share images** so every link pasted into Discord or X renders as a branded stat card.
- Seed distribution through the 4 platforms' own communities — our stats make their platforms look good, so sharing is in their interest.
- KPI: report subscribers, organic citations, returning visitors.

## 9. GTM — Phase 2: Distribution & partnerships (months 2–6)

**Goal: be embedded, not just visited.**
- **Free read API** (`/api/v1/index`, `/trending`, `/platform/*`) with attribution — let bots, dashboards, and platform UIs embed our numbers. The API is the marketing.
- **Platform partnerships**: trade API access for their data feeds (the pitch: "we send you buyers; accurate representation in the category index is worth one read-only feed"). Targets: Phygitals secondary feed, Courtyard catalog, then new platforms from our landscape scan (Grailed, Fanatics Collect, DYLI, Drip).
- **Rarible synergy**: Variable as the category discovery layer; Rarible-first buy links already live.
- Every platform added → truer index → more citations → more platforms want in.
- KPI: API keys issued, platforms integrated, buy-link click-throughs.

## 10. GTM — Phase 3: Monetization (months 6+)

The free terminal stays free (it builds the audience and the citations). Revenue layers on top:
1. **Pro tier** — alerts (price / listing / index moves), portfolio tracking, exports, deeper history.
2. **API licensing** — commercial tier for funds, platforms, and media (rate + SLA).
3. **Index licensing** — the long game: products, lending desks, and insurers settling against Variable indices (the S&P/MSCI model).
4. **Affiliate buy-links** — commission per marketplace conversion (mechanics already live; needs partner terms).

## 11. Roadmap — where this goes

**Now (0–3 months) — deepen the terminal:**
- Slice engine: every chain / set / grade / combination becomes its own drill-down page (one component, infinite coverage; major SEO surface).
- Per-card price history; weekly report; API v1; per-entity share images. _(All four are in build now.)_
- Repeat-sales index v2 — Case-Shiller-grade construction on the same sale data.

**Next (3–9 months) — grow the market covered:**
- Platform expansion: Grailed, Fanatics Collect, DYLI, Drip — each adds coverage, communities, and index credibility.
- Portfolio by wallet (paste an address, see your collection valued and tracked) and alerts — the retention loop.

**Horizon (9–24 months) — the reference price layer for tokenized collectibles:**
- Cards are the beachhead, not the boundary: the same vault-token-index machinery extends to every collectible vertical the platforms tokenize — sneakers, watches, memorabilia, comics.
- The endgame position: when anyone — collector, fund, platform, or journalist — needs the price of a tokenized collectible, the answer comes from Variable. Indices become products of record (licensing, settlement, research).

## 12. Metrics that matter

- North star: **weekly returning users** (terminal habit).
- Credibility: index citations, report subscribers.
- Distribution: API keys, embeds, buy-link click-throughs.
- Coverage: share of tokenized-collectible volume tracked (today: effectively all known card platforms).
- Revenue (post-Phase 3): Pro conversions, API contracts.

## 13. Closing slide

**Every maturing asset class gets a reference index.**
Tokenized collectibles are getting theirs right now — it's built, it's live, and nothing else like it exists.
**VARIABLE. Real cards. Real prices. Indexed.**
