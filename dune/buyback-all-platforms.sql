-- TCG.market — gacha BUYBACK payouts · ALL PLATFORMS
-- ONE execution replacing two: 7644128 (CC) / 7644129 (Phygitals).
-- USDC sent FROM a platform's gacha wallets back to players (instant cash-out of
-- a pulled card), excluding internal/house wallets. Net house revenue =
-- gacha spend − buyback payout.
--
-- Row shape: platform, bb_30d, pay_30d, bb_7d, pay_7d, bb_24h, pay_24h — one row
-- per platform. Every branch's FROM/WHERE is copied VERBATIM from its original.

SELECT 'collector-crypt' AS platform,
       CAST(COUNT(*) AS BIGINT) AS bb_30d,
       CAST(SUM(amount/power(10,6)) AS DOUBLE) AS pay_30d,
       CAST(COUNT(*) FILTER (WHERE block_time > now() - interval '7' day) AS BIGINT) AS bb_7d,
       CAST(SUM(amount/power(10,6)) FILTER (WHERE block_time > now() - interval '7' day) AS DOUBLE) AS pay_7d,
       CAST(COUNT(*) FILTER (WHERE block_time > now() - interval '24' hour) AS BIGINT) AS bb_24h,
       CAST(SUM(amount/power(10,6)) FILTER (WHERE block_time > now() - interval '24' hour) AS DOUBLE) AS pay_24h
FROM tokens_solana.transfers
WHERE from_owner IN ('GachazZscHZ5bn3vnq1yEC4zpYdhAYJBzuKJwSJksc9z','GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3')
  AND to_owner NOT IN ('BAxTk97HsaJqbnbFmTiQTaL4KSRvJ8Y65ArZCsP6vA5M','21KhtC7y2JGYvwc8dcGqTdbrudbM8fgMPJsVwxRQqdY8','DFEstpYN3fsz93AC9v2ujzPPngPgodqH2xxopuyfSsAE','HW2HRqN1pXQGH9GfP9xet4XwqtLqFyYGDNRKjUAVgh9u','HighJBfnAaqH9cKkeMErQFJZ4ATxQJwxqFupX6zaKTns','LGNDXqcm6U57QQ6Ad7icZ6oizkAVKRWrw97KwZy5nVf','EpicWWZspT1trKndbDDr29ULViN56rN5vofWSKZp8ePF','Mid9NeCpPNxP59fAdsLgMLy7BYexxXFw52ZP58Jrney','Lowq9dkpY43VpjfYeRjtKfGA6JtB7HaMmwQgXkjHLvN','Low6UekJP3QrFVMfNRTL8CPK2SiGFhvp57sgF2pkmVu','miDtj3vgdxVykHzRyFwyG8MXpvK8eQqamSLVdBr7WPt','HiGHqwYddP5N2waqUmXPdaASpMpUEvfqPr2fSawctEb','epiC3zkqa1RfcPMMM1Kc8m3GZGDwF2RmjbfA3g1BBjn','LGNDfXQFMiRMz3qqTNAREmRFQutMvazqqRrzn5i98uj','SPrT7eFrCM9UJ4j7Xf9iktKCoBwJjfykFbiNbRsKQm8','Cc4pHGnoaRWL1WnHsV517T3YvQn5gLDBMiuVXkF9rZhK','8373hLiAEXxaJ3oV7SRzx4KHwurEg9rEG98tUPj1sdtX')
  AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' AND block_time > now() - interval '30' day

UNION ALL

SELECT 'phygitals' AS platform,
       CAST(COUNT(*) AS BIGINT) AS bb_30d,
       CAST(SUM(amount/power(10,6)) AS DOUBLE) AS pay_30d,
       CAST(COUNT(*) FILTER (WHERE block_time > now() - interval '7' day) AS BIGINT) AS bb_7d,
       CAST(SUM(amount/power(10,6)) FILTER (WHERE block_time > now() - interval '7' day) AS DOUBLE) AS pay_7d,
       CAST(COUNT(*) FILTER (WHERE block_time > now() - interval '24' hour) AS BIGINT) AS bb_24h,
       CAST(SUM(amount/power(10,6)) FILTER (WHERE block_time > now() - interval '24' hour) AS DOUBLE) AS pay_24h
FROM tokens_solana.transfers
WHERE from_owner = '62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS'
  AND to_owner NOT IN ('42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e','5sn2nniGv88bxzxBDkqWP6i8bejsr9WwCpZXq2ZkLHgf')
  AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' AND block_time > now() - interval '30' day
