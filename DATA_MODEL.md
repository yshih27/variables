# VARIABLE — Data Model Design

**Status:** DESIGN — for review before migration.
**Goal:** one schema that serves the MVP (IP + platform + gacha metrics, live, across as many RWA-TCG platforms as possible) *and* grows into the atomic vision (every card & transaction reconciled across every platform) without rewrites.

---

## 0. Principles

1. **The card is the atom — but a card exists in two forms.** A *canonical card* ("2002 Neo Destiny #109 Shining Mewtwo, PSA 10") is platform-agnostic. A *card instance* is one platform's tokenized copy of it (a CC mint, a Beezie tokenId, a Phygitals cNFT). Modeling these separately is what makes cross-platform matching, floor comparison, and unified history possible.
2. **Two source types, one schema.** Every fact carries a `source` (`dune` | `beezie-api` | `phygitals-api` | `helius` | `rarible` | `coingecko`). The *same* table is fed by Dune **or** an API depending on which is better per platform — a routing matrix (§5) decides, and it's just config.
3. **Marketplace and gacha are both transactions.** A gacha pull is a transaction with a `sale_type` and a prize. Unifying them under `sales` (+ a thin gacha layer) means one history per card, whatever produced it.
4. **Precompute for reads, keep the spine for history.** Pages read flat, ranked metric rows (`entity_metrics`); charts read the append-only time-series (`metric_snapshots`). Warmers do the joins once.
5. **Growth = config + data + a warmer, never a migration.** New platform → a row + a warmer module. New category → a row. New granularity (set, card) → a new `entity_type` value, not a new table. New source → a new `source` value.

---

## 1. Conceptual model

```
                         ┌──────────────┐      ┌──────────────┐      ┌─────────┐
   DIMENSIONS            │  platforms   │      │  categories  │◄─────│  sets   │
   (seeded from code     └──────┬───────┘      └──────┬───────┘      └────┬────┘
    config, queryable)          │                     │                   │
                                │            ┌─────────▼─────────┐         │
   ATOMIC                       │            │   cards (CANON)   │◄────────┘   ← the atom
   (cross-platform)             │            │  match_key, fmv   │
                                │            └─────────▲─────────┘
                                │                      │ card_id (nullable until matched)
                          ┌─────▼──────────────────────┴───────────────┐
   PER-PLATFORM           │            card_instances                  │   ← one token per platform
   (one row per token)    │  platform · token_id · chain · raw traits  │
                          └──────┬───────────────┬───────────────┬─────┘
                                 │               │               │
   FACTS               ┌─────────▼───┐   ┌───────▼──────┐  ┌─────▼────────┐
   (transactions)      │  listings   │   │    sales     │  │ gacha_pulls  │
                       │  (active)   │   │ (history,    │  │ (pull→prize) │
                       └─────────────┘   │  sale_type)  │  └──────┬───────┘
                                         └──────┬───────┘         │
                                                ▼                 ▼
   AGGREGATES (warmer-computed)   ┌───────────────────────┐  ┌──────────────┐
                                  │   entity_metrics      │  │ gacha_metrics│
                                  │ market/platform/ip/   │  │ platform ×   │
                                  │ set/card × window     │  │ category ×   │
                                  └───────────┬───────────┘  │ tier × window│
                                              │              └──────────────┘
   TIME-SERIES + PROVENANCE        ┌──────────▼──────────┐   ┌──────────────────┐
                                   │  metric_snapshots   │   │ source_freshness │
                                   └─────────────────────┘   └──────────────────┘
```

---

## 2. The clever decisions (why it's shaped this way)

