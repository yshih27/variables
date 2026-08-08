
WITH tiers AS (
  SELECT * FROM (VALUES
    ('SPrT7eFrCM9UJ4j7Xf9iktKCoBwJjfykFbiNbRsKQm8','SPrT'),
    ('LGNDXqcm6U57QQ6Ad7icZ6oizkAVKRWrw97KwZy5nVf','LGND'),
    ('LGNDfXQFMiRMz3qqTNAREmRFQutMvazqqRrzn5i98uj','LGND'),
    ('EpicWWZspT1trKndbDDr29ULViN56rN5vofWSKZp8ePF','Epic'),
    ('epiC3zkqa1RfcPMMM1Kc8m3GZGDwF2RmjbfA3g1BBjn','Epic')
  ) AS t(wallet, tier)
)
SELECT tr.block_time, tr.token_mint_address AS mint, ti.tier
FROM tokens_solana.transfers tr
JOIN tiers ti ON tr.from_owner = ti.wallet
WHERE tr.token_mint_address != 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  AND tr.amount = 1 AND tr.block_time > now() - interval '7' day
ORDER BY tr.block_time DESC