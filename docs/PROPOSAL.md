# Variable — Proposal & Go-To-Market Strategy

_Structured slide-by-slide. Each ## = one slide (or two). Numbers as of July 2026._

## 1. Title

**Variable — Real cards. Real prices. One index.**
The market terminal and price index for tokenized collectibles.

## 2. The problem

- Billions of dollars of graded trading cards are being vaulted and tokenized — a real, growing on-chain RWA market.
- It trades **blind**: 4+ marketplaces on 3 chains, each publishing only its own conflicted stats. No shared price layer, no cross-market view, no benchmark.
- Every prior asset class needed an index before serious money arrived: stocks → S&P, crypto → CoinGecko. Tokenized collectibles have nothing.
- Collectors can't answer "is this market up?"; investors can't compare it to anything; platforms can't prove legitimacy.

## 3. The solution

**Variable** — one neutral terminal over the whole category:
- **The index**: a constant-quality price index built from actual on-chain sales (weekly stratified medians within set×grade cells, wash-filtered, liquidity floors) — methodology an analyst can defend, published at /methodology.
- **Benchmarked**: charted against BTC, ETH, S&P 500, NASDAQ, gold on one axis. First time the question "is TCG beating the market?" has an answer. (Current answer: **+145% since January, while BTC fell.**)
- **The terminal**: market cap, volume by type (resale/gacha/direct), trending cards by hunt-pressure, per-IP and per-platform deep dives, gacha odds/EV, buy links to every marketplace.

## 4. Live today (traction)

- **138K+ collectibles · ~$58M tracked market cap · ~40K holders · 4 platforms (Collector Crypt, Courtyard, Beezie, Phygitals) · 3 chains (Solana, Base, Polygon)**
- Daily-refreshing proprietary history: per-IP / set / grade / platform metric spine + row-level sale panel — recorded since inception, **not backfillable by a copycat**.
- Full product shipped: index + benchmarks, trending, buy-links, gacha analytics, watchlist, methodology + live data-status pages. Ops hardened (health-gated pipelines, API-cost circuit breakers).

## 5. Why we win (moat)

1. **Data compounds daily** — we keep history nobody else records; every day a copycat starts further behind.
2. **The taxonomy** — NFT tools see tokens; we see *IP × set × grade × platform*. That structure IS the product and took the whole build to get right.
3. **Methodology-grade index** — constant-quality, not vibes; the defensible number media and institutions can cite.
4. **Neutrality + distribution flywheel** — we're not a marketplace; our buy-links send platforms their own buyers, so platforms want in (data access), which deepens the moat.
5. **First mover in an index business** — index businesses converge to one winner (S&P, CoinGecko); being the cited number is self-reinforcing.

## 6. Competitive map

| Alternative | Gap |
|---|---|
| Platforms' own stats | Single-platform, conflicted |
| TCGPlayer / Card Ladder / PriceCharting | Off-chain asks; no settlement data, holders, or tokenized supply |
| Dune / NFT analytics | No card taxonomy; can't tell a PSA-10 Charizard from a PFP |
| Naive price averages | Mix-shift broken; our constant-quality method is the fix |

## 7. Audiences (ranked)

1. **Crypto-native investors** — evaluate TCG-RWA as an asset class (index, benchmarks, correlation).
2. **Web2 collectors** — discover the on-chain market (trending, search, buy-links, gacha odds).
3. **Inventory holders / tokenizers** — liquidity proof before committing physical inventory.
4. **The platforms themselves** — market intelligence + the legitimacy halo of a public index.

## 8. Go-to-market — Phase 1: Credibility (months 0–3)

**Goal: become the cited number.**
- Ship the weekly **"TCG On-Chain Market Report"** (auto-generated from the index engine): index move, vs benchmarks, top movers, biggest sales. Distribution: X/Twitter, Substack, Telegram/Discord of each platform community.
- **Provocative comparison content**: "Pokémon vs S&P since April", "One Piece outperformed BTC by 100 points." Every chart watermarked variable.app.
- Per-card/IP **OG share images** so every link pasted into Discord/X is a branded chart.
- Seed with the 4 platforms' communities; get founders to retweet their own platform stats (they look good — free reach).
- KPI: weekly report subscribers, organic citations, returning visitors.

## 9. GTM — Phase 2: Distribution & partnerships (months 2–6)

**Goal: be embedded, not just visited.**
- **Free read API** (`/api/v1/index`, `/trending`, `/platform/*`) with attribution requirement — let bots, dashboards, and platform UIs embed our numbers. The API *is* the marketing.
- **Platform partnerships**: trade read-API access for their data feeds (pitch: "we send you buyers; being under-represented in the category index is the cost of saying no"). Target: Phygitals secondary feed, Courtyard catalog, then new platforms (Grailed, Fanatics Collect, DYLI, Drip from our landscape scan).
- **Rarible synergy**: Variable as the discovery layer; Rarible-first buy links already live.
- Listings/coverage expansion = index credibility expansion (more platforms → truer index → more citations).
- KPI: API keys issued, platforms integrated, buy-link click-throughs.

## 10. GTM — Phase 3: Monetization (months 6+)

Free terminal stays free (it's the moat-builder). Revenue layers on top:
1. **Pro tier** — alerts (price/listing/index moves), portfolio-by-wallet tracking, CSV/API export, deeper history.
2. **API licensing** — commercial tier for funds, platforms, media (rate + SLA).
3. **Index licensing** — the long game: structured products, lending desks, and insurers settling against the Variable index (how S&P/MSCI make money).
4. **Affiliate buy-links** — commission per marketplace conversion (already wired, just needs partner terms).
5. (Optional) sponsored-but-labeled placements for pack drops — only if it never touches index integrity.

## 11. Product roadmap (next 2 quarters)

- **Slice engine** (specced): any chain/set/grade/combination becomes its own drill-down page — infinite SEO surface area from one component.
- **Repeat-sales index v2** — Case-Shiller-grade rigor + deeper backtest.
- **Portfolio by wallet** — paste an address, see your collection valued/tracked (converts viewers to users).
- **Alerts + weekly digest email** (the retention loop).
- **Platform expansion** — Grailed, Fanatics, DYLI, Drip; each adds coverage and communities.
- **Card-page price history** (per-card charts) once the card-series backfill lands.

## 12. Metrics that matter

- North star: **weekly returning users** (terminal habit).
- Credibility: index citations / report subscribers.
- Distribution: API keys, embeds, buy-link CTR.
- Coverage: % of category volume tracked (today ~100% of known tokenized-card platforms).
- Revenue (post-Phase 3): Pro conversions, API contracts.

## 13. Asks

- **Team**: 1 FE + 1 data/BE continuing (current velocity: 8 shipped rounds in ~1 week with AI-agent workflow); fractional design polish.
- **Partnerships**: intros to platform founders for API-for-API trades.
- **Budget**: infra is lean (Vercel + Supabase + paid Helius/Dune tiers ≈ low hundreds/month); content/marketing budget for Phase 1.
- **Decision**: green-light the weekly report + free API (Phase 1/2 unlocks) — both are ~1 sprint each on the existing engine.

## 14. Closing slide

**Every asset class pays its index maker forever.**
Tokenized collectibles are getting their index right now — and it's already built, live, and six months of history ahead of anyone else.
**Variable. Real cards. Real prices. One index.**
