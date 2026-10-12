-- Varible — coverage diagnostic, ONE-SHOT (not scheduled, not read by src/).
-- Every USDC amount paid into Collector Crypt's three pack sinks over the last 30
-- complete UTC days, with the SAME team-sender exclusions as
-- gacha-daily-all-platforms.sql, flagged by whether that query's pack-price
-- allowlist keeps it. Answers: how much spend does the allowlist drop, and at
-- which amounts. Rows = distinct (sink, amount): small; run once.
SELECT to_owner AS sink,
       CAST(ROUND(amount/power(10,6), 2) AS DOUBLE) AS amount_usd,
       amount/power(10,6) IN (25,50,75,80,100,151,250,1000,2500,5000) AS in_daily_allowlist,
       amount/power(10,6) IN (50,100,250,25,75,80,1000) AS in_live_allowlist,
       CAST(COUNT(*) AS BIGINT) AS transfers,
       CAST(SUM(amount/power(10,6)) AS DOUBLE) AS volume_usd,
       CAST(COUNT(DISTINCT from_owner) AS BIGINT) AS senders
FROM tokens_solana.transfers
WHERE to_owner IN ('GachazZscHZ5bn3vnq1yEC4zpYdhAYJBzuKJwSJksc9z','GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3','96DULv1BqYfe5wyMr6pVUNC6Uyrtj6yr3tNi6VtfwW9s')
  AND from_owner NOT IN ('BAxTk97HsaJqbnbFmTiQTaL4KSRvJ8Y65ArZCsP6vA5M','21KhtC7y2JGYvwc8dcGqTdbrudbM8fgMPJsVwxRQqdY8','DFEstpYN3fsz93AC9v2ujzPPngPgodqH2xxopuyfSsAE','HW2HRqN1pXQGH9GfP9xet4XwqtLqFyYGDNRKjUAVgh9u','HighJBfnAaqH9cKkeMErQFJZ4ATxQJwxqFupX6zaKTns','LGNDXqcm6U57QQ6Ad7icZ6oizkAVKRWrw97KwZy5nVf','EpicWWZspT1trKndbDDr29ULViN56rN5vofWSKZp8ePF','Mid9NeCpPNxP59fAdsLgMLy7BYexxXFw52ZP58Jrney','Lowq9dkpY43VpjfYeRjtKfGA6JtB7HaMmwQgXkjHLvN','Low6UekJP3QrFVMfNRTL8CPK2SiGFhvp57sgF2pkmVu','miDtj3vgdxVykHzRyFwyG8MXpvK8eQqamSLVdBr7WPt','HiGHqwYddP5N2waqUmXPdaASpMpUEvfqPr2fSawctEb','epiC3zkqa1RfcPMMM1Kc8m3GZGDwF2RmjbfA3g1BBjn','LGNDfXQFMiRMz3qqTNAREmRFQutMvazqqRrzn5i98uj','SPrT7eFrCM9UJ4j7Xf9iktKCoBwJjfykFbiNbRsKQm8')
  AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  AND block_time >= date_trunc('day', now()) - interval '30' day
  AND block_time < date_trunc('day', now())
GROUP BY 1, 2, 3, 4
ORDER BY volume_usd DESC
