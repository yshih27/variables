-- TCG.market — gacha BUYBACK payouts · ALL PLATFORMS · DAILY · R3-COUNTED
-- ONE execution replacing two: 7644128 (CC) / 7644129 (Phygitals) — both of those
-- ids have since been reclaimed for the R3 diagnostics, see dune/README.md.
--
-- ⚠️ BASIS CHANGE (2026-08-19). `payout_usd` is now R3-COUNTED: an outflow counts
-- as a player payout ONLY where the recipient also SPENT INTO this platform's
-- gacha receivers inside the same 35d window. Before this date it was every
-- outflow minus a hand-curated internal-wallet list. The old definition has not
-- been deleted — it is now `outflow_gross_usd`, the second series, which is what
-- the panel's "Outbound to players & partners (gross)" row and the buyback-rate
-- ⓘ read. Measured 2026-08-19 (docs/roadmap/net-gacha-reconciliation.md
-- Addendum A): R3 keeps 99.6% of CC's outflow_gross and 98.1% of Phygitals'.
--
-- ⚠️ SPINE ROWS OLDER THAN THE WINDOW ARE STILL GROSS-BASIS. This query rewrites
-- only the trailing 35d, so `buyback_payout_usd` days before the switchover keep
-- their pre-R3 values. Every reader uses 24h/7d/30d windows, which sit inside the
-- rewritten range — do NOT sum this metric past 35d without re-deriving it.
--
-- WHY R3 AND NOT A LONGER EXCLUSION LIST (§3d, §6): the list approach works
-- exactly as far as someone hand-curated it. Measured, R3 STRICTLY SUBSUMES both
-- platforms' lists — every excluded wallet is already a non-spender — and removes
-- $619K more on CC that the list never knew about. It needs no vendor list and
-- maintains itself. `gacha_pulls.buyer` is 100% populated, so the spender set is
-- also independently checkable against Postgres.
--
-- ⚠️ NOT SYMMETRIC (§6 R1). The sender scope is deliberately left at what the
-- published series has always used — CC 2 wallets, Phygitals 1 — so this change
-- moves ONE variable. Measured, R1 is a no-op for CC (the third wallet sent
-- nothing in 35d) and makes Phygitals WORSE (+$217K of outflow, rate 102.25%).
--
-- Row shape: platform, day, buyback_count, payout_usd, outflow_gross_count,
-- outflow_gross_usd — one row per platform per UTC day, 35d window. Mirrors
-- gacha-daily-all-platforms.sql so the two sides of net revenue share a shape and
-- a window and can be subtracted day-for-day.
--
-- ⚠️ 35d, matching gacha-daily. Net revenue must only ever subtract same-window,
-- same-completeness values, so these two queries move together — if you rewindow
-- one, rewindow the other. The spender window moves with it by construction.

WITH spenders AS (
  -- THE R3 SET: every address that actually paid this platform's gacha receivers
  -- in the window. Built off GROSS inflow, not the canonical price allowlist —
  -- R3 asks "is this counterparty a customer", and a non-tier payment still
  -- proves that. Gross is also the CONSERVATIVE choice: a wider spender set
  -- counts MORE payouts, so it lowers net. House wallets cannot leak in because
  -- the spend leg's own excluded-sender list is applied here.
  SELECT DISTINCT platform, wallet FROM (
    SELECT 'collector-crypt' AS platform, from_owner AS wallet
    FROM tokens_solana.transfers
    WHERE to_owner IN ('GachazZscHZ5bn3vnq1yEC4zpYdhAYJBzuKJwSJksc9z','GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3','96DULv1BqYfe5wyMr6pVUNC6Uyrtj6yr3tNi6VtfwW9s')
      AND from_owner NOT IN ('BAxTk97HsaJqbnbFmTiQTaL4KSRvJ8Y65ArZCsP6vA5M','21KhtC7y2JGYvwc8dcGqTdbrudbM8fgMPJsVwxRQqdY8','DFEstpYN3fsz93AC9v2ujzPPngPgodqH2xxopuyfSsAE','HW2HRqN1pXQGH9GfP9xet4XwqtLqFyYGDNRKjUAVgh9u','HighJBfnAaqH9cKkeMErQFJZ4ATxQJwxqFupX6zaKTns','LGNDXqcm6U57QQ6Ad7icZ6oizkAVKRWrw97KwZy5nVf','EpicWWZspT1trKndbDDr29ULViN56rN5vofWSKZp8ePF','Mid9NeCpPNxP59fAdsLgMLy7BYexxXFw52ZP58Jrney','Lowq9dkpY43VpjfYeRjtKfGA6JtB7HaMmwQgXkjHLvN','Low6UekJP3QrFVMfNRTL8CPK2SiGFhvp57sgF2pkmVu','miDtj3vgdxVykHzRyFwyG8MXpvK8eQqamSLVdBr7WPt','HiGHqwYddP5N2waqUmXPdaASpMpUEvfqPr2fSawctEb','epiC3zkqa1RfcPMMM1Kc8m3GZGDwF2RmjbfA3g1BBjn','LGNDfXQFMiRMz3qqTNAREmRFQutMvazqqRrzn5i98uj','SPrT7eFrCM9UJ4j7Xf9iktKCoBwJjfykFbiNbRsKQm8')
      AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      AND amount > 0
      AND block_time > now() - interval '35' day

    UNION ALL

    SELECT 'phygitals' AS platform, from_owner AS wallet
    FROM tokens_solana.transfers
    WHERE to_owner IN ('62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS','42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e')
      AND from_owner NOT IN ('62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS','42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e','5sn2nniGv88bxzxBDkqWP6i8bejsr9WwCpZXq2ZkLHgf')
      AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      AND amount > 0
      AND block_time > now() - interval '35' day
  ) i
),

