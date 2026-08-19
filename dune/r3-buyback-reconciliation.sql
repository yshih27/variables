-- TCG.market — R3 BUYBACK RECONCILIATION (one-shot, NOT on any schedule)
-- Slot: 7644128, repurposed from the dormant "TCG.market — CC buyback" (its SQL
-- is preserved in dune/superseded/buyback-cc.7644128.sql). The 402 private-query
-- cap blocks CREATE, not UPDATE, so closing R3 meant overwriting a dead slot.
--
-- PURPOSE. docs/roadmap/net-gacha-reconciliation.md §6 R3: "a payout counts only
-- if the recipient has spent in." This query measures that rule instead of
-- arguing about it, and returns the CURRENT-counting figures beside it so the
-- delta is attributable to R3 alone — same execution, same 35d window, same
-- `now()`, so nothing can drift between the two columns.
--
-- ⚠️ ONE ROW PER PLATFORM. 2 rows × ~20 cols is a trivial export; the cost here
-- is COMPUTE (two scans of tokens_solana.transfers), not the read.
-- ⚠️ RUN ONCE, BY HAND. Nothing in src/ references this id. Do not schedule it.
--
-- WINDOW: 35d on BOTH legs, matching 8252734/8252735 so the spend and payout
-- sides stay like-for-like. §6 R3 suggested a 90d trailing spender window; 35d is
-- TIGHTER, so it disqualifies more recipients and REMOVES more payout. The R3
-- net below is therefore an UPPER bound on net relative to R3@90d. A player who
-- spent 40 days ago and cashed out last week is invisible to this window.

WITH inflow AS (
  -- Every USDC payment INTO a platform's gacha receivers, house senders removed.
  -- Two grains at once: `is_canon` reproduces the published spend leg's filter,
  -- the unfiltered rows answer §4's gross-vs-canonical (press-gap) question.
  SELECT 'collector-crypt' AS platform,
         from_owner AS wallet,
         amount/power(10,6) AS usd,
         amount/power(10,6) IN (25,50,75,80,100,151,250,1000,2500,5000) AS is_canon
  FROM tokens_solana.transfers
  WHERE to_owner IN ('GachazZscHZ5bn3vnq1yEC4zpYdhAYJBzuKJwSJksc9z','GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3','96DULv1BqYfe5wyMr6pVUNC6Uyrtj6yr3tNi6VtfwW9s')
    AND from_owner NOT IN ('BAxTk97HsaJqbnbFmTiQTaL4KSRvJ8Y65ArZCsP6vA5M','21KhtC7y2JGYvwc8dcGqTdbrudbM8fgMPJsVwxRQqdY8','DFEstpYN3fsz93AC9v2ujzPPngPgodqH2xxopuyfSsAE','HW2HRqN1pXQGH9GfP9xet4XwqtLqFyYGDNRKjUAVgh9u','HighJBfnAaqH9cKkeMErQFJZ4ATxQJwxqFupX6zaKTns','LGNDXqcm6U57QQ6Ad7icZ6oizkAVKRWrw97KwZy5nVf','EpicWWZspT1trKndbDDr29ULViN56rN5vofWSKZp8ePF','Mid9NeCpPNxP59fAdsLgMLy7BYexxXFw52ZP58Jrney','Lowq9dkpY43VpjfYeRjtKfGA6JtB7HaMmwQgXkjHLvN','Low6UekJP3QrFVMfNRTL8CPK2SiGFhvp57sgF2pkmVu','miDtj3vgdxVykHzRyFwyG8MXpvK8eQqamSLVdBr7WPt','HiGHqwYddP5N2waqUmXPdaASpMpUEvfqPr2fSawctEb','epiC3zkqa1RfcPMMM1Kc8m3GZGDwF2RmjbfA3g1BBjn','LGNDfXQFMiRMz3qqTNAREmRFQutMvazqqRrzn5i98uj','SPrT7eFrCM9UJ4j7Xf9iktKCoBwJjfykFbiNbRsKQm8')
    AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    AND block_time > now() - interval '35' day

  UNION ALL

  SELECT 'phygitals' AS platform,
         from_owner AS wallet,
         amount/power(10,6) AS usd,
         amount/power(10,6) >= 1 AS is_canon
  FROM tokens_solana.transfers
  WHERE to_owner IN ('62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS','42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e')
    AND from_owner NOT IN ('62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS','42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e','5sn2nniGv88bxzxBDkqWP6i8bejsr9WwCpZXq2ZkLHgf')
    AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    AND block_time > now() - interval '35' day
),

