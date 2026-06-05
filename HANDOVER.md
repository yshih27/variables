# TCG.market — Handover

A CoinGecko-style analytics dashboard for tokenized phygital trading cards.
Tracks Beezie (Base), Courtyard (Polygon), and Collector Crypt (Solana).

Project root: `/Users/workstation/Documents/AI created dashboards/tcg-market/`

---

## Quick start

```bash
cd "/Users/workstation/Documents/AI created dashboards/tcg-market"
npm run dev
# open http://localhost:3000
```

Env file `.env.local` already contains:
- `RARIBLE_API_KEY=...`
- `HELIUS_API_KEY=...`

---

## What ships today

### Routes
| URL | Purpose |
|---|---|
| `/` | Homepage — Hero stats, Hot IPs panel, Top Sales panel, IP table (Top 10), Platform table |
| `/ips` | Full IP / Categories list (no row cap) |
| `/platforms` | Full platform list |
| `/ip/[key]` | IP detail page — hero stats, volume chart, Sets / Grades / Top Cards tables (capped at 10) |
| `/ip/[key]/sets` | Full sets table for an IP |
| `/ip/[key]/grades` | Full grade-buckets table for an IP |
| `/ip/[key]/cards` | Full top-cards table for an IP |
| `/platform/[key]` | Platform detail page — hero stats, volume chart, Top IPs on platform, Top Cards, Recent Sales (capped at 10) |

`[key]` slugs:
- IPs: `pokemon`, `one_piece`, `yugioh`, `basketball`, `baseball`, `football`, `soccer`, `hockey`, `f1`, `sneakers`, `wax`, `magic`, `dragon_ball`, `lorcana`, `comics`, `veefriends`, `other`
- Platforms: `beezie`, `courtyard`, `collector-crypt`

### Nav
Currently only **Categories** (→ `/ips`) and **Platforms** (→ `/platforms`). The TCG.market logo routes home. Connect Wallet button removed. Search UI is rendered but not wired — that's the next chunk of work.

### Top Sales card behavior
- Slab placeholder SVG always renders behind the photo (z-index 0).
- Actual card photo overlaid with `position: absolute, opacity: 0` until `onLoad` fires; on error it never fades in, so the slab silhouette stays visible. `alt=""` prevents broken-image fallback text.
- Image fallback chain: primary URL → `imageFallback` URL → SlabPlaceholder.
- Meta block is locked to `h-[110px]`: 34px title + 16px IP/platform row + price anchored bottom via `mt-auto`. Every card aligns regardless of card name length.

### IP icons
- Logos: `/public/ip-logos/{pokemon,one-piece,yugioh}.png`.
- Pokemon + One Piece are pixel art → `image-rendering: pixelated` is auto-applied.
- Pokemon also gets `mix-blend-mode: screen` (drops black outline pixels into the dark theme) and `transform: scale(1.35)` (asset has more transparent padding than One Piece, so it needed enlargement).
- Auto-detection lives in `src/components/IPIcon.tsx`, keyed by logo path. To add per-IP icon tweaks, prefer the `iconBlendMode` field in `src/lib/data/ipCatalog.ts` over hardcoding paths in IPIcon.

---

## Data architecture

No relational DB. Everything is disk-cached under `.cache/` and read by Server Components wrapped in `unstable_cache(1h)`.

### Caches

```
.cache/
├── beezie-traits/{tokenId}.json    immutable per token; warm-traits.ts
├── cc-traits/{mint}.json            immutable per token; warm-cc-traits.ts
├── cc-sales-24h.json                 warm-cc-sales.ts (every 5–10 min)
├── courtyard-primary.json            warm-courtyard-primary.ts (hourly)
├── history/{platform}.json           backfill-history.ts (every 4–6 h)
├── holders.json                      warm-holders.ts (daily)
├── listings.json                     warm-listings.ts (hourly)
├── marketcap.json                    warm-marketcap.ts (after warm-listings)
└── marketcap-history.json            append-only hourly snapshots
```

