
WITH tiers AS (
  SELECT * FROM (VALUES
    ('SPrT7eFrCM9UJ4j7Xf9iktKCoBwJjfykFbiNbRsKQm8','SPrT'),
    ('LGNDXqcm6U57QQ6Ad7icZ6oizkAVKRWrw97KwZy5nVf','LGND'),
    ('LGNDfXQFMiRMz3qqTNAREmRFQutMvazqqRrzn5i98uj','LGND'),
    ('EpicWWZspT1trKndbDDr29ULViN56rN5vofWSKZp8ePF','Epic'),
    ('epiC3zkqa1RfcPMMM1Kc8m3GZGDwF2RmjbfA3g1BBjn','Epic'),
    ('HighJBfnAaqH9cKkeMErQFJZ4ATxQJwxqFupX6zaKTns','High'),
    ('HiGHqwYddP5N2waqUmXPdaASpMpUEvfqPr2fSawctEb','High'),
    ('Mid9NeCpPNxP59fAdsLgMLy7BYexxXFw52ZP58Jrney','Mid'),
    ('miDtj3vgdxVykHzRyFwyG8MXpvK8eQqamSLVdBr7WPt','Mid'),
    ('Lowq9dkpY43VpjfYeRjtKfGA6JtB7HaMmwQgXkjHLvN','Low'),
    ('Low6UekJP3QrFVMfNRTL8CPK2SiGFhvp57sgF2pkmVu','Low')
  ) AS t(wallet, tier)
)
SELECT ti.tier,
  COUNT(*) AS prizes_30d,
  COUNT(*) FILTER (WHERE tr.block_time > now() - interval '7' day) AS prizes_7d,
  COUNT(*) FILTER (WHERE tr.block_time > now() - interval '24' hour) AS prizes_24h
FROM tokens_solana.transfers tr
JOIN tiers ti ON tr.from_owner = ti.wallet
WHERE tr.token_mint_address != 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  AND tr.amount = 1 AND tr.block_time > now() - interval '30' day
GROUP BY 1 ORDER BY prizes_30d DESC