spenders AS (
  -- THE R3 SET. Any address that actually paid this platform's gacha receivers
  -- in the window. Deliberately built off GROSS inflow, not the canonical price
  -- allowlist: the question R3 asks is "is this counterparty a customer", and a
  -- non-tier payment still proves that. Gross is also the CONSERVATIVE choice —
  -- a wider spender set counts MORE payouts, so it lowers the resulting net.
  -- House wallets cannot leak in: `inflow` already drops the spend leg's
  -- excluded senders, which is what makes R3 list-free downstream.
  SELECT DISTINCT platform, wallet FROM inflow WHERE usd > 0
),

spenders_canon AS (
  SELECT DISTINCT platform, wallet FROM inflow WHERE is_canon AND usd > 0
),

outflow AS (
  -- Every USDC payment OUT of the gacha wallets. Scanned over the SYMMETRIC
  -- wallet set (§6 R1: CC 3, PHY 2) so R1's effect is measurable; the flags then
  -- carve out the narrower set the live query actually reads, so
  -- `payout_current_usd` below reproduces the published figure exactly.
  SELECT 'collector-crypt' AS platform,
         to_owner AS wallet,
         amount/power(10,6) AS usd,
         from_owner IN ('GachazZscHZ5bn3vnq1yEC4zpYdhAYJBzuKJwSJksc9z','GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3') AS in_live_scope,
         to_owner NOT IN ('BAxTk97HsaJqbnbFmTiQTaL4KSRvJ8Y65ArZCsP6vA5M','21KhtC7y2JGYvwc8dcGqTdbrudbM8fgMPJsVwxRQqdY8','DFEstpYN3fsz93AC9v2ujzPPngPgodqH2xxopuyfSsAE','HW2HRqN1pXQGH9GfP9xet4XwqtLqFyYGDNRKjUAVgh9u','HighJBfnAaqH9cKkeMErQFJZ4ATxQJwxqFupX6zaKTns','LGNDXqcm6U57QQ6Ad7icZ6oizkAVKRWrw97KwZy5nVf','EpicWWZspT1trKndbDDr29ULViN56rN5vofWSKZp8ePF','Mid9NeCpPNxP59fAdsLgMLy7BYexxXFw52ZP58Jrney','Lowq9dkpY43VpjfYeRjtKfGA6JtB7HaMmwQgXkjHLvN','Low6UekJP3QrFVMfNRTL8CPK2SiGFhvp57sgF2pkmVu','miDtj3vgdxVykHzRyFwyG8MXpvK8eQqamSLVdBr7WPt','HiGHqwYddP5N2waqUmXPdaASpMpUEvfqPr2fSawctEb','epiC3zkqa1RfcPMMM1Kc8m3GZGDwF2RmjbfA3g1BBjn','LGNDfXQFMiRMz3qqTNAREmRFQutMvazqqRrzn5i98uj','SPrT7eFrCM9UJ4j7Xf9iktKCoBwJjfykFbiNbRsKQm8','Cc4pHGnoaRWL1WnHsV517T3YvQn5gLDBMiuVXkF9rZhK','8373hLiAEXxaJ3oV7SRzx4KHwurEg9rEG98tUPj1sdtX') AS not_excluded
  FROM tokens_solana.transfers
  WHERE from_owner IN ('GachazZscHZ5bn3vnq1yEC4zpYdhAYJBzuKJwSJksc9z','GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3','96DULv1BqYfe5wyMr6pVUNC6Uyrtj6yr3tNi6VtfwW9s')
    AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    AND block_time > now() - interval '35' day

  UNION ALL

  SELECT 'phygitals' AS platform,
         to_owner AS wallet,
         amount/power(10,6) AS usd,
         from_owner IN ('62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS') AS in_live_scope,
         to_owner NOT IN ('42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e','5sn2nniGv88bxzxBDkqWP6i8bejsr9WwCpZXq2ZkLHgf') AS not_excluded
  FROM tokens_solana.transfers
  WHERE from_owner IN ('62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS','42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e')
    AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    AND block_time > now() - interval '35' day
),