outflow AS (
  -- USDC leaving the gacha wallets. Sender scope and the internal-recipient list
  -- are copied VERBATIM from the pre-R3 query, so `outflow_gross_usd` below is
  -- byte-for-byte the series that used to be published as `payout_usd`.
  SELECT 'collector-crypt' AS platform,
         date_trunc('day', block_time) AS day,
         to_owner AS wallet,
         amount/power(10,6) AS usd
  FROM tokens_solana.transfers
  WHERE from_owner IN ('GachazZscHZ5bn3vnq1yEC4zpYdhAYJBzuKJwSJksc9z','GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3')
    AND to_owner NOT IN ('BAxTk97HsaJqbnbFmTiQTaL4KSRvJ8Y65ArZCsP6vA5M','21KhtC7y2JGYvwc8dcGqTdbrudbM8fgMPJsVwxRQqdY8','DFEstpYN3fsz93AC9v2ujzPPngPgodqH2xxopuyfSsAE','HW2HRqN1pXQGH9GfP9xet4XwqtLqFyYGDNRKjUAVgh9u','HighJBfnAaqH9cKkeMErQFJZ4ATxQJwxqFupX6zaKTns','LGNDXqcm6U57QQ6Ad7icZ6oizkAVKRWrw97KwZy5nVf','EpicWWZspT1trKndbDDr29ULViN56rN5vofWSKZp8ePF','Mid9NeCpPNxP59fAdsLgMLy7BYexxXFw52ZP58Jrney','Lowq9dkpY43VpjfYeRjtKfGA6JtB7HaMmwQgXkjHLvN','Low6UekJP3QrFVMfNRTL8CPK2SiGFhvp57sgF2pkmVu','miDtj3vgdxVykHzRyFwyG8MXpvK8eQqamSLVdBr7WPt','HiGHqwYddP5N2waqUmXPdaASpMpUEvfqPr2fSawctEb','epiC3zkqa1RfcPMMM1Kc8m3GZGDwF2RmjbfA3g1BBjn','LGNDfXQFMiRMz3qqTNAREmRFQutMvazqqRrzn5i98uj','SPrT7eFrCM9UJ4j7Xf9iktKCoBwJjfykFbiNbRsKQm8','Cc4pHGnoaRWL1WnHsV517T3YvQn5gLDBMiuVXkF9rZhK','8373hLiAEXxaJ3oV7SRzx4KHwurEg9rEG98tUPj1sdtX')
    AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    AND block_time > now() - interval '35' day

  UNION ALL

  SELECT 'phygitals' AS platform,
         date_trunc('day', block_time) AS day,
         to_owner AS wallet,
         amount/power(10,6) AS usd
  FROM tokens_solana.transfers
  WHERE from_owner IN ('62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS')
    AND to_owner NOT IN ('42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e','5sn2nniGv88bxzxBDkqWP6i8bejsr9WwCpZXq2ZkLHgf')
    AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    AND block_time > now() - interval '35' day
)

SELECT o.platform,
       o.day,
       -- R3-counted: the recipient is a known spender on this platform.
       CAST(COUNT(*) FILTER (WHERE s.wallet IS NOT NULL) AS BIGINT) AS buyback_count,
       CAST(COALESCE(SUM(o.usd) FILTER (WHERE s.wallet IS NOT NULL), 0) AS DOUBLE) AS payout_usd,
       -- The pre-R3 definition, retained as its own series.
       CAST(COUNT(*) AS BIGINT) AS outflow_gross_count,
       CAST(SUM(o.usd) AS DOUBLE) AS outflow_gross_usd
FROM outflow o
LEFT JOIN spenders s ON s.platform = o.platform AND s.wallet = o.wallet
GROUP BY o.platform, o.day
