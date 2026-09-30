-- Renaiss — two row stores and two `cards` columns:
--   • renaiss_sales: the store behind Renaiss's resale volume, its sale-panel leg
--     and its daily resale spine;
--   • renaiss_pulls: its pack pulls, behind its pack spend in core-volume and
--     the spine;
--   • cards.language and cards.cert, which its feed names and no other does.
--
-- renaiss_sales source: GET https://api.renaissos.com/v1/renaiss/sales,
-- Renaiss's own index API, paged in by scripts/warm-renaiss-sales.ts. One row
-- per `TradeExecutedV2` log on BNB Smart Chain. `sale_id` is the feed's own
-- `id`, `{txHash}:{logIndex}`, so a re-read page upserts in place and an
-- overlapping run is harmless.
--
-- ⚠️ USDT IS COUNTED AS USD, in both stores. Renaiss settles in BSC-USD (USDT).
-- `price` is the exact amount in `currency` as the feed prints it; `price_usd`
-- is the feed's `priceUsdCents` / 100: a dollar stablecoin taken at a dollar,
-- the way USDC is everywhere else in this database.
--
-- The seller's fee is not in the feed (it is on the log the id names), so
-- `price_usd` is the price the buyer paid.
--
-- RLS is enabled on both tables with no policies: anon gets nothing; the
-- warmers use the service role (the dyli_sales pattern).
--
-- ⚠️ APPLIED BY THE ORCHESTRATOR, before the first `--apply` run of either
-- Renaiss warmer. The executor never applies it.

create table if not exists public.renaiss_sales (
  sale_id          text primary key,            -- {txHash}:{logIndex}
  block_number     bigint not null,
  sold_at          timestamptz not null,        -- block time, UTC
  contract         text not null,               -- the ERC-721 card contract
  token_id         text not null,               -- decimal string (a 77-digit id)
  seller           text,
  buyer            text,
  currency         text not null,               -- USDT (BSC-USD)
  price            text,                        -- the exact decimal string, in `currency`
  price_usd        numeric,                     -- priceUsdCents / 100 (USDT as USD)
  -- The slab and its card: null until Renaiss's index links the token to its cert.
  cert             text,                        -- grader-prefixed, e.g. PSA119571435
  grader           text,                        -- the slab's `company`
  grade_raw        text,                        -- as the grader prints it: "10 Gem Mint"
  catalog_id       text,
  renaiss_item_id  text,
  card_name        text,
  set_name         text,
  set_code         text,
  card_number      text,
  year             int,
  language         text,
  image_url        text,
  raw              jsonb not null               -- the feed row, verbatim
);

-- The incremental cursor (newest sold_at) and every window read go by time.
create index if not exists renaiss_sales_sold_at_idx on public.renaiss_sales (sold_at desc);

alter table public.renaiss_sales enable row level security;

-- ── cards: the two fields Renaiss's feed names and no other feed does ─────────
-- `language`: the identity extractor reads it for Renaiss rows (traits.ts). The
-- name never carries it, and without it the Japanese and the English card of one
-- set would key as one identity once the set key folds their set strings
-- together. Readers select it behind a guard until this migration is applied.
-- `cert`: the grader's cert, shown on the card page; the key Renaiss's own
-- `/graded` lookup takes.
alter table public.cards add column if not exists language text;
alter table public.cards add column if not exists cert text;

-- ── renaiss_pulls: pack pulls, in their own table ────────────────────────────
-- Source: GET https://api.renaissos.com/v1/gacha/pulls?platform=renaiss, paged
-- in by scripts/warm-renaiss-pulls.ts. `pull_id` is the feed's own `id`.
--
-- ⚠️ NOT gacha_pulls. Renaiss's pull history was measured at roughly 800,000
-- rows (four anonymous samples, Sep 30), and player analytics scans every
-- gacha_pulls row daily (31.4 min of the daily job's 75 on Sep 30). Kept apart,
-- Renaiss is simply absent from player analytics. `platform_id` and `source`
-- are not carried: in a one-venue table they are constants, as in renaiss_sales.
--
-- ⚠️ A PRIZE WRITES NO `cards` ROW (distinct prizes run close to one per pull),
-- so the pull row carries its prize's identity key and card fields itself.
-- `prize_instance_id` is `rn-<tokenId>`; a `cards` row exists for it only if the
-- token has sold.
--
-- `price_usd` is the price paid in USDT, counted as USD; null for an `observed`
-- row (a draw seen before its checkout is matched), which is never spend.
-- `prize_value_usd` is the value Renaiss STATES for the prize, never a price.
create table if not exists public.renaiss_pulls (
  pull_id             text primary key,         -- the feed's id
  kind                text not null,            -- checkout | observed
  product_id          text not null,            -- the machine (pack) id
  buyer               text,
  price_usd           numeric,                  -- pricePaid, USDT as USD; null when observed
  tx_hash             text,
  pulled_at           timestamptz not null,
  prize_instance_id   text,                     -- rn-<tokenId> once named
  prize_canonical_id  text,                     -- the prize's identity key
  prize_value_usd     numeric,                  -- as stated by Renaiss
  prize_card_name     text,
  prize_set_name      text,
  prize_card_number   text,
  prize_grade_label   text,                     -- "PSA 10", composed through parseGrade
  prize_cert          text,
  prize_language      text
);

-- The cursor, the re-read window and every spend read go by time.
create index if not exists renaiss_pulls_pulled_at_idx on public.renaiss_pulls (pulled_at desc);

alter table public.renaiss_pulls enable row level security;