### 2.1 Canonical `cards` ⟂ `card_instances` — the atomic-matching enabler
- `card_instances` is what we have today (the 124K-row `cards` table) — one row per platform token, with raw per-platform traits and an `ip_key` for grouping.
- `cards` (canonical) is new and **may be empty at MVP**. Each instance gets `card_id = NULL` until a matcher links it.
- A **matcher** (Phase 2) computes a normalized `match_key` from each instance's parsed traits — `category|set|number|name|year|language|variant|grader|grade` lower-cased & synonym-mapped — upserts a canonical `cards` row, and sets `instance.card_id`. Instances sharing a `match_key` collapse onto one canonical card.
- Payoff: `SELECT … FROM card_instances JOIN listings WHERE card_id = X` → **cheapest copy across every platform** (the unique-to-phygital arbitrage view). `SELECT … FROM sales WHERE card_id = X` → **one sale history across all platforms**. None of this needs a schema change — only the matcher populating `card_id`.
- Fuzzy matching (typos/abbreviations) uses Postgres `pg_trgm` (trigram similarity) now, `pgvector` (embeddings) later — both available on Supabase. MVP matcher = exact normalized key (catches the clean majority); fuzzy is an upgrade, not a rewrite.

### 2.2 Generic `entity_metrics` instead of one table per level
One precomputed table serves Market → IP → Set → Card → platform, at any window:
- `entity_type ∈ {market, platform, category, set, card, platform_category}` + `entity_id`.
- Common, **sortable** columns (`vol_usd`, `sales_count`, `mcap_usd`, `floor_usd`, `holders`, `avg_price_usd`, `pct_change`); anything type-specific (e.g. platform `primary_usd`, ip `insured_usd`) goes in `extra jsonb`.
- Adding "Pokémon-on-Beezie" metrics = `entity_type='platform_category', entity_id='beezie:pokemon'` — no new table. N≈6 platforms × ~17 categories × 3 windows ≈ a few hundred rows; trivial to precompute.
- This **replaces** today's `platform_metrics` + `ip_metrics`.

### 2.3 `sales.sale_type` unifies marketplace + gacha
Phygitals' feed already mixes them (`CLAW` pull, `BUY` buyback, both `clawId`-tagged). One `sales` table with `sale_type ∈ {marketplace, gacha_pull, buyback, mint, burn}` + a `venue` (OpenSea/Tensor/native) gives one transaction history per card, and lets gacha analytics and marketplace analytics read the same spine. The thin `gacha_pulls` table only adds the pull→prize link.

### 2.4 Provenance + a source-routing matrix
Every fact row carries `source`. A config matrix (§5) maps `(platform, data_type) → source`, so a warmer knows whether to call Dune or an API. Swapping a source later (e.g. CC sales Helius→Dune) is a config edit + a warmer, never a schema change. `source_freshness` records the honest "as of" per source.

