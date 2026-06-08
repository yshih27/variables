-- TCG.market — Data Model MVP migration. See DATA_MODEL.md.
-- Additive + non-breaking: the live app reads the `cards` table + `snapshots`
-- blobs, neither of which this removes. The empty `listings`/`sales` placeholder
-- tables (created by the init migration, never populated — the app uses blobs)
-- are recreated with the real normalized schema.

create extension if not exists pg_trgm;

-- ─────────── Dimensions (seeded from code config: sources.ts / ipCatalog.ts) ───────────
create table if not exists platforms (
  platform_id     text primary key,
  name            text not null,
  chain           text not null,
  vault_provider  text,
  native_currency text,
  has_marketplace boolean not null default true,
  has_gacha       boolean not null default false,
  collections     jsonb not null default '[]',   -- on-chain collection addresses
  config          jsonb not null default '{}',   -- marketplace/gacha/fee wallets, validAmounts…
  status          text not null default 'active',-- active | onboarding | paused
  added_at        timestamptz not null default now()
);

create table if not exists categories (
  category_id text primary key,                  -- 'pokemon' | 'one_piece' | …
  name        text not null,
  short       text,
  kind        text,                              -- tcg | sport | sealed | streetwear | other
  color       text,
  logo        text,
  display     jsonb not null default '{}'        -- emoji, iconBlendMode, sort
);

create table if not exists sets (
  set_id       text primary key,
  category_id  text,
  name         text not null,
  release_year int,
  aliases      jsonb not null default '[]'
);

-- ─────────── Per-platform card instances (the existing `cards` table, evolved) ───────────
-- Rename → card_instances + the canonical `cards` table arrive in Phase 2 (view bridge).
alter table cards add column if not exists canonical_card_id text;  -- Phase-2 canonical link
alter table cards add column if not exists token_standard    text;  -- ERC721 | CNFT | SPL
alter table cards add column if not exists grader            text;
alter table cards add column if not exists grade_num         numeric;
alter table cards add column if not exists year              int;
alter table cards add column if not exists card_number       text;
alter table cards add column if not exists fmv_usd           numeric;
create index if not exists cards_canonical_idx on cards (canonical_card_id);

-- ─────────── Marketplace facts (recreate empty placeholders with real schema) ───────────
drop table if exists listings cascade;
create table listings (
  listing_id        text primary key,
  platform_id       text not null,
  instance_id       text,                        -- → cards.id (soft ref)
  canonical_card_id text,                        -- → cards.canonical_card_id (Phase 2)
  category_id       text,
  price_usd         numeric not null,
  price_native      numeric,
  currency          text,
  venue             text,                        -- OPEN_SEA | TENSOR | MAGIC_EDEN | native
  status            text not null default 'active',
  listed_at         timestamptz,
  source            text not null,
  updated_at        timestamptz not null default now()
);
create index listings_platform_price_idx on listings (platform_id, price_usd);
create index listings_category_price_idx on listings (category_id, price_usd);
create index listings_canonical_idx      on listings (canonical_card_id);

drop table if exists sales cascade;
create table sales (
  sale_id           text primary key,            -- platform:txid:logIndex
  platform_id       text not null,
  instance_id       text,
  canonical_card_id text,
  category_id       text,
  sale_type         text not null,               -- marketplace | gacha_pull | buyback | mint | burn
  price_usd         numeric not null,
  price_native      numeric,
  currency          text,
  buyer             text,
  seller            text,
  venue             text,
  tx_hash           text,
  source            text not null,
  sold_at           timestamptz not null
);
create index sales_time_idx           on sales (sold_at desc);
create index sales_platform_time_idx  on sales (platform_id, sold_at desc);
create index sales_canonical_time_idx on sales (canonical_card_id, sold_at desc);
create index sales_category_time_idx  on sales (category_id, sold_at desc);
create index sales_type_time_idx      on sales (sale_type, sold_at desc);

-- ─────────── Gacha ───────────
create table if not exists gacha_products (
  product_id  text primary key,                  -- 'phygitals:starter-one-piece-pack' | 'cc:100'
  platform_id text not null,
  category_id text,
  name        text,
  claw_id     text,
  price_usd   numeric,
  odds_stated jsonb,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table if not exists gacha_pulls (
  pull_id            text primary key,
  platform_id        text not null,
  product_id         text,
  buyer              text,
  price_usd          numeric,
  prize_instance_id  text,                        -- → cards.id (card pulled)
  prize_canonical_id text,                        -- canonical id of the prize ("which pack pulls X")
  prize_value_usd    numeric,
  tx_hash            text,
  source             text not null,
  pulled_at          timestamptz not null
);
create index gacha_pulls_product_idx on gacha_pulls (product_id, pulled_at desc);
create index gacha_pulls_prize_idx   on gacha_pulls (prize_canonical_id);  -- reverse lookup

create table if not exists gacha_metrics (
  scope        text not null,                     -- platform | platform_category | price_tier
  scope_id     text not null,                     -- 'phygitals' | 'phygitals:pokemon' | 'cc:100'
  period       text not null,                     -- 24h | 7d | 30d
  pulls        int,
  volume_usd   numeric,
  buyback_usd  numeric,
  net_usd      numeric,
  take_pct     numeric,
  odds         jsonb,
  generated_at timestamptz not null,
  source       text not null default 'dune',
  primary key (scope, scope_id, period)
);

-- ─────────── Precomputed metrics (supersedes platform_metrics + ip_metrics) ───────────
create table if not exists entity_metrics (
  entity_type   text not null,                    -- market | platform | category | set | card | platform_category
  entity_id     text not null,
  period        text not null default '24h',      -- 24h | 7d | 30d | all
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
  primary key (entity_type, entity_id, period)
);
create index entity_metrics_mcap_idx on entity_metrics (entity_type, period, mcap_usd desc nulls last);
create index entity_metrics_vol_idx  on entity_metrics (entity_type, period, vol_usd desc nulls last);

-- ─────────── Support ───────────
create table if not exists token_prices (
  token  text primary key,
  usd    numeric not null,
  as_of  timestamptz not null,
  source text default 'coingecko'
);

-- ─────────── RLS (server uses the service key; browser never reads directly) ───────────
alter table platforms      enable row level security;
alter table categories     enable row level security;
alter table sets           enable row level security;
alter table listings       enable row level security;
alter table sales          enable row level security;
alter table gacha_products enable row level security;
alter table gacha_pulls    enable row level security;
alter table gacha_metrics  enable row level security;
alter table entity_metrics enable row level security;
alter table token_prices   enable row level security;
