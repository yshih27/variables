-- TCG.market — initial schema (Phase 0)
-- Dedicated web3 dashboard DB. Replaces the local ./.cache/ disk store.
-- See MIGRATION_PLAN.md §3. Money = numeric (never float). All times timestamptz.
-- Idempotent: safe to re-run (create if not exists).

-- ───────────────────────── cards (the atomic unit) ─────────────────────────
-- Replaces .cache/cc-traits/* (122K files) + .cache/beezie-traits/*.
-- Store ONLY the fields the app uses (~400B/row, not the ~3.9KB raw DAS asset).
create table if not exists public.cards (
  id                text primary key,            -- 'cc-<mint>' | 'bz-<tokenId>' (src/lib/card/ids.ts)
  platform          text not null,               -- collector-crypt | beezie | phygitals | courtyard
  token_id          text not null,               -- Solana mint or ERC-721 tokenId
  chain             text not null,               -- Solana | Base | Polygon
  name              text,
  card_name         text,                        -- normalized display name (traits.cardName)
  ip_key            text,                        -- classifyIP() result: pokemon, one_piece, ...
  set_name          text,
  grade             text,
  grade_label       text,
  category          text,
  image             text,
  image_fallback    text,
  insured_value_usd numeric,                     -- CC "Insured Value" trait → mcap input
  attributes        jsonb,                       -- cleaned label/value pairs used by /card/[id]
  source            text not null,               -- helius-das | beezie-tokenuri
  updated_at        timestamptz not null default now(),
  unique (platform, token_id)
);
create index if not exists cards_ip_key_idx       on public.cards (ip_key);
create index if not exists cards_platform_idx     on public.cards (platform);
create index if not exists cards_card_name_idx    on public.cards (lower(card_name));
create index if not exists cards_insured_desc_idx on public.cards (insured_value_usd desc nulls last);

-- ───────────────────────── listings (cheapest active per token) ─────────────────────────
-- Replaces .cache/listings.json.
create table if not exists public.listings (
  item_id    text primary key,                   -- 'POLYGON:0x..:tokenId' | 'SOLANA:mint'
  platform   text not null,
  token_id   text not null,
  price_usd  numeric not null,
  source     text not null,                      -- OPEN_SEA | RARIBLE | COLLECTOR_CRYPT
  updated_at timestamptz not null default now()
);
create index if not exists listings_platform_idx on public.listings (platform);
create index if not exists listings_price_idx    on public.listings (price_usd);

-- ───────────────────────── sales (raw — NEW: real history + per-card logs) ─────────────────────────
-- Idempotent on tx-derived id. Retain raw ~90d; roll older into metric_snapshots.
create table if not exists public.sales (
  id           text primary key,                 -- 'platform:txid:logIndex'
  platform     text not null,
  token_id     text not null,
  price_usd    numeric not null,
  price_native numeric,
  currency     text,
  buyer        text,
  seller       text,
  source       text not null,                    -- rarible | helius | dune
  sold_at      timestamptz not null
);
create index if not exists sales_sold_at_idx       on public.sales (sold_at desc);
create index if not exists sales_platform_time_idx on public.sales (platform, sold_at desc);
create index if not exists sales_token_idx         on public.sales (platform, token_id);
create index if not exists sales_price_desc_idx    on public.sales (price_usd desc);

-- ───────────────────────── platform_metrics (precomputed → PlatformRow) ─────────────────────────
create table if not exists public.platform_metrics (
  platform        text primary key,              -- courtyard | beezie | collector-crypt | phygitals
  vol_24h_usd     numeric,
  vol_7d_usd      numeric,
  primary_24h_usd numeric,                        -- null = not tracked (renders "—", not 0)
  active_24h      int,
  cards_24h       int,
  trades_24h      int,
  holders         int,
  avg_trade_usd   numeric,
  spark           jsonb,                          -- number[]
  trend           text,                           -- up | down | flat
  source          text,
  generated_at    timestamptz not null
);

-- ───────────────────────── ip_metrics (precomputed → IPRow) ─────────────────────────
create table if not exists public.ip_metrics (
  ip_key              text primary key,
  cards               int,
  cards_valued        int,
  platforms           int,
  holders             int,
  holders_by_platform jsonb,
  buyers_24h          int,
  trades_24h          int,
  vol_24h_usd         numeric,
  vol_7d_usd          numeric,
  vol_total_usd       numeric,
  mcap_usd            numeric,
  floor_usd           numeric,
  insured_usd         numeric,
  pct_7d              numeric,
  trend               text,
  spark               jsonb,
  top_card            text,
  source              text,
  generated_at        timestamptz not null
);

-- ───────────────────────── metric_snapshots (the time-series spine) ─────────────────────────
-- Replaces marketcap-history.json + history/{platform}.json; extends to ip & card.
-- Start writing in Phase 2 — you can't backfill history you never recorded.
create table if not exists public.metric_snapshots (
  entity_type text not null,                      -- market | platform | ip | card
  entity_key  text not null,                      -- 'total' | platform key | ip key | card id
  metric      text not null,                      -- volume_usd | mcap_usd | floor_usd | holders
  value       numeric not null,
  ts          timestamptz not null,
  primary key (entity_type, entity_key, metric, ts)
);
create index if not exists metric_snapshots_lookup_idx
  on public.metric_snapshots (entity_type, entity_key, metric, ts desc);

-- ───────────────────────── snapshots (blob singletons, e.g. gacha) ─────────────────────────
-- Replaces gacha-dune.json. fetchGacha reads one whole GachaDuneSnapshot object.
create table if not exists public.snapshots (
  key          text primary key,                  -- 'gacha' | ...
  payload      jsonb not null,
  generated_at timestamptz not null
);

-- ───────────────────────── source_freshness (the honest "as of") ─────────────────────────
-- Every warmer writes one row here on completion. UI reads it for provenance.
create table if not exists public.source_freshness (
  source           text primary key,              -- gacha-dune | listings | marketcap | holders | cc-sales | cc-traits | beezie-traits | history
  generated_at     timestamptz not null,
  status           text not null default 'ok',    -- ok | stale | error
  rows_written     int,
  duration_ms      int,
  error            text,
  next_expected_at timestamptz
);

-- ───────────────────────── RLS (enabled; no anon policies) ─────────────────────────
-- Server components + warmers use the service-role key (bypasses RLS). The browser
-- never queries Supabase directly. Add read-only SELECT policies later only if
-- client-side reads are introduced. (Deliberately avoids Fuda's RLS-disabled exposure.)
alter table public.cards            enable row level security;
alter table public.listings         enable row level security;
alter table public.sales            enable row level security;
alter table public.platform_metrics enable row level security;
alter table public.ip_metrics       enable row level security;
alter table public.metric_snapshots enable row level security;
alter table public.snapshots        enable row level security;
alter table public.source_freshness enable row level security;
