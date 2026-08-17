-- DYLI sales row store — the raw, classified feed behind DYLI's daily spine
-- metrics and its core-volume bucket.
--
-- Why its own table rather than public.sales: DYLI's feed carries the channel
-- fields the lane classification depends on (market_type / sale_channel /
-- sale_event_type / source_marketplace) plus the derived `lane`, and none of
-- those exist on public.sales. Keeping the raw channel values next to the lane
-- means a future re-classification is a pure re-derive — no refetch of ~400K
-- rows at 30 req/min.
--
-- `sale_id` is DYLI's own primary key for the sale and is the dedupe key, so a
-- re-run of any page is idempotent (upsert on conflict).
--
-- RLS is enabled with no policies — anon gets nothing; the warmer uses the
-- service role. Matches the report_subscribers pattern.

create table if not exists public.dyli_sales (
  sale_id            bigint primary key,
  token_id           text,
  product_id         bigint,
  product_name       text,
  market_type        text,
  sale_channel       text,
  sale_event_type    text,
  source_marketplace text,
  -- Derived by classifyDyliLane() — marketplace | gacha | direct | excluded.
  -- Stored so the spine derives from one agreed classification and a change to
  -- the classifier is auditable against what was previously published.
  lane               text not null,
  sold_at            timestamptz not null,
  price_usd          numeric,
  -- Counterparty wallets. Stored because the core-volume bucket reports unique
  -- buyers/sellers for the 24h window; without them that stat would be a
  -- confident-looking 1, which is worse than no number at all.
  buyer              text,
  seller             text
);

-- Daily spine derivation groups by (lane, day); the recent-sales list and the
-- 24h/7d bucket aggregates read the newest rows.
create index if not exists dyli_sales_sold_at_idx      on public.dyli_sales (sold_at desc);
create index if not exists dyli_sales_lane_sold_at_idx on public.dyli_sales (lane, sold_at desc);

alter table public.dyli_sales enable row level security;
