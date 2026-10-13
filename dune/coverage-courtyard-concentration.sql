-- Varible — coverage diagnostic, ONE-SHOT: is Courtyard's peer-to-peer resale in
-- a month driven by a few wallets (wash), or broad? Per month from 2026-05: trades,
-- USD, distinct bidders/askers, self-trades (bidder = asker), the top bidder's and
-- top asker's share of trades, and trades whose token changed hands more than 5
-- times in the month (the ring signature).
WITH t AS (
  SELECT date_trunc('month', block_time) AS m,
         bytearray_substring(topic1, 13, 20) AS bidder,
         bytearray_substring(topic2, 13, 20) AS asker,
         topic3 AS token,
         CAST(bytearray_to_uint256(bytearray_substring(data, 33, 32)) AS DOUBLE) / 1e6 AS usd
  FROM polygon.logs
  WHERE contract_address IN (0x5e4943373c2198625bd441ae0629e9e7b4fb4797, 0x7fbf08a0ed3ef12565a61935ca6339bbecc25f48)
    AND topic0 = 0xa6ae807740439025f50884311ce0f96f5c3809a8f7170f9459dab1b14c9d8afd
    AND bytearray_substring(data, 13, 20) = 0x3c499c542cef5e3811e1192ce70d8cc03d5c3359
    AND bytearray_substring(topic1, 13, 20) <> 0x66dbff2ce099d19b4e8c5dc8b254ec7aeaf5e642
    AND block_time >= TIMESTAMP '2026-05-01 00:00:00'
),
tok AS (SELECT m, token, COUNT(*) AS n FROM t GROUP BY 1, 2),
bid AS (SELECT m, bidder, COUNT(*) AS n, SUM(usd) AS usd FROM t GROUP BY 1, 2),
ask AS (SELECT m, asker, COUNT(*) AS n FROM t GROUP BY 1, 2)
SELECT a.m,
       COUNT(*) AS trades,
       SUM(a.usd) AS usd,
       COUNT(DISTINCT a.bidder) AS bidders,
       COUNT(DISTINCT a.asker) AS askers,
       COUNT(*) FILTER (WHERE a.bidder = a.asker) AS self_trades,
       (SELECT MAX(n) FROM bid WHERE bid.m = a.m) AS top_bidder_trades,
       (SELECT MAX(usd) FROM bid WHERE bid.m = a.m) AS top_bidder_usd,
       (SELECT MAX(n) FROM ask WHERE ask.m = a.m) AS top_asker_trades,
       (SELECT SUM(n) FROM tok WHERE tok.m = a.m AND tok.n > 5) AS trades_on_tokens_traded_over_5x
FROM t a
GROUP BY 1
ORDER BY 1
