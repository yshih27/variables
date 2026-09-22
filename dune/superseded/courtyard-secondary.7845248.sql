-- 2. Courtyard secondary (Polygon)
-- Windowed to 30d, matching CC 7675297. The warmer only derives 24h/7d/30d
-- aggregates from this feed, and the spine persists daily history in Postgres
-- (upserts, never re-derived), so full history is never needed here. The
-- unbounded scan was billing ~2.7M Dune datapoints/day.
SELECT block_time, cast(token_id as varchar) AS nft_mint, amount_usd AS price_usd,
       cast(buyer as varchar) AS buyer, cast(seller as varchar) AS seller, project AS marketplace
FROM nft.trades
WHERE blockchain = 'polygon'
  AND nft_contract_address = 0x251be3a17af4892035c37ebf5890f4a4d889dcad
  AND amount_usd > 0
  AND block_time > now() - interval '30' day
ORDER BY block_time DESC