o AS (
  SELECT f.platform,
         f.usd,
         f.in_live_scope,
         f.not_excluded,
         s.wallet IS NOT NULL AS is_spender,
         c.wallet IS NOT NULL AS is_spender_canon,
         f.wallet
  FROM outflow f
  LEFT JOIN spenders       s ON s.platform = f.platform AND s.wallet = f.wallet
  LEFT JOIN spenders_canon c ON c.platform = f.platform AND c.wallet = f.wallet
),

in_agg AS (
  SELECT platform,
         CAST(SUM(usd) AS DOUBLE) AS inflow_gross_usd,
         CAST(SUM(CASE WHEN is_canon THEN usd END) AS DOUBLE) AS inflow_canon_usd,
         CAST(COUNT(DISTINCT wallet) AS BIGINT) AS spenders_gross_n,
         CAST(COUNT(DISTINCT CASE WHEN is_canon THEN wallet END) AS BIGINT) AS spenders_canon_n
  FROM inflow WHERE usd > 0 GROUP BY platform
),

out_agg AS (
  SELECT platform,
         -- (a) EXACTLY what ships today: live sender scope + hand-curated
         --     exclusion list + no spender test. Must equal §5's figure.
         CAST(SUM(CASE WHEN in_live_scope AND not_excluded THEN usd END) AS DOUBLE) AS payout_current_usd,
         -- (b) R3 held to the live scan scope — the clean, single-variable delta
         --     against (a). Exclusion list dropped: R3 is meant to replace it.
         CAST(SUM(CASE WHEN in_live_scope AND is_spender THEN usd END) AS DOUBLE) AS payout_r3_usd,
         -- (c) R3 + the exclusion list kept. If (b) and (c) differ, a known house
         --     wallet also spends in, and R3 alone would readmit it.
         CAST(SUM(CASE WHEN in_live_scope AND is_spender AND not_excluded THEN usd END) AS DOUBLE) AS payout_r3_excl_usd,
         -- (d) R3 on the canonical spender set — the stricter reading of §6 R3.
         CAST(SUM(CASE WHEN in_live_scope AND is_spender_canon THEN usd END) AS DOUBLE) AS payout_r3_canon_usd,
         -- (e) R1+R3 together: symmetric wallet set AND the spender test.
         CAST(SUM(CASE WHEN is_spender THEN usd END) AS DOUBLE) AS payout_r1r3_usd,
         -- (f) the whole outbound universe over the symmetric set, unfiltered.
         CAST(SUM(usd) AS DOUBLE) AS outflow_gross_usd,
         CAST(COUNT(DISTINCT wallet) AS BIGINT) AS recipients_n,
         CAST(COUNT(DISTINCT CASE WHEN is_spender THEN wallet END) AS BIGINT) AS recipients_spender_n,
         CAST(COUNT(DISTINCT CASE WHEN in_live_scope AND not_excluded THEN wallet END) AS BIGINT) AS recipients_current_n
  FROM o GROUP BY platform
)

SELECT i.platform,
       i.inflow_canon_usd,
       i.inflow_gross_usd,
       i.spenders_gross_n,
       i.spenders_canon_n,
       a.payout_current_usd,
       a.payout_r3_usd,
       a.payout_r3_excl_usd,
       a.payout_r3_canon_usd,
       a.payout_r1r3_usd,
       a.outflow_gross_usd,
       a.recipients_n,
       a.recipients_current_n,
       a.recipients_spender_n
FROM in_agg i JOIN out_agg a ON a.platform = i.platform
ORDER BY i.platform
