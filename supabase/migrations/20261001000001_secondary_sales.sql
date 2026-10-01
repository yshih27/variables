-- secondary_sales — every resale we read, kept. The history the price index
-- will be read from (brief-backend-index-every-venue.md, B1 then B2).
--
-- Why: every venue's resale reaches the sale panel through a 30-day window that
-- each core run OVERWRITES (the `secondary-sales` snapshot: Collector Crypt from
-- Dune query 7675297, Courtyard from Rarible's activity index; Beezie live from
-- its /activity feed). A month's rows age out before the next month can be
-- compared with it, so Collector Crypt — the deeper market — has never reached
-- an index step. This table keeps every row the core run already fetches,
-- written idempotently on every run. Nothing reads it yet.
--
-- `sale_id` = `<platform>:<transaction or signature>:<index>`:
--   • collector-crypt  `collector-crypt:<tx_id>:0` once query 7675297 selects
--     tx_id (dune/cc-secondary.sql; the query yields one sale per transaction).
--     Until then the natural key `collector-crypt:<mint>:<block_time>:<price>:<buyer>`.
--   • courtyard        `courtyard:<transactionHash>:<Rarible activity id>`
--   • beezie           `beezie:<transactionHash>:<Beezie activity id>`
--   • rows seeded from the snapshot carry no id: the natural key, as above.
-- Rows are stored BEFORE hygiene (duplicates, self-trades, ring washes and
-- sweeps are dropped at read, as today), with the feed row verbatim in `raw`.
--
-- RLS is enabled with no policies: anon gets nothing; the warmers use the
-- service role (the dyli_sales pattern). One module touches this table:
-- src/lib/data/salesStore.ts.
--
-- ⚠️ APPLIED BY THE ORCHESTRATOR. The same day, run the seed
--   npx tsx scripts/sales-store.ts --seed-from-snapshot --apply
-- every day before that loses a day of Collector Crypt's oldest rows from the
-- 30-day window, recoverable afterwards only through a paid Dune backfill.

create table if not exists public.secondary_sales (
  sale_id    text primary key,
  platform   text not null,          -- collector-crypt | courtyard | beezie
  sold_at    timestamptz not null,
  token_id   text not null,
  buyer      text,
  seller     text,
  price_usd  numeric not null,       -- USDC / USDC.e at a dollar, as everywhere else
  currency   text,                   -- USDC, or the Rarible payment asset
  source     text not null,          -- dune:7675297 | rarible:activity | beezie:/activity | snapshot:secondary-sales
  raw        jsonb
);

-- Every read is one venue's rows by time.
create index if not exists secondary_sales_platform_sold_at_idx
  on public.secondary_sales (platform, sold_at desc);

alter table public.secondary_sales enable row level security;
