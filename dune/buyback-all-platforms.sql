-- TCG.market — gacha outflow · TWO TIERS · NARROW PAYLOAD (since 2026-09-22)
-- Production shape for `buyback_payout_usd` + `outflow_gross_usd`. Two scans of
-- tokens_solana.transfers, split by what the loader needs each row for:
--
--   TIER 1 · per RECIPIENT per day, trailing 9 DAYS  (w = recipient hash)
--     The only reason a per-recipient row exists is the R3 spender test in
--     `warm-metric-snapshots` (src/lib/data/buybackFold.ts): is this recipient a
--     `gacha_pulls.buyer`? The spine is the system of record and upserts by day,
--     so a day older than a week never needs re-classifying — 8 complete days
--     is the re-statement margin, the 9th is the partial window edge.
--   TIER 2 · per PLATFORM per day, 35 DAYS  (w NULL)
--     Gross outflow, one row a day, for `outflow_gross_usd` and the 30d
--     reconciliation against the spine.
--
-- WHY. The previous shape ran every recipient row for 35 days: 68,880 rows,
-- 344,400 datapoints, 2.43 MB per download every other day — 95% of every
-- datapoint this repository read from Dune (measured 2026-09-21, run
-- 35591396078). Two tiers keep the same two series and the same R3 test at
-- roughly 16k rows. The loader accepts both shapes, so it ships first and this
-- SQL is applied to query 8252735 after.
--
-- ⚠️ EVERY COLUMN NAME AND TYPE HERE IS A BILLED BYTE (results are billed per
-- exported MB), which is why they are absurdly short. Do not "tidy" these names.
--   p  platform code — 'c' collector-crypt, 'p' phygitals
--   d  UTC day as a DATE ('2026-08-01'), not a timestamp
--   w  recipient key: FIRST 16 HEX OF SHA-256(address) — or NULL on a gross row
--   n  transfers, u  USD
--
-- ⚠️ `w` IS A HASH, AND THE LOADER MUST HASH THE SAME WAY — sha256 of the UTF-8
-- address, hex, lower-case, first 16 chars. A hash rather than an address prefix
-- on purpose: base58 prefixes are NOT uniformly distributed because vanity
-- addresses are common on Solana (this platform's own gacha wallets are vanity —
-- 'Gachaz…', 'GachaN…'), so a prefix collides in exactly the population we care
-- about. 64 bits over ~18k distinct recipients puts collision odds near 1e-11.
--
-- ⚠️ THE FULL ADDRESS IS NOT RECOVERABLE from this result. For counterparty
-- forensics use dune/r3-recipient-drilldown.sql, which keeps them.
--
-- Sender scope and the internal-recipient list are copied VERBATIM from the
-- previous shape (dune/superseded/buyback-all-platforms.8252735.per-recipient-35d.sql),
-- so a gross row reproduces `outflow_gross_usd` exactly and the classified
-- subset of tier 1 reproduces `payout_usd`.
  -- tier 1 · collector-crypt · per recipient · 9d
  SELECT 'c' AS p,
         CAST(date_trunc('day', block_time) AS DATE) AS d,
         substr(to_hex(sha256(to_utf8(to_owner))), 1, 16) AS w,
         CAST(COUNT(*) AS BIGINT) AS n,
         CAST(SUM(amount/power(10,6)) AS DOUBLE) AS u
  FROM tokens_solana.transfers
  WHERE from_owner IN ('GachazZscHZ5bn3vnq1yEC4zpYdhAYJBzuKJwSJksc9z','GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3')
    AND to_owner NOT IN ('BAxTk97HsaJqbnbFmTiQTaL4KSRvJ8Y65ArZCsP6vA5M','21KhtC7y2JGYvwc8dcGqTdbrudbM8fgMPJsVwxRQqdY8','DFEstpYN3fsz93AC9v2ujzPPngPgodqH2xxopuyfSsAE','HW2HRqN1pXQGH9GfP9xet4XwqtLqFyYGDNRKjUAVgh9u','HighJBfnAaqH9cKkeMErQFJZ4ATxQJwxqFupX6zaKTns','LGNDXqcm6U57QQ6Ad7icZ6oizkAVKRWrw97KwZy5nVf','EpicWWZspT1trKndbDDr29ULViN56rN5vofWSKZp8ePF','Mid9NeCpPNxP59fAdsLgMLy7BYexxXFw52ZP58Jrney','Lowq9dkpY43VpjfYeRjtKfGA6JtB7HaMmwQgXkjHLvN','Low6UekJP3QrFVMfNRTL8CPK2SiGFhvp57sgF2pkmVu','miDtj3vgdxVykHzRyFwyG8MXpvK8eQqamSLVdBr7WPt','HiGHqwYddP5N2waqUmXPdaASpMpUEvfqPr2fSawctEb','epiC3zkqa1RfcPMMM1Kc8m3GZGDwF2RmjbfA3g1BBjn','LGNDfXQFMiRMz3qqTNAREmRFQutMvazqqRrzn5i98uj','SPrT7eFrCM9UJ4j7Xf9iktKCoBwJjfykFbiNbRsKQm8','Cc4pHGnoaRWL1WnHsV517T3YvQn5gLDBMiuVXkF9rZhK','8373hLiAEXxaJ3oV7SRzx4KHwurEg9rEG98tUPj1sdtX')
    AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    AND block_time > now() - interval '9' day
  GROUP BY 1, 2, 3
  UNION ALL
  -- tier 2 · collector-crypt · per day · 35d
  SELECT 'c' AS p,
         CAST(date_trunc('day', block_time) AS DATE) AS d,
         CAST(NULL AS VARCHAR) AS w,
         CAST(COUNT(*) AS BIGINT) AS n,
         CAST(SUM(amount/power(10,6)) AS DOUBLE) AS u
  FROM tokens_solana.transfers
  WHERE from_owner IN ('GachazZscHZ5bn3vnq1yEC4zpYdhAYJBzuKJwSJksc9z','GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3')
    AND to_owner NOT IN ('BAxTk97HsaJqbnbFmTiQTaL4KSRvJ8Y65ArZCsP6vA5M','21KhtC7y2JGYvwc8dcGqTdbrudbM8fgMPJsVwxRQqdY8','DFEstpYN3fsz93AC9v2ujzPPngPgodqH2xxopuyfSsAE','HW2HRqN1pXQGH9GfP9xet4XwqtLqFyYGDNRKjUAVgh9u','HighJBfnAaqH9cKkeMErQFJZ4ATxQJwxqFupX6zaKTns','LGNDXqcm6U57QQ6Ad7icZ6oizkAVKRWrw97KwZy5nVf','EpicWWZspT1trKndbDDr29ULViN56rN5vofWSKZp8ePF','Mid9NeCpPNxP59fAdsLgMLy7BYexxXFw52ZP58Jrney','Lowq9dkpY43VpjfYeRjtKfGA6JtB7HaMmwQgXkjHLvN','Low6UekJP3QrFVMfNRTL8CPK2SiGFhvp57sgF2pkmVu','miDtj3vgdxVykHzRyFwyG8MXpvK8eQqamSLVdBr7WPt','HiGHqwYddP5N2waqUmXPdaASpMpUEvfqPr2fSawctEb','epiC3zkqa1RfcPMMM1Kc8m3GZGDwF2RmjbfA3g1BBjn','LGNDfXQFMiRMz3qqTNAREmRFQutMvazqqRrzn5i98uj','SPrT7eFrCM9UJ4j7Xf9iktKCoBwJjfykFbiNbRsKQm8','Cc4pHGnoaRWL1WnHsV517T3YvQn5gLDBMiuVXkF9rZhK','8373hLiAEXxaJ3oV7SRzx4KHwurEg9rEG98tUPj1sdtX')
    AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    AND block_time > now() - interval '35' day
  GROUP BY 1, 2, 3
  UNION ALL
  -- tier 1 · phygitals · per recipient · 9d
  SELECT 'p' AS p,
         CAST(date_trunc('day', block_time) AS DATE) AS d,
         substr(to_hex(sha256(to_utf8(to_owner))), 1, 16) AS w,
         CAST(COUNT(*) AS BIGINT) AS n,
         CAST(SUM(amount/power(10,6)) AS DOUBLE) AS u
  FROM tokens_solana.transfers
  WHERE from_owner IN ('62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS')
    AND to_owner NOT IN ('42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e','5sn2nniGv88bxzxBDkqWP6i8bejsr9WwCpZXq2ZkLHgf')
    AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    AND block_time > now() - interval '9' day
  GROUP BY 1, 2, 3
  UNION ALL
  -- tier 2 · phygitals · per day · 35d
  SELECT 'p' AS p,
         CAST(date_trunc('day', block_time) AS DATE) AS d,
         CAST(NULL AS VARCHAR) AS w,
         CAST(COUNT(*) AS BIGINT) AS n,
         CAST(SUM(amount/power(10,6)) AS DOUBLE) AS u
  FROM tokens_solana.transfers
  WHERE from_owner IN ('62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS')
    AND to_owner NOT IN ('42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e','5sn2nniGv88bxzxBDkqWP6i8bejsr9WwCpZXq2ZkLHgf')
    AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    AND block_time > now() - interval '35' day
  GROUP BY 1, 2, 3