### 2.5 Dimensions seeded from code
`platforms` / `categories` / `sets` are **mirrors of typed code config** (today's `sources.ts` / `ipCatalog.ts`), auto-seeded into the DB so SQL can join/sort/display them. Code stays the source of truth (typed, versioned); the DB gets the rows. Onboarding a platform = edit config + write a warmer; a seed step inserts the row.

---

## 3. Schema (DDL)

Conventions: `text` ids, `numeric` money (never float), `timestamptz`, `jsonb` for flexible/type-specific fields, `source` + `generated_at`/`updated_at` on every fact. **MVP** tables marked ✅; **Phase 2** marked ◷ (schema created now, populated later).

### 3.1 Dimensions

```sql
-- ✅ platforms — RWA-TCG sites (mirror of code config; add a platform = a row)
create table platforms (
  platform_id      text primary key,            -- 'beezie' | 'courtyard' | 'collector-crypt' | 'phygitals' | …
  name             text not null,
  chain            text not null,               -- Base | Polygon | Solana | …
  vault_provider   text,                         -- Brink's | PWCC | …
  native_currency  text,                         -- USDC mint/addr
  has_marketplace  boolean not null default true,
  has_gacha        boolean not null default false,
  collections      jsonb not null default '[]',  -- on-chain collection addresses (cNFT mints, ERC-721)
  config           jsonb not null default '{}',  -- marketplace addr, gacha wallets, fee wallets, validAmounts…
  status           text not null default 'active',-- active | onboarding | paused
  added_at         timestamptz not null default now()
);

-- ✅ categories — IPs (Pokémon, One Piece, sports, sealed, …)
create table categories (
  category_id  text primary key,                 -- 'pokemon' | 'one_piece' | 'basketball' | …
  name         text not null,
  short        text,
  kind         text,                              -- tcg | sport | sealed | streetwear | other
  color        text,
  logo         text,
  display      jsonb not null default '{}'        -- emoji, iconBlendMode, sort hints
);

-- ◷ sets — card sets under a category (Neo Destiny, Astral Radiance, …)
create table sets (
  set_id       text primary key,
  category_id  text not null references categories(category_id),
  name         text not null,
  release_year int,
  aliases      jsonb not null default '[]',       -- name variants for matching
  unique (category_id, name)
);
```

### 3.2 Atomic entities

```sql
-- ◷ cards — the CANONICAL atom (platform-agnostic). Populated by the matcher.
create table cards (
  card_id      text primary key,                 -- stable id (hash/slug of match_key)
  match_key    text unique not null,             -- normalized identity for dedup/matching
  category_id  text references categories(category_id),
  set_id       text references sets(set_id),
  card_name    text,
  card_number  text,
  year         int,
  variant      text,                              -- '1st Edition' | 'Holo' | 'Reverse' | …
  language     text,
  grader       text,                              -- PSA | CGC | BGS | … | null (raw)
  grade_num    numeric,
  image        text,
  fmv_usd      numeric,                            -- best cross-source fair-market value
  first_seen   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on cards (category_id);
create index on cards using gin (match_key gin_trgm_ops);  -- fuzzy matching (pg_trgm)

-- ✅ card_instances — one platform's tokenized copy (today's `cards` table, evolved)
create table card_instances (
  instance_id   text primary key,                -- 'cc-<mint>' | 'bz-<tokenId>' | 'pg-<mint>' | …
  platform_id   text not null references platforms(platform_id),
  token_id      text not null,
  chain         text not null,
  token_standard text,                            -- ERC721 | CNFT | SPL
  card_id       text references cards(card_id),  -- NULL until matched (Phase 2)
  category_id   text references categories(category_id),  -- classified now (MVP grouping)
  set_id        text references sets(set_id),
  name          text,
  card_name     text,
  card_number   text,
  year          int,
  grader        text,
  grade_num     numeric,
  grade_label   text,
  image         text,
  image_fallback text,
  fmv_usd       numeric,                           -- per-platform value (insured value / API fmv)
  attributes    jsonb,                             -- raw traits (kept for re-parsing)
  source        text not null,                     -- helius | beezie-api | phygitals-api | rarible
  updated_at    timestamptz not null default now(),
  unique (platform_id, token_id)
);
create index on card_instances (card_id);
create index on card_instances (category_id);
create index on card_instances (platform_id);
create index on card_instances (lower(card_name));
create index on card_instances (fmv_usd desc nulls last);
```

### 3.3 Marketplace facts

```sql
-- ✅ listings — current active listings (aggregated across venues, e.g. Tensor/OpenSea)
create table listings (
  listing_id    text primary key,                -- platform:venue:token or item id
  platform_id   text not null references platforms(platform_id),
  instance_id   text references card_instances(instance_id),
  card_id       text references cards(card_id),  -- nullable until matched
  category_id   text,
  price_usd     numeric not null,
  price_native  numeric,
  currency      text,
  venue         text,                             -- OPEN_SEA | TENSOR | MAGIC_EDEN | native
  status        text not null default 'active',
  listed_at     timestamptz,
  source        text not null,
  updated_at    timestamptz not null default now()
);
create index on listings (platform_id, price_usd);
create index on listings (card_id);
create index on listings (category_id, price_usd);

-- ✅ sales — transaction history (marketplace + gacha, unified). Recent window for MVP.
create table sales (
  sale_id       text primary key,                -- platform:txid:logIndex
  platform_id   text not null references platforms(platform_id),
  instance_id   text references card_instances(instance_id),
  card_id       text references cards(card_id),
  category_id   text,
  sale_type     text not null,                    -- marketplace | gacha_pull | buyback | mint | burn
  price_usd     numeric not null,
  price_native  numeric,
  currency      text,
  buyer         text,
  seller        text,
  venue         text,
  tx_hash       text,
  source        text not null,                    -- dune | rarible | phygitals-api | beezie-api | helius
  sold_at       timestamptz not null
) partition by range (sold_at);                   -- monthly partitions (see §6)
create index on sales (sold_at desc);
create index on sales (platform_id, sold_at desc);
create index on sales (card_id, sold_at desc);
create index on sales (category_id, sold_at desc);
create index on sales (sale_type, sold_at desc);
```

### 3.4 Gacha

```sql
-- ✅ gacha_products — packs / claws offered (per platform, per category)
create table gacha_products (
  product_id    text primary key,                -- 'phygitals:starter-one-piece-pack' | 'cc:100'
  platform_id   text not null references platforms(platform_id),
  category_id   text references categories(category_id),
  name          text,
  claw_id       text,                             -- native pack id
  price_usd     numeric,                           -- pull price (tier)
  odds_stated   jsonb,                             -- live stated odds, if the platform exposes them
  active        boolean not null default true,
  updated_at    timestamptz not null default now()
);

-- ◷ gacha_pulls — per-pull with prize linkage (Phase 2; Phygitals API gives clawId↔nft)
create table gacha_pulls (
  pull_id            text primary key,
  platform_id        text not null references platforms(platform_id),
  product_id         text references gacha_products(product_id),
  buyer              text,
  price_usd          numeric,
  prize_instance_id  text references card_instances(instance_id),  -- the card pulled
  prize_value_usd    numeric,
  tx_hash            text,
  source             text not null,
  pulled_at          timestamptz not null
);
create index on gacha_pulls (product_id, pulled_at desc);
create index on gacha_pulls (platform_id, pulled_at desc);

-- ✅ gacha_metrics — realized gacha aggregates (Dune), per platform × category × tier × window
create table gacha_metrics (
  scope         text not null,                    -- platform | platform_category | price_tier
  scope_id      text not null,                    -- 'phygitals' | 'phygitals:pokemon' | 'cc:100'
  window        text not null,                    -- 24h | 7d | 30d
  pulls         int,
  volume_usd    numeric,
  buyback_usd   numeric,
  net_usd       numeric,
  take_pct      numeric,
  odds          jsonb,                             -- realized tier distribution
  generated_at  timestamptz not null,
  source        text not null default 'dune',
  primary key (scope, scope_id, window)
);
```

### 3.5 Aggregates, time-series, provenance, support

```sql
-- ✅ entity_metrics — precomputed, ranked metrics for every level (replaces platform_metrics + ip_metrics)
create table entity_metrics (
  entity_type   text not null,                    -- market | platform | category | set | card | platform_category
  entity_id     text not null,
  window        text not null default '24h',      -- 24h | 7d | 30d | all
  vol_usd       numeric,
  sales_count   int,
  mcap_usd      numeric,
  floor_usd     numeric,
  holders       int,
  avg_price_usd numeric,
  pct_change    numeric,
  spark         jsonb,
  extra         jsonb not null default '{}',      -- type-specific (primary_usd, insured_usd, cards_count…)
  generated_at  timestamptz not null,
  source        text,
  primary key (entity_type, entity_id, window)
);
create index on entity_metrics (entity_type, window, mcap_usd desc nulls last);
create index on entity_metrics (entity_type, window, vol_usd desc nulls last);

-- ✅ metric_snapshots — append-only time-series spine (already in prod; keep)
create table metric_snapshots (
  entity_type text not null, entity_id text not null,
  metric text not null, value numeric not null, ts timestamptz not null,
  primary key (entity_type, entity_id, metric, ts)
);

-- ✅ source_freshness — honest per-source "as of" (already in prod; keep)
create table source_freshness (
  source text primary key, generated_at timestamptz not null,
  status text not null default 'ok', rows_written int, duration_ms int,
  error text, next_expected_at timestamptz
);

-- ✅ token_prices — spot FX for currency→USD (provenance for conversions)
create table token_prices (
  token text primary key, usd numeric not null, at timestamptz not null, source text default 'coingecko'
);
```

---

## 4. What each platform offers (marketplace + gacha × categories)

Every platform row declares `has_marketplace` / `has_gacha` and its `collections`. Per-category breakdown falls out of `card_instances.category_id` (marketplace) and `gacha_products.category_id` (gacha), aggregated into `entity_metrics(platform_category)` and `gacha_metrics(platform_category)`. So "One Piece on Phygitals — marketplace floor *and* gacha take" is one query each, for any platform/category pair.

---

## 5. Source-routing matrix (Dune vs API, per platform × data-type)

Lives as typed config (`PLATFORM_DATA_SOURCES` in code); warmers consult it. Bold = decided from our investigation.

| Data type | Beezie | Courtyard | Collector Crypt | Phygitals |
|---|---|---|---|---|
| Secondary sales / volume | **Rarible** (aggregates OpenSea — native API is only ~2%) | **Rarible** | **Dune** (Helius 429s) | **Phygitals API** `/sales` (or Dune) |
| Listings / floor | Rarible `/orders` | Rarible | Dune (CC API is write-only) | **Phygitals API** `/marketplace-listings` (aggregates Tensor) |
| Card traits | Beezie API / tokenURI | (thin) | **Helius DAS** | **Phygitals API** (inline) or Helius DAS via mints |
| Holders | Rarible ownerships | Rarible | Helius DAS | Helius DAS (mints now known) |
| Gacha aggregates | **Dune** (Claw) | n/a (tokenization) | **Dune** | **Dune** |
| Gacha pull→prize | — | — | hard (separate txs) | **Phygitals API** (`clawId`↔nft) |
| Primary revenue | Dune | Rarible MINT count | Dune | Dune |

Adding a platform adds a **column**; adding a data type adds a **row**; the schema is untouched.

---

## 6. Scalability

- **`sales` is the only big table.** Partition by `sold_at` month; index per (platform/card/category, sold_at). **MVP keeps a recent window only** (e.g. 90 days) — full per-card history is the Phase-2 atomic goal, and Dune can re-serve deep history on demand. Beyond the window, roll up into `metric_snapshots`.
- **`card_instances`** ≈ 124K (CC) + Beezie + Phygitals cNFTs + Courtyard → a few hundred K rows; fine for Postgres. Trait `jsonb` dominates size — store only used fields (already do).
- **Free tier (500 MB) vs Pro (8 GB).** cards/instances ~150 MB + recent listings/sales + metrics fit free for the current 4 platforms; onboarding many platforms or widening the sales window → **Supabase Pro ($25/mo, 8 GB)**. Storage is the trigger, nothing else.
- **Reads stay O(1):** pages read `entity_metrics` (a few hundred rows) and `metric_snapshots` slices — never scan `sales`.

---

## 7. Extensibility — onboarding a new RWA-TCG site

1. Add a `platforms` row + typed config (collections, marketplace/gacha addresses, `validAmounts`).
2. Add its column to the source-routing matrix (which source per data type).
3. Write/parametrize a warmer that writes `card_instances` + `listings` + `sales` (+ `gacha_*`) with the right `source`.
4. (Optional) add new `categories` rows it introduces.

No schema migration. The metrics/time-series/provenance layers pick it up automatically. New data sources are just new `source` string values + a client.

---

## 8. MVP vs Phase 2

**MVP (build now) — "IP + platform + gacha live, across as many sites as possible":**
- Dimensions: `platforms`, `categories` (seeded from code).
- `card_instances` (rename/evolve current `cards`) with `category_id` classified.
- `listings` + recent `sales` (normalized from the current blobs), per platform via the routing matrix — **including Phygitals (new) via its API, and CC sales via Dune**.
- `gacha_products` + `gacha_metrics` (Dune), per platform × category.
- `entity_metrics` for `platform`, `category`, and `platform_category` (+ `market`) → homepage/IP/platform pages read these.
- `metric_snapshots`, `source_freshness`, `token_prices`.
- Onboard the 4 platforms cleanly + a template to add more.

**Phase 2 (the atomic layer):**
- `cards` (canonical) + the **matcher** (`match_key`, then `pg_trgm`/`pgvector` fuzzy) → populate `card_instances.card_id` / `listings.card_id` / `sales.card_id`.
- Cross-platform floor & arbitrage, unified per-card history, `card`/`set` `entity_metrics`.
- `gacha_pulls` (pull→prize via Phygitals API) → realized EV per pack.
- `sets` fully populated; wallet-level `holders` for portfolio/whales; deep sales history.

---

## 9. Migration from current state (incremental, non-breaking)

1. Create dimensions + seed from `sources.ts`/`ipCatalog.ts`.
2. `cards` → `card_instances` (add nullable `card_id`, FK columns); readers already go through `cards.ts` helpers — repoint them.
3. Normalize the `snapshots` blobs into tables as each warmer is upgraded: gacha blob → `gacha_metrics`/`gacha_products`; listings blob → `listings`; marketcap/holders blobs → `entity_metrics`; cc-sales/history → `sales`/`metric_snapshots`. Blobs stay live until each cutover.
4. `platform_metrics` + `ip_metrics` → `entity_metrics`; flip the page fetchers to read it.
5. Wire Phygitals (new) + CC-via-Dune through the routing matrix.

Each step ships independently; the deployed site keeps working throughout.

---

## 10. Confirmed scope & the buyer use-case

**The canonical card is the product.** A collector arrives wanting a specific card — "a 2002 Shining Mewtwo PSA 10" — and we answer two questions no single platform can:

1. **Buy it now** — every platform that lists that canonical card, cheapest first (`listings` → `canonical_card_id` → min `price_usd`). The cross-platform best-floor / arbitrage view, unique to phygital.
2. **Or pull it** — every gacha pack that has *produced* that card, with realized hit-rate and EV (`gacha_pulls.prize_canonical_id` reverse-lookup → `gacha_products`). "Open Phygitals' One Piece pack for a 1-in-N shot."

Both are single indexed queries once the matcher fills `canonical_card_id`.

**Platform roadmap:** MVP onboards **Beezie, Courtyard, Collector Crypt, Phygitals**. Next: **Renaiss, Mnstr** (pending their APIs — in conversation). Each is config + a warmer; no schema change.

---

## 11. Gacha pack-centric spend model (BUILT 2026-06-10)

> **Shipped** as snapshot blobs (no DDL): `gacha:packs` written by `warmers/gachaPacks.ts` (Beezie `/claw` advertised + Phygitals `/vm/chase` advertised + realized join from `gacha_pulls` by (category,price) + CC native per-pack). Read by `fetchGacha` → `payload.packs`; rendered by `components/GachaPackExplorer.tsx` (the comparison table + budget split-vs-single, replacing the old platform-level spend-decider). Types in `gachaPacksCache.ts`; view math in `gachaPackView.ts`. Cache key `gacha:v12`; freshness sources `gacha-packs` + `cc-gacha`; crons `/api/cron/gacha-packs` + `/api/cron/cc-gacha`; in `warm.yml` core batch. Honesty pass (adversarial review, 30 findings fixed): stated/measured/platform/assumed basis chips everywhere; **leads with median ("typical") not mean**; net-EV-after-buyback; thin-sample (n<10) flagging incl. the budget P(≥1); floor never derived from chase. Spec below is the as-built design.
>
> **CC went native (2026-06-10 PM).** The gacha app `gacha.collectorcrypt.com` exposes unauthenticated `/api/gachas/all` (33 machines: price, STATED tier weights ≈ .75/.20/.04/.01, per-tier $ ranges, `targetEV`/`maxEV`, `instantBuyback` 85–93%, `bigWinChance` = non-common share) and `/api/getAllWinners?perTier=N` (most-recent-N per machine×tier; N=100 → ~7.7K pulls w/ prize NFT + `insuredValue`; `prize_tier` 1=Epic…4=Common). Client `src/lib/cc/gacha.ts`; warmer `warmers/ccGacha.ts` → snapshot `gacha:cc` + `gacha_pulls` spine. ⚠️ The winners sample is STRATIFIED (equal depth per tier) — realized EV/odds are computed only inside each pack's complete-coverage window; per-pack `pulls24h` is apportioned from Dune's exact per-price totals by observed rates (private machines included in the pool). CC rows are now fully pack-attributable — the old `notDirectlyComparable` Dune-shell path survives only as a fallback when `gacha:cc` is absent.



**The bug this fixes.** The /gacha "Where should I spend it?" decider buckets Dune *volume* by observed pull price and shows a **platform-wide** biggest-hit (`biggestHitFor(platform, …)` = max over *all* the platform's hits). So the "Biggest Hit" column is identical in every budget band — $43.2K for CC at $50 *and* at $1K, $536 for Phygitals everywhere. That's backwards: a $50 pack can't pull a $43.2K card; a $1K pack's ceiling is far above $536. **The unit of the decision is the pack, not the platform-budget-bucket.** We don't currently model the pack catalog at all — we infer price tiers from volume.

**The pack is the product.** Each site sells a fixed catalog of priced packs, often per category:
- **Phygitals** (Pokémon): Trainer $10 · Rookie $25 · Elite $50 · Sealed $100 · Legend $250 · Base Set $500 · Platinum $500 · Mythic $1,000 · Black $2,500 · Diamond $5,000 (One Piece variants too: starter/elite/legend/mini-villain/all-or-nothing/increased-odds packs).
- **Beezie**: Wildcard $30 · Silver TCG $50 · Gold TCG $250 · Platinum TCG $500.
- **Collector Crypt**: $25 · $50 · $75 · $80 · $100 · $250 · $1,000 tiers.

Per pack we surface **two complementary views**:
- **Advertised** (the published pool) — *top-hits-available* (the grail you're chasing, e.g. the $30K Base Set Shadowless Gyarados in Phygitals' Mythic pack), *live odds* (value-band probabilities), *EV*, *buyback %*. Source = the site's pack API.
- **Realized** (what's actually happened) — *biggest hit pulled so far*, realized odds/EV, recent pulls (popularity). Source = our `gacha_pulls` spine.

### 11.1 Schema — extends §3.4 (additive, non-breaking)

```sql
alter table gacha_products
  add column image            text,         -- pack art
  add column currency         text,
  add column ev_usd           numeric,      -- advertised expected value per pull
  add column buyback_pct      numeric,      -- e.g. 0.90 (instant cash-out rate)
  add column value_ranges     jsonb,        -- per-tier $ bands (Phygitals live-odds bands / Beezie priceRanges)
  add column top_hits         jsonb,        -- advertised pool top prizes: [{name,image,value_usd,instance_id?}]
  add column stock_count      int,          -- items currently in the pool
  add column contract_address text;         -- Beezie per-claw contract (on-chain anchor)
-- odds_stated (already present) := advertised live odds — tier % (Beezie) or value-band % (Phygitals)
```

Realized per-pack aggregates reuse `gacha_metrics` with a new **`scope='product'`** (`scope_id = product_id`): `pulls`, realized `odds` (value-band distribution), realized EV, and the biggest realized hit. *Biggest-hit-realized per pack* = `max(prize_value_usd)` over `gacha_pulls` grouped by `product_id` — a single query on the existing `(product_id, pulled_at)` index.

### 11.2 Per-site sourcing matrix

| Field | Beezie | Phygitals | Collector Crypt |
|---|---|---|---|
| Pack list + price | ✅ `/claw` `priceUsdc` | ✅ config (10 packs/category, from UI) | ✅ `/api/gachas/all` (33 machines, public flag) |
| Live odds | ✅ `/claw.odds` (base/low/medium/high/grails) | realized from `gacha_pulls` (advertised odds endpoint not exposed) | ✅ stated `weightMultipliers` + `tierRanges` per machine |
| EV | ✅ `averageValue` (≈1.10× price) | realized (feed); advertised hidden | ✅ `targetEV`/`maxEV` (1.02–1.10×) + realized from winners |
| Top-hits available | ✅ `/claw.grails[]` (tokenId+swapValue) | ✅ **`/api/vm/chase/{slug}`** → 60 chase items `{id,name,image,fmv}` | none advertised — realized biggest-pull stands in (with art) |
| Buyback % | `swapFees` | ✅ (UI shows e.g. 90%); confirm per-pack | ✅ `instantBuyback.percentageOfValue` (85–93%) |
| Top-hit realized | on-chain (Dune, per claw contract) | ✅ `gacha_pulls` by `product_id` (live now) | ✅ `/api/getAllWinners` (name+art+insuredValue, per pack) |

**DISCOVERED 2026-06-09** — Phygitals gacha namespace is **`/api/vm/`** ("vm" = vending machine; never guessable). **`/api/vm/chase/{slug}`** returns each pack's top ~60 chase prizes (`id,name,image,fmv`), confirmed for all 10 packs — top-hit scales with price (trainer-pack $559 → mythic-pack $30,461 → black/diamond $100,000). This is the advertised Top-Hits the decider needs. The **live-odds/EV** endpoint is still hidden (every `/api/vm/{odds,draw,stats,ev,probability,…}/{slug}` 404s) → **v1 uses realized odds/EV** from the `gacha_pulls` spine; advertised live-odds is a later add if the user grabs that request.

Pack slugs: `trainer-pack rookie-pack elite-pack sealed-pack legend-pack base-set-pack platinum-pack mythic-pack black-pack diamond-pack` (Pokémon); One-Piece + other categories have parallel slugs (seen in feed: `starter-one-piece-pack`, `elite-one-piece-pack`, `legend-one-piece-pack`, `mini-villain`, `all-or-nothing`, `increased-odds-pack`). Numeric clawIds in the feed (`13`,`14`,`17`) are legacy/category aliases for the same packs.

**Beezie maps 1:1 to `/claw` today** (build first). **Phygitals** Top-Hits ✅ via `/api/vm/chase`, realized odds/EV live. **CC** native per-pack since 2026-06-10 (`gacha.collectorcrypt.com/api` — see the callout at the top of §11); the platform-level Dune path is fallback-only.

### 11.3 Spend-decider UX

Pick budget **B** → the decider lists every **pack priced ≤ B** across *sites* (not platforms), each row:

```
[art] Pack · Platform · $price · category │ TOP HIT (grail, w/ art) │ LIVE ODDS (hit% + value-band bar) │ EV │ BUYBACK │ realized: biggest pulled + popularity
```

Sortable by top-hit value / hit-odds / EV / price / popularity. Replaces the platform-wide biggest-hit entirely.

**Split-vs-single helper** (the "$2.5K: one Diamond or 2×Mythic+Base Set?" question). For budget B and a pack at price p: shots = ⌊B/p⌋, and P(≥1 grail) = 1 − (1 − odds_grail)^shots. The tool answers:
- *Chase a specific card* → which pack contains it + your P(hit) at B (more cheap pulls of the pack that holds it = more shots at it).
- *Maximize any rare hit* → the pack/combo maximizing P(rare) for B; compares `1×Diamond` vs `2×Mythic + 1×Base Set` head-to-head.

### 11.4 Build phases
1. **Schema** alter (additive) + seed pack catalogs: Beezie `/claw`, Phygitals (pack API + config), CC tiers.
2. **Warmers**: new Beezie `/claw` warmer; Phygitals pack warmer (advertised); extend the realized warmer to also write `scope='product'` metrics + per-pack biggest-realized-hit.
3. **fetchGacha / decider**: replace budget→platform-volume with pack-centric rows; per-pack top-hit = advertised ‖ realized.
4. **UI**: pack rows + split-vs-single helper; retire `biggestHitFor(platform,…)`.

**Sourcing resolved.** Phygitals Top-Hits ✅ `/api/vm/chase/{slug}`; Beezie ✅ `/claw`; realized odds/EV from `gacha_pulls`. The only remaining *advertised* gap is Phygitals' published live-odds/EV numbers (a later enhancement). v1 is fully buildable now.