### Warmers — what they do, how to run

| Script | Source | Output | Cadence |
|---|---|---|---|
| `npm run warm-traits` | Beezie tokenURI on Base RPC → `images.beezie.com` metadata | `.cache/beezie-traits/*` | Hourly |
| `npm run warm-cc-traits` | Helius DAS `searchAssets` for CC collection | `.cache/cc-traits/*` (~120K) | Daily |
| `npm run warm-cc-sales` | Helius Enhanced TX, USDC+NFT transfer pattern | `.cache/cc-sales-24h.json` | Every 5–10 min |
| `npm run warm-courtyard-primary` | Rarible activity, counts MINTs × `$2` est fee | `.cache/courtyard-primary.json` | Hourly |
| `npm run backfill-history` | Rarible + Helius — 7d sales bucketed hourly | `.cache/history/*.json` | Every 4–6 h |
| `npm run warm-holders` | Rarible ownerships (Beezie) + DAS (CC) | `.cache/holders.json` | Daily |
| `npm run warm-listings` | Rarible `/orders/all` w/ USD conversion (CoinGecko spot) | `.cache/listings.json` | Hourly |
| `npm run warm-marketcap` | Joins listings + traits + insured values | `.cache/marketcap.json` + history | Hourly (after warm-listings) |

### Server Component data flow

```
fetchHomepage()
└── getPlatformBuckets()         [unstable_cache 1h]
    ├── beezie:    Rarible /activities/byCollection SELL
    ├── courtyard: Rarible /activities/byCollection SELL
    └── cc:        .cache/cc-sales-24h.json (fallback to Helius live)
└── readHolders()                 .cache/holders.json
└── readMarketCap()                .cache/marketcap.json
    → buildAggregateIPRows()      Beezie + CC sales + trait caches → per-IP grouping
    → buildTopSales()              top 5 sales by price + metadata lookup
    → hot IPs (top 3 by 24h vol)
    → platform rows
    → hero aggregates
```

`fetchIP(key)` and `getPlatformDetail(key)` follow the same shape, pivoted by IP or platform.

### Market Cap methodology
- Beezie + Courtyard tokens: per-token value = cheapest active USD listing from `.cache/listings.json` (raw `take.value` × CoinGecko spot price for the currency).
- CC tokens: per-token value = `Insured Value` trait (vault appraisal).
- Floor per IP = min per-token value within the IP.
- Mcap per IP = sum of per-token values.
- Spam filter: drops listings outside `[$1, $5M]` per token.

---

## Key source files

