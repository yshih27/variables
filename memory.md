# TCG.market — Working Memory

CoinGecko-style analytics for **tokenized phygital trading cards**. Tracks Beezie (Base), Courtyard (Polygon), Collector Crypt (Solana), Phygitals (Solana).
Stack: Next.js 16 (App Router, Turbopack), Tailwind v4, server components + `unstable_cache`, disk caches under `.cache/`, warmers in `scripts/`. **No relational DB.**

> Read `HANDOVER.md` for the original v1 architecture. This file = everything since (gacha vertical + Dune).
> AGENTS.md warns: this Next.js has breaking changes — read `node_modules/next/dist/docs/` before writing framework code.

---

## ⭐ CURRENT STRATEGIC DIRECTION (most important — read first)

Two pieces of user feedback, in priority order.

### #1 (the real foundation): DATA RELIABILITY / TRUST — fix BEFORE building more
User's words: **"I don't even trust our own data. It feels like it is lagging and the whole site just feels static. Some platforms have data, some don't."** This is the core problem. A card page (or any depth) built on data you don't trust is worse than nothing. **Do this first.**

Symptoms → root causes:
- **Lag / stale:** warmers are **manual** (`npm run warm-*`), never on cron. Saw "Live · 476h ago" (~20 days stale). Never deployed to Vercel; no Cron. The "Live · Xs ago" badge shows *cache write time*, misleading.
- **Slow / static feel:** homepage/platforms cold-render 30-60s because `buckets.ts` falls back to **live Helius (429s)** on cache miss; 1h `unstable_cache` then freezes it. No live ticks.
- **Uneven coverage:** CC rich (122K traits, insured value, marketplace, gacha, rarity); Beezie partial (marketplace+Claw, thin secondary via Rarible, no buyback wallet, no deep traits); Courtyard tokenization-only (~$0 secondary); Phygitals gacha-only (no collection mint, no card values). → patchwork of empty/“—” cells = feels broken.
- **Don't trust numbers:** mix of sources (Rarible aggregator / Helius / Dune / RPC estimates / MINT×$2 guesses); we ourselves found the free-RPC undercounted CC by **3.6×** ($874K vs $3.1M Dune). No per-number provenance or honest "as of".

**The fix = a data-reliability layer (the actual next project):**
1. **Freshness:** put warmers on **Vercel Cron**; make pages **cache-only** (kill the live-Helius fallback so renders are sub-second + never stale-mid-render); surface an **honest "as of" timestamp per data source**, not a fake "live."
2. **Dune-first for the CORE too** (not just gacha). We proved Dune is complete + fast + reliable. Migrate per-IP / per-platform / per-card volume + mcap to Dune queries on a schedule. One source of truth per metric → numbers stop disagreeing across pages.
3. **Honest coverage:** explicitly mark "not tracked on this platform" instead of blank/zero cells; show a confidence/provenance chip. Better to say "we don't have it" than show a number you don't trust.
4. **Liveness:** real freshness + maybe incremental "updated just now"; consider a recent-activity stream so it feels alive, not a frozen snapshot.

### #2 (the depth layer — AFTER data is trustworthy): CARDS as the atomic unit ✅ confirmed by user
The card is the right atomic unit (like a "coin" on CoinGecko). Currently **no `/card/[id]` page** → search/Big Hits/Top Sales/Top Cards are dead ends; nothing is clickable; no per-card history. Pyramid: **Market → IP/Category → Set → CARD → Grade → Markets(platforms)**, time-series as the spine, everything interlinked.
Once data is reliable, build (in order): **`/card/[id]`** (price history, cheapest-across-platforms floor, sales log, holders/pop, grade ladder, "which packs pull this") → **time-series store** (hourly snapshots → real 7D/30D/90D/1Y charts) → **cross-platform price intelligence** (same physical card priced on Beezie vs CC vs Courtyard → arbitrage/best-floor; **unique to phygital**) → movers/watchlist/portfolio.

**Depth ≠ more features.** User is tired of features-without-thought. The sequence is: **trustworthy data → card home → history → cross-platform → personalization.** Have the strategy convo before building.

---

## DATA BACKEND: Dune (primary for gacha) — set up & working

