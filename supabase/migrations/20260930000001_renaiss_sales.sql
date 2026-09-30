-- Renaiss marketplace sales — the row store behind Renaiss's resale volume, its
-- sale-panel leg and its daily spine; the two `cards` columns its feed names;
-- and the index its pack-spend reads need on `gacha_pulls`.
--
-- Source: GET https://api.renaissos.com/v1/renaiss/sales, Renaiss's own index
-- API, paged in by scripts/warm-renaiss-sales.ts. One row per `TradeExecutedV2`
-- log on BNB Smart Chain. `sale_id` is the feed's own `id`, `{txHash}:{logIndex}`,
-- so a re-read page upserts in place and an overlapping run is harmless.
--
-- ⚠️ USDT IS COUNTED AS USD. Renaiss settles in BSC-USD (USDT). `price` is the
-- exact amount in `currency` as the feed prints it; `price_usd` is the feed's
-- `priceUsdCents` / 100: a dollar stablecoin taken at a dollar, the way USDC is
-- everywhere else in this database.
--
-- The seller's fee is not in the feed (it is on the log the id names), so
-- `price_usd` is the price the buyer paid.
--
-- RLS is enabled with no policies: anon gets nothing; the warmer uses the
-- service role (the dyli_sales pattern).
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

-- ── gacha_pulls: one platform's rows by time ─────────────────────────────────
-- Renaiss's pack spend (core-volume's rolling 24h and 7d, the spine's daily
-- sums) and its warmer's cursor read one platform's rows by `pulled_at`. The
-- table's indexes are on product, prize and memo slug only, so without this each
-- of those pages scans the whole table (~1.5M rows). A plain build takes a brief
-- write lock on gacha_pulls.
create index if not exists gacha_pulls_platform_pulled_idx
  on public.gacha_pulls (platform_id, pulled_at desc);
