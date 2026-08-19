-- TCG.market — gacha outflow per RECIPIENT per day · NARROW PAYLOAD
-- Production shape for `buyback_payout_usd` + `outflow_gross_usd`. ONE scan of
-- tokens_solana.transfers: the R3 spender test is NOT done here. Dune says only
-- who received what on which day; `warm-metric-snapshots` classifies each
-- recipient against our own `gacha_pulls.buyer` and folds the rows into the two
-- per-day series.
--
-- ⚠️ EVERY COLUMN NAME AND TYPE HERE IS A BILLED BYTE, which is why they are
-- absurdly short. Dune bills compute per execution AND results per exported MB
-- (10 cr/MB on Analyst), and at ~45k rows the export is the dominant term.
-- Measured on the wide version of this exact query — platform slug, timestamp,
-- full base58 address — 80.8 bytes/row = 3.49 MB = 34.9 cr/run, which pushed the
-- all-in over the 50 cr/day ceiling on its own. Narrowing the payload is the
-- whole reason this variant fits. Do not "tidy" these names.
--   p  platform code — 'c' collector-crypt, 'p' phygitals
--   d  UTC day as a DATE ('2026-08-01'), not a timestamp ('… 00:00:00.000 UTC')
--   w  recipient key: FIRST 16 HEX OF SHA-256(address), not the address
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
-- pre-R3 query, so summing `u` over a day reproduces `outflow_gross_usd` exactly
-- and the loader's classified subset reproduces `payout_usd`.

  SELECT 'c' AS p,
         CAST(date_trunc('day', block_time) AS DATE) AS d,
         substr(to_hex(sha256(to_utf8(to_owner))), 1, 16) AS w,
         CAST(COUNT(*) AS BIGINT) AS n,
         CAST(SUM(amount/power(10,6)) AS DOUBLE) AS u
  FROM tokens_solana.transfers
  WHERE from_owner IN ('GachazZscHZ5bn3vnq1yEC4zpYdhAYJBzuKJwSJksc9z','GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3')
    AND to_owner NOT IN ('BAxTk97HsaJqbnbFmTiQTaL4KSRvJ8Y65ArZCsP6vA5M','21KhtC7y2JGYvwc8dcGqTdbrudbM8fgMPJsVwxRQqdY8','DFEstpYN3fsz93AC9v2ujzPPngPgodqH2xxopuyfSsAE','HW2HRqN1pXQGH9GfP9xet4XwqtLqFyYGDNRKjUAVgh9u','HighJBfnAaqH9cKkeMErQFJZ4ATxQJwxqFupX6zaKTns','LGNDXqcm6U57QQ6Ad7icZ6oizkAVKRWrw97KwZy5nVf','EpicWWZspT1trKndbDDr29ULViN56rN5vofWSKZp8ePF','Mid9NeCpPNxP59fAdsLgMLy7BYexxXFw52ZP58Jrney','Lowq9dkpY43VpjfYeRjtKfGA6JtB7HaMmwQgXkjHLvN','Low6UekJP3QrFVMfNRTL8CPK2SiGFhvp57sgF2pkmVu','miDtj3vgdxVykHzRyFwyG8MXpvK8eQqamSLVdBr7WPt','HiGHqwYddP5N2waqUmXPdaASpMpUEvfqPr2fSawctEb','epiC3zkqa1RfcPMMM1Kc8m3GZGDwF2RmjbfA3g1BBjn','LGNDfXQFMiRMz3qqTNAREmRFQutMvazqqRrzn5i98uj','SPrT7eFrCM9UJ4j7Xf9iktKCoBwJjfykFbiNbRsKQm8','Cc4pHGnoaRWL1WnHsV517T3YvQn5gLDBMiuVXkF9rZhK','8373hLiAEXxaJ3oV7SRzx4KHwurEg9rEG98tUPj1sdtX')
    AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    AND block_time > now() - interval '35' day
  GROUP BY 1, 2, 3

  UNION ALL

  SELECT 'p' AS p,
         CAST(date_trunc('day', block_time) AS DATE) AS d,
         substr(to_hex(sha256(to_utf8(to_owner))), 1, 16) AS w,
         CAST(COUNT(*) AS BIGINT) AS n,
         CAST(SUM(amount/power(10,6)) AS DOUBLE) AS u
  FROM tokens_solana.transfers
  WHERE from_owner IN ('62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS')
    AND to_owner NOT IN ('42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e','5sn2nniGv88bxzxBDkqWP6i8bejsr9WwCpZXq2ZkLHgf')
    AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    AND block_time > now() - interval '35' day
  GROUP BY 1, 2, 3