- **Dune Plus plan, $349/mo, API access confirmed.** `DUNE_API_KEY` in `.env.local` (value: `Ko69QeJr0PF4Cn3t9cFkCY38Xxs5sssQ`).
- Client: `src/lib/dune/client.ts` — `runQuery(id)` (fresh execute→poll→results), `getLatestResults(id)` (cached, instant). I can **create queries via API** (`POST /api/v1/query`) — not blocked on user for query IDs. Archive temp ones via `POST /query/{id}/archive`.
- **Why Dune:** free Helius RPC tier severely undercounted (pagination caps). Dune scans full chain in seconds. CC was $874K/24h (RPC) vs $3.1M (Dune).
- Warmer: `npm run warm-gacha-dune` → writes `.cache/gacha-dune.json`. Run every ~6h (≈16 executions/day, cheap on Plus). `--cached` flag uses getLatestResults (zero credits).
- Dune SQL = Trino dialect. Solana table `tokens_solana.transfers` (amount is RAW → `/power(10,6)` for USDC). EVM tables `tokens_base.transfers` / `tokens_polygon.transfers` (amount already decimal-adjusted). Columns: block_time, token_mint_address/contract_address, from_owner/to_owner (Solana) or "from"/"to" (EVM, quoted), tx_id, amount.

### Dune query IDs (`src/lib/dune/queryIds.ts`)
- GACHA_QUERY_IDS (pulls by price, 24h/7d/30d): collector-crypt **7642633**, beezie **7642705**, phygitals **7642707**, courtyard **7642710** (tokenization, single-row)
- CC_ODDS_QUERY_ID **7643215** — realized rarity-tier prize counts (Low/Mid/High/Epic/LGND/SPrT)
- CC_BIG_HITS_QUERY_ID **7643571** — high-tier deliveries (Epic/LGND/SPrT), mint+tier+time
- BUYBACK_QUERY_IDS: collector-crypt **7644128**, phygitals **7644129** — USDC paid back to players

---

## CONTRACTS / WALLETS (verified — see `src/lib/data/sources.ts`)

**Beezie (Base 8453):** collection `0xbb5ec6fd4b61723bd45c399840f1d868840ca16f` · native marketplace `0x80d7C04B738eF379971a6b73f25B1A71ea1c820D` · Flow marketplace `0xf0FE19923767dC6e34f9890Bd6020002231ef386` (not tracked) · **Claw gacha `0x964E72Ae6BE07a191bE1778DbC52457272a53154`** (receives USDC pulls, forwards to treasury `0xaa9cfaa6…`; **no on-chain buyback** visible). Base USDC `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`.

**Courtyard (Polygon 137):** collection `0x251be3a17af4892035c37ebf5890f4a4d889dcad` · marketplace `0x5E4943373c2198625BD441Ae0629E9E7b4FB4797` · 20 tokenization-fee wallets (in sources.ts). **Tokenization, not gacha** — excluded from odds/hits. Polygon USDC `0x3c499c542cef5e3811e1192ce70d8cc03d5c3359`.

**Collector Crypt (Solana):** collection `CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf` · marketplace program `CcmRKTuZCGJBWQwMHvDYApBRvSZNHqGJXkznqpDTSQUr` · gacha wallets `GachazZscH…sc9z`, `GachaNgyXT…xJq3`, `96DULv1B…fwW9s` · 6 rarity tiers (2 wallets each except SPrT): SPrT/LGND/Epic/High/Mid/Low (full addresses in sources.ts CC_INTERNAL_EXCLUSIONS + odds query) · pull prices $25/50/75/80/100/250/1000. Solana USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.

**Phygitals (Solana):** gacha wallets `62Q9eeDY…S8dS` (main), `42oNTirN…f97e` (alt) · fees `4SabGkbLc9…` · royalties `2CEe9G68…` · treasury `5sn2nniGv…`. **Missing: collection mint + marketplace program** (kind:"helius" with empty strings — buckets.ts short-circuits). Variable pricing.

---

## KEY MECHANICS LEARNED

- **CC gacha = pay-then-reveal.** USDC payment and prize-NFT delivery are in **SEPARATE txs** (0% shared tx_id). To attribute pull→card, must join by **buyer + time window** (not tx). This blocks realized-EV-per-pack until built.
- **CC buyback ~99.6% instant** — nearly every pull sold straight back. House take **9.2%** ($2.5M/7d). Phygitals 5.1% ($517K/7d).
- **Stated odds are LIVE** (Phygitals/Beezie recompute every few seconds off Alt/eBay FMV). So **don't compile static stated odds** — they go stale. Realized (on-chain) is the stable anchor + our differentiator ("verify the house").
- **Platforms define tiers by VALUE BAND** (Phygitals: Base $18-30 … Ultra-Rare $200+; CC published Common/Uncommon/Rare/Epic at ~75/20/4/1 with $ ranges scaling per pack). Realized odds should bucket delivered-card FMV into bands.
- **No FMV endpoint** from user for Phygitals/Beezie. CC has FMV via "Insured Value" trait. **Buyback back-out idea:** FMV ≈ payout ÷ buyback% (buyback% ~85-93%, one stated number/platform) → could estimate Phygitals/Beezie card value. Needs their stated buyback %.
- **cc-traits cache** (`.cache/cc-traits/*.json`, 122K cards): has `name`, `image` (Helius CDN, renders directly), `attributes` incl `Insured Value`, `Card Name`, `Category`, `Grade`, `Set`. This is our CC FMV + metadata source.
- **Rarible = the user's team. They run their own RPC** (vanilla vs enhanced TBD — user checking). Rarible is an indexed API, NOT an RPC. Could replace Helius to kill 429s + enable Beezie Base parsing. Questions to ask their tech are in the transcript (chains/endpoints/auth/rate-limit/DAS-support/archive).