```
src/
├── app/
│   ├── page.tsx                    Homepage
│   ├── ips/page.tsx                Full IP list
│   ├── platforms/page.tsx          Full platform list
│   ├── ip/[key]/page.tsx           IP detail
│   ├── ip/[key]/{sets,grades,cards}/page.tsx
│   ├── platform/[key]/page.tsx     Platform detail
│   └── layout.tsx
│
├── components/
│   ├── NavBar.tsx                  Categories / Platforms / logo home
│   ├── Hero.tsx                    Homepage hero stats
│   ├── HotIPsPanel.tsx             Top 3 by 24h vol
│   ├── TopSalesPanel.tsx           Top 5 cards (slab placeholder + img overlay)
│   ├── IPIcon.tsx                  Logo / emoji / shortcode renderer
│   ├── IPTable.tsx                 Homepage IP table (10-row cap + See all)
│   ├── PlatformTable.tsx           Homepage platform table
│   ├── IPDetailHero.tsx
│   ├── IPVolumeChart.tsx
│   ├── IPTraitTables.tsx           Sets / Grades / TopCards
│   ├── PlatformDetailHero.tsx
│   ├── PlatformTables.tsx          PlatformIPs / TopCards / RecentSales
│   ├── Sparkline.tsx
│   └── ChainFilter.tsx
│
├── lib/
│   ├── data/
│   │   ├── sources.ts              PLATFORM_SOURCES — verified contracts
│   │   ├── ipCatalog.ts            IP_CATALOG — name / color / logo / patterns / emoji / iconBlendMode
│   │   ├── buckets.ts              getPlatformBuckets() — 24h sales per platform
│   │   ├── fetchHomepage.ts        Homepage payload builder
│   │   ├── fetchIP.ts              IP-detail payload builder
│   │   ├── fetchPlatform.ts        Platform-detail payload builder
│   │   ├── beezieTraits.ts         Beezie trait cache R/W
│   │   ├── ccTraits.ts             CC trait cache R/W
│   │   ├── ccSalesCache.ts         CC sales snapshot R/W
│   │   ├── courtyardPrimaryCache.ts
│   │   ├── holders.ts              holders.json R/W
│   │   ├── listings.ts             listings.json R/W
│   │   ├── marketcap.ts            marketcap.json R/W + history append
│   │   ├── history.ts              per-platform hourly buckets
│   │   ├── prices.ts               CoinGecko spot oracle (cached per script)
│   │   └── traits.ts               normalizeTraits / gradeLabel
│   ├── rarible/{client,queries,types}.ts
│   ├── helius/{client,queries}.ts
│   ├── onchain/tokenUri.ts         Direct ERC-721 tokenURI() reads
│   ├── format.ts                   formatCompactUsd / formatPct / formatInt
│   └── types.ts                    Shared TS types (IPRow / PlatformRow / TopSale / etc)
│
└── scripts/
    ├── warm-traits.ts
    ├── warm-cc-traits.ts
    ├── warm-cc-sales.ts
    ├── warm-courtyard-primary.ts
    ├── warm-holders.ts
    ├── warm-listings.ts
    ├── warm-marketcap.ts
    └── backfill-history.ts
```

---

## Verified data realities

- **Courtyard** (Polygon, `0x251be3a17af4892035c37ebf5890f4a4d889dcad`):
  - Secondary volume via Rarible is *real* but thin (~$100 / 24h).
  - The bulk of activity is `MINT` (tokenization) and `BURN` (redemption).
  - Primary revenue is **off-chain** (Stripe). We expose an *estimate* = MINT count × $2 in `warm-courtyard-primary`.
  - We don't cache Courtyard traits, so per-card and per-IP breakdowns are limited there.

- **Beezie** (Base, `0xbb5ec6fd4b61723bd45c399840f1d868840ca16f`):
  - ~$800K–$1M / 24h secondary via OpenSea.
  - Metadata is reachable directly via tokenURI → `https://api.beezie.com/dropItems/metadata/{id}` (no auth, occasional Cloudflare 429s → retry/backoff already in place).
  - Beezie has many spam contracts in Rarible search; the one above is the canonical address.
  - Buyer/seller skew: many days have ~2 unique buyers (likely a market-making contract sweeping listings — see "buyback concentration" callout on IP detail).

- **Collector Crypt** (Solana, collection `CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf`, marketplace program `CcmRKTuZCGJBWQwMHvDYApBRvSZNHqGJXkznqpDTSQUr`):
  - All CC API endpoints (per docs.collectorcrypt.com) are *write-only* transaction builders. Zero public read.
  - We index Solana directly via Helius:
    - DAS `searchAssets` for the collection → traits + holders.
    - Enhanced TX for the marketplace program → sales (heuristic: NFT transfer + USDC transfer in same tx).
  - **CC listings are not yet indexed** (would require parsing LIST instructions from the marketplace program — same pattern as the sale parser).

---

## Open work (handover priority)

