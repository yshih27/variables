-- Varible — Courtyard exchange daily history, ONE-SHOT backfill (not scheduled).
-- Every TradeExecuted on Courtyard's two exchange operators (deployed 2025-09-09
-- and 2025-10-10) over [{{start}}, {{end}}), in native USDC, per UTC day, split:
--   p2p_*     : every bidder but Courtyard's operations wallet — resale;
--   buyback_* : Courtyard's operations wallet as bidder — USDC out to players.
-- The live feed is scripts/warm-courtyard-exchange.ts (public RPC); this fills
-- the spine's history before it. Run by scripts/backfill-courtyard-exchange-history.ts.
-- topic0 = keccak("TradeExecuted(address,address,uint256,address,uint256,bytes,uint256)").
WITH t AS (
  SELECT block_date AS day,
         bytearray_substring(topic1, 13, 20) AS bidder,
         CAST(bytearray_to_uint256(bytearray_substring(data, 33, 32)) AS DOUBLE) / 1e6 AS usd
  FROM polygon.logs
  WHERE contract_address IN (0x5e4943373c2198625bd441ae0629e9e7b4fb4797, 0x7fbf08a0ed3ef12565a61935ca6339bbecc25f48)
    AND topic0 = 0xa6ae807740439025f50884311ce0f96f5c3809a8f7170f9459dab1b14c9d8afd
    AND bytearray_substring(data, 13, 20) = 0x3c499c542cef5e3811e1192ce70d8cc03d5c3359
    AND block_time >= CAST('{{start}}' AS timestamp)
    AND block_time <  CAST('{{end}}' AS timestamp)
)
SELECT day,
       CAST(COUNT(*) FILTER (WHERE bidder <> 0x66dbff2ce099d19b4e8c5dc8b254ec7aeaf5e642) AS BIGINT) AS p2p_trades,
       CAST(COALESCE(SUM(usd) FILTER (WHERE bidder <> 0x66dbff2ce099d19b4e8c5dc8b254ec7aeaf5e642), 0) AS DOUBLE) AS p2p_usd,
       CAST(COUNT(*) FILTER (WHERE bidder = 0x66dbff2ce099d19b4e8c5dc8b254ec7aeaf5e642) AS BIGINT) AS buyback_trades,
       CAST(COALESCE(SUM(usd) FILTER (WHERE bidder = 0x66dbff2ce099d19b4e8c5dc8b254ec7aeaf5e642), 0) AS DOUBLE) AS buyback_usd
FROM t
GROUP BY 1
ORDER BY 1