---

## WHAT'S BUILT — /gacha page (the deep vertical, Dune-backed)

`src/app/gacha/page.tsx` + `src/lib/data/fetchGacha.ts` (getGachaData, cache key `gacha:v8`) reads `.cache/gacha-dune.json`.
Sections in order: **Hero** (pull vol, pulls, biggest hit $43.2K FMV, best-EV pending) → **Big Hits rail** (`GachaBigHitsRail`, real card photos ranked by insured value, top = $43.2K Shining Mewtwo) → **Compare by Budget** (`GachaBudgetCompare`, interactive $25/$50/.../$1K+ chips → per-platform spins 24h/7d/30d + avg; odds/prize/hit cols still "soon") → **House Take** (`GachaHouseTake`, players spent / paid back / net / take% / cashed-out, CC+Phygitals) → **Pulls by Price + Odds** (`GachaPlatformDeepDive`, per-platform price bars + CC realized rarity bar).
- `GachaTable.tsx` is **orphaned** (old MVP, not imported) — safe to delete.
- Text was trimmed last turns (user wants less copy, self-explanatory UI). Methodology block removed → links to `/methodology`.
- Image pipeline: `src/lib/img.ts` `proxyImg()` — normalizes Beezie `original-N.jpg`→`original.jpg` (the -N variants 403), proxies raw `arweave.net` via `/api/img` (streams + magic-byte sniffs + 415 for non-images). `/api/img/route.ts`.

### Gacha pieces still PENDING
- **Realized EV per pack** (buyer+time join) — fills budget table's Best Odds/Top Prize/Biggest Hit + "Best-EV Pack". Task #35.
- **Phygitals/Beezie odds+EV** — need FMV (buyback back-out or a value source). Beezie also needs a buyback wallet (Claw forwards to treasury, none visible).
- **Stated vs Realized side-by-side** — user wanted this; stated is live so we lean realized. Task #36 (ingest stated) partly moot now.

---

## CACHE FILES (`.cache/`)
gacha-dune.json (Dune gacha: platforms{pulls/vol 24h7d30d, byPrice[], odds[], buyback{}}, bigHits[]) · marketcap.json + marketcap-history.json · listings.json · holders.json · cc-traits/* (122K) · beezie-traits/* · cc-sales-24h.json · courtyard-primary.json · primary-revenue.json (legacy RPC, superseded by Dune; buckets.ts resolvePrimaryUsd prefers gacha-dune) · history/{platform}.json.

## CACHE-KEY VERSIONS (bump on shape change)
homepage:v36 · platform-buckets:v5 · platforms-fulllist:v4 · ips-fulllist:v2 · gacha:v8 · ip-detail:v3 · platform-detail:v1. (Cold homepage/platforms renders are slow — 30-60s — due to live Helius 429 fallback in buckets.ts; documented in HANDOVER as "switch to cache-only".)

## ROUTES
`/` `/ips` `/platforms` `/gacha` `/methodology` `/search?q=` `/ip/[key]` (+ /sets /grades /cards) `/platform/[key]` (+ /ips /cards /sales) · `/api/img`. Custom loading/error/not-found. sitemap.ts, robots.ts, icon.tsx, opengraph-image.tsx. **Missing: `/card/[id]`** (the big gap).

## DEV
`npm run dev` (port 3000). Preview MCP (`next-dev` in .claude/launch.json) for screenshots — must own port 3000 (kill bg dev first). `npx tsc --noEmit` to typecheck (ignore the pre-existing `scripts/diagnose-traits.ts` .size error). zsh gotcha: don't use `path` as a loop var (clobbers $PATH). curl works for Dune/explorers; WebFetch/external curl sometimes sandbox-blocked for sub-agents. Today's date context drifts (2026-05/06).