### v1.5 — short list
1. **Wire the nav search.** Type-ahead across cards / sets / IPs / wallets. Currently the search field renders but is non-interactive.
2. **CC listings parser.** Add a `warm-cc-listings.ts` that parses LIST/CANCEL instructions from `CcmRKTuZ…` via Helius Enhanced TX, mirrors the existing `parseCCMarketplaceSale`. This unlocks a real CC floor (today CC contributes only insured-value to mcap).
3. **Per-IP hourly history.** Right now the IP-page volume chart only shows 24h. To enable real 7D / 30D / All pills, add a `warm-ip-history.ts` that classifies each sale to an IP and writes per-IP hourly buckets.
4. **Platform sub-routes.** `/platform/[key]/ips`, `/platform/[key]/cards`, `/platform/[key]/sales` — same shape as `/ip/[key]/sets` etc. The "See all" links on platform pages already point at these but the routes don't exist yet.
5. **Cron schedule on Vercel.** All warmers are designed to be cron-compatible. Suggested cadences are documented above. Vercel Cron config not yet committed.
6. **Switch CC + Courtyard fetches to cache-only on the homepage.** Today the homepage falls back to live Helius / Rarible calls if a cache is stale — that's where occasional 30–60s renders come from. With cron in place, force cache-only and the page stays sub-second.
7. **Search-by-text route.** `/search?q=` over the metadata caches (the cached JSONs already contain card names, sets, traits — could be indexed in memory at startup).
8. **Holders cross-platform unique union.** Current `holders.json` stores per-platform counts; a true unique-wallet figure across all platforms isn't there yet (small over-count today).
9. **Recent-sales feed.** Already implemented on `/platform/[key]`. Could add to the homepage as a 4th section if you want a chronological pulse.

### Known visual issues to revisit
- Sneakers IP showed `$4` mcap in last verification — the floor filter at $1 minimum still leaves tiny-volume IPs looking strange. Consider dropping IPs below a min cards threshold from the mcap table.
- Yu-Gi-Oh logo PNG is photographic; should be replaced with a pixel-art version to match Pokemon / One Piece style.

---

## Conventions used

- **All money in USD.** Spot conversion from native currencies via `src/lib/data/prices.ts` (CoinGecko free tier; rates cached per script run).
- **Currency formatting** — `formatCompactUsd` (`$1.2M`), `formatPct` (`+12.4%` / `−3.1%` with proper minus glyph), `formatInt` (`1,234`).
- **Sorting**: IP table sorts by Market Cap desc. Platform table sorts by 24h Volume desc. NaN values sink to the bottom on both.
- **Caps**: tables that share a page with other tables show top 10 + a "See all N →" link to a dedicated full-list route. Dedicated routes never cap.
- **Sparkline trend**: derived from first-half-sum vs second-half-sum of the bucket array; ±5% of total is "flat".

---

## Verified contract IDs (memorize these — don't auto-discover)

```ts
Beezie:           BASE:0xbb5ec6fd4b61723bd45c399840f1d868840ca16f
Courtyard:        POLYGON:0x251be3a17af4892035c37ebf5890f4a4d889dcad
Collector Crypt collection: CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf
Collector Crypt marketplace program: CcmRKTuZCGJBWQwMHvDYApBRvSZNHqGJXkznqpDTSQUr
```

---

## What was *not* built

- **Wallet / Portfolio page** — out of scope for v1 per first-session decision.
- **`$TCG` button** — removed.
- **Card detail page** (`/card/[id]`) — wireframed in the original design handoff but not implemented.
- **IP / Platform metadata-driven copy** — descriptions, founding date, vault provider details. Only data we surface is what we can derive from on-chain + listings.
- **Vercel deploy** — never pushed. Repo lives only on the local machine. Cron not yet scheduled.

---

## Snapshot of live numbers (last verified)

- Total Market Cap: **$43.2M** (Pokémon $35.4M, One Piece $3.5M, Other $2.4M, Football $400K, Basketball $319K, Baseball $250K, Yu-Gi-Oh! $596K…)
- 24h Volume: ~$300K–$1M (varies by hour)
- 7d Volume: $4.65M
- Total Cards classified: ~125K (Beezie 2.6K + CC 122K)
- Holders: ~10.6K (Beezie 917 + CC 9,725)
- Courtyard tokenizations: 36,648 / 24h (~$73K est primary)
