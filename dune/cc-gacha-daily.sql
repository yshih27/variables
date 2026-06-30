-- TCG.market — Collector Crypt gacha DAILY
-- Daily version of validated query 7642633. tokens_solana.transfers: USDC amount /1e6.
-- No time filter = full history. Output: day, pack_price, pulls, volume_usd.
--
-- PRICE LIST = the full live /api/gachas/all catalog (re-sync when CC adds packs):
--   25,50,75,80,100,151,250,1000,2500,5000
--   151  = Rarible×CC "151 & Friends" (code pokemon_151, private)
--   2500 = Mythic, 5000 = Celestial  (were missing → undercounted)
-- NOTE: price collides across categories ($50 = 6 packs), so per-pack/category/
-- channel attribution comes from the native winners feed's pack_type (code), NOT here.
SELECT
  date_trunc('day', block_time) AS day,
  CAST(amount/power(10,6) AS INTEGER) AS pack_price,
  COUNT(*) AS pulls,
  SUM(amount/power(10,6)) AS volume_usd
FROM tokens_solana.transfers
WHERE to_owner IN ('GachazZscHZ5bn3vnq1yEC4zpYdhAYJBzuKJwSJksc9z','GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3','96DULv1BqYfe5wyMr6pVUNC6Uyrtj6yr3tNi6VtfwW9s')
  AND from_owner NOT IN ('BAxTk97HsaJqbnbFmTiQTaL4KSRvJ8Y65ArZCsP6vA5M','21KhtC7y2JGYvwc8dcGqTdbrudbM8fgMPJsVwxRQqdY8','DFEstpYN3fsz93AC9v2ujzPPngPgodqH2xxopuyfSsAE','HW2HRqN1pXQGH9GfP9xet4XwqtLqFyYGDNRKjUAVgh9u','HighJBfnAaqH9cKkeMErQFJZ4ATxQJwxqFupX6zaKTns','LGNDXqcm6U57QQ6Ad7icZ6oizkAVKRWrw97KwZy5nVf','EpicWWZspT1trKndbDDr29ULViN56rN5vofWSKZp8ePF','Mid9NeCpPNxP59fAdsLgMLy7BYexxXFw52ZP58Jrney','Lowq9dkpY43VpjfYeRjtKfGA6JtB7HaMmwQgXkjHLvN','Low6UekJP3QrFVMfNRTL8CPK2SiGFhvp57sgF2pkmVu','miDtj3vgdxVykHzRyFwyG8MXpvK8eQqamSLVdBr7WPt','HiGHqwYddP5N2waqUmXPdaASpMpUEvfqPr2fSawctEb','epiC3zkqa1RfcPMMM1Kc8m3GZGDwF2RmjbfA3g1BBjn','LGNDfXQFMiRMz3qqTNAREmRFQutMvazqqRrzn5i98uj','SPrT7eFrCM9UJ4j7Xf9iktKCoBwJjfykFbiNbRsKQm8')
  AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  AND amount/power(10,6) IN (25,50,75,80,100,151,250,1000,2500,5000)
GROUP BY 1, 2
ORDER BY 1, 2
