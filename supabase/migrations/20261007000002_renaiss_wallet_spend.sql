-- Renaiss players: lifetime pack spend per wallet, aggregated in the database
-- (brief-backend-gacha-renaiss, PR A, item 4).
--
-- ⚠️ THE REPO'S FIRST RPC. Every other aggregate pages rows through PostgREST
-- and folds them in app code; that is a full scan of ~720,000 rows at 1,000 a
-- page for this one, and the daily job already timed out doing the same for
-- gacha_pulls (player analytics, 38.6 min on Oct 6). Grouping by wallet here
-- returns one row per wallet instead. Tiers, concentration and active-30d stay
-- in app code (src/lib/renaiss/players.ts), in the shape every other venue's
-- player analytics has.
--
-- Called as db().rpc("renaiss_wallet_spend").order("buyer").range(…), so a page
-- of wallets is a stable slice. Pack spend is checkout rows only (`price_usd`
-- is null on an `observed` row, which is never spend), the same rule as
-- core-volume and the spine.
--
-- ⚠️ Wallet addresses leave the database only to the warmer that aggregates
-- them; the snapshot it writes carries counts, sums and shares, never an
-- address (the privacy rule in playerAnalytics.ts).

create or replace function public.renaiss_wallet_spend()
returns table (
  buyer      text,
  spend      numeric,
  pulls      bigint,
  first_pull timestamptz,
  last_pull  timestamptz
)
language sql
stable
set search_path = public
as $$
  select p.buyer,
         sum(p.price_usd)  as spend,
         count(*)          as pulls,
         min(p.pulled_at)  as first_pull,
         max(p.pulled_at)  as last_pull
  from public.renaiss_pulls p
  where p.buyer is not null
    and p.price_usd > 0
  group by p.buyer
$$;

-- Service role only: the warmer calls it; no page, no anon key.
revoke all on function public.renaiss_wallet_spend() from public;
revoke all on function public.renaiss_wallet_spend() from anon, authenticated;
grant execute on function public.renaiss_wallet_spend() to service_role;
