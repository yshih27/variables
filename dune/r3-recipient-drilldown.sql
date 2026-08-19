-- TCG.market — R3 RECIPIENT DRILL-DOWN (one-shot, NOT on any schedule)
-- Slot: 7644129, repurposed from the dormant "TCG.market — Phygitals buyback"
-- (SQL preserved in dune/superseded/buyback-phygitals.7644129.sql).
--
-- ⚠️ STAGED, NOT EXECUTED. Authored alongside 7644128 so the evidence behind the
-- headline is one click away; nothing has run it and nothing references its id.
--
-- PURPOSE. 7644128 says how much R3 removes. This says WHO from — the named
-- counterparties behind §3d's truncated table, at full 35d density rather than
-- the Helius sample §2 showed was 0.2% complete. Each row: a recipient of gacha
-- wallet outflow, what it received, whether it EVER paid the gacha receivers
-- (the R3 test), and whether the hand-curated exclusion list already knew it.
-- The rows where is_spender = false and not_excluded = true are exactly the
-- money R3 removes and the current list misses.
--
-- Top 40 per platform by USD — the tail is long and immaterial, and a bounded
-- export keeps this a metadata-sized read.

WITH spenders AS (
  SELECT DISTINCT 'collector-crypt' AS platform, from_owner AS wallet
  FROM tokens_solana.transfers
  WHERE to_owner IN ('GachazZscHZ5bn3vnq1yEC4zpYdhAYJBzuKJwSJksc9z','GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3','96DULv1BqYfe5wyMr6pVUNC6Uyrtj6yr3tNi6VtfwW9s')
    AND from_owner NOT IN ('BAxTk97HsaJqbnbFmTiQTaL4KSRvJ8Y65ArZCsP6vA5M','21KhtC7y2JGYvwc8dcGqTdbrudbM8fgMPJsVwxRQqdY8','DFEstpYN3fsz93AC9v2ujzPPngPgodqH2xxopuyfSsAE','HW2HRqN1pXQGH9GfP9xet4XwqtLqFyYGDNRKjUAVgh9u','HighJBfnAaqH9cKkeMErQFJZ4ATxQJwxqFupX6zaKTns','LGNDXqcm6U57QQ6Ad7icZ6oizkAVKRWrw97KwZy5nVf','EpicWWZspT1trKndbDDr29ULViN56rN5vofWSKZp8ePF','Mid9NeCpPNxP59fAdsLgMLy7BYexxXFw52ZP58Jrney','Lowq9dkpY43VpjfYeRjtKfGA6JtB7HaMmwQgXkjHLvN','Low6UekJP3QrFVMfNRTL8CPK2SiGFhvp57sgF2pkmVu','miDtj3vgdxVykHzRyFwyG8MXpvK8eQqamSLVdBr7WPt','HiGHqwYddP5N2waqUmXPdaASpMpUEvfqPr2fSawctEb','epiC3zkqa1RfcPMMM1Kc8m3GZGDwF2RmjbfA3g1BBjn','LGNDfXQFMiRMz3qqTNAREmRFQutMvazqqRrzn5i98uj','SPrT7eFrCM9UJ4j7Xf9iktKCoBwJjfykFbiNbRsKQm8')
    AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' AND amount > 0
    AND block_time > now() - interval '35' day
  UNION ALL
  SELECT DISTINCT 'phygitals', from_owner
  FROM tokens_solana.transfers
  WHERE to_owner IN ('62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS','42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e')
    AND from_owner NOT IN ('62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS','42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e','5sn2nniGv88bxzxBDkqWP6i8bejsr9WwCpZXq2ZkLHgf')
    AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' AND amount > 0
    AND block_time > now() - interval '35' day
),
outflow AS (
  SELECT 'collector-crypt' AS platform, to_owner AS wallet, amount/power(10,6) AS usd,
         to_owner NOT IN ('BAxTk97HsaJqbnbFmTiQTaL4KSRvJ8Y65ArZCsP6vA5M','21KhtC7y2JGYvwc8dcGqTdbrudbM8fgMPJsVwxRQqdY8','DFEstpYN3fsz93AC9v2ujzPPngPgodqH2xxopuyfSsAE','HW2HRqN1pXQGH9GfP9xet4XwqtLqFyYGDNRKjUAVgh9u','HighJBfnAaqH9cKkeMErQFJZ4ATxQJwxqFupX6zaKTns','LGNDXqcm6U57QQ6Ad7icZ6oizkAVKRWrw97KwZy5nVf','EpicWWZspT1trKndbDDr29ULViN56rN5vofWSKZp8ePF','Mid9NeCpPNxP59fAdsLgMLy7BYexxXFw52ZP58Jrney','Lowq9dkpY43VpjfYeRjtKfGA6JtB7HaMmwQgXkjHLvN','Low6UekJP3QrFVMfNRTL8CPK2SiGFhvp57sgF2pkmVu','miDtj3vgdxVykHzRyFwyG8MXpvK8eQqamSLVdBr7WPt','HiGHqwYddP5N2waqUmXPdaASpMpUEvfqPr2fSawctEb','epiC3zkqa1RfcPMMM1Kc8m3GZGDwF2RmjbfA3g1BBjn','LGNDfXQFMiRMz3qqTNAREmRFQutMvazqqRrzn5i98uj','SPrT7eFrCM9UJ4j7Xf9iktKCoBwJjfykFbiNbRsKQm8','Cc4pHGnoaRWL1WnHsV517T3YvQn5gLDBMiuVXkF9rZhK','8373hLiAEXxaJ3oV7SRzx4KHwurEg9rEG98tUPj1sdtX') AS not_excluded
  FROM tokens_solana.transfers
  WHERE from_owner IN ('GachazZscHZ5bn3vnq1yEC4zpYdhAYJBzuKJwSJksc9z','GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3','96DULv1BqYfe5wyMr6pVUNC6Uyrtj6yr3tNi6VtfwW9s')
    AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    AND block_time > now() - interval '35' day
  UNION ALL
  SELECT 'phygitals', to_owner, amount/power(10,6),
         to_owner NOT IN ('42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e','5sn2nniGv88bxzxBDkqWP6i8bejsr9WwCpZXq2ZkLHgf')
  FROM tokens_solana.transfers
  WHERE from_owner IN ('62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS','42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e')
    AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    AND block_time > now() - interval '35' day
),
agg AS (
  SELECT f.platform, f.wallet,
         CAST(COUNT(*) AS BIGINT) AS transfers,
         CAST(SUM(f.usd) AS DOUBLE) AS usd,
         CAST(AVG(f.usd) AS DOUBLE) AS avg_usd,
         BOOL_OR(f.not_excluded) AS not_excluded,
         MAX(CASE WHEN s.wallet IS NOT NULL THEN 1 ELSE 0 END) = 1 AS is_spender
  FROM outflow f LEFT JOIN spenders s ON s.platform = f.platform AND s.wallet = f.wallet
  GROUP BY f.platform, f.wallet
)
SELECT platform, wallet, transfers, usd, avg_usd, is_spender, not_excluded,
       CAST(ROW_NUMBER() OVER (PARTITION BY platform ORDER BY usd DESC) AS BIGINT) AS rnk
FROM agg
QUALIFY ROW_NUMBER() OVER (PARTITION BY platform ORDER BY usd DESC) <= 40
ORDER BY platform, usd DESC
