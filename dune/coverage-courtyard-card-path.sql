-- Varible — coverage diagnostic, ONE-SHOT (not scheduled, not read by src/).
-- Courtyard's card (Stripe) pack path over the last 30 complete UTC days: every
-- transaction carrying an event from the card-path minter 0x39cb23…10fb, split by
-- the event's signature (topic0's first 4 bytes), with the native USDC that the
-- SAME transaction pays Courtyard's operations wallet 0x66dbff…e642. Summing only
-- inside those transactions keeps the wallet's other inflows (forwarded
-- wallet-paid packs, buyback flows) out. Per the research (§2a, Oct 12):
-- 0xbc31c4f1 = card path with a USDC leg, 0x36248cf5 = "stripe_payment_intent",
-- no on-chain payment. The daily query counts neither (0x66dbff is not one of
-- its 21 receivers).
WITH card_tx AS (
  SELECT DISTINCT block_date, tx_hash, bytearray_substring(topic0, 1, 4) AS sig
  FROM polygon.logs
  WHERE contract_address = 0x39cb23e079084cfd3e0e1bee896fbf9175fa10fb
    AND block_date >= date_trunc('day', now()) - interval '30' day
    AND block_date <  date_trunc('day', now())
),
usdc_leg AS (
  SELECT tx_hash, SUM(amount) AS usd
  FROM tokens_polygon.transfers
  WHERE contract_address = 0x3c499c542cef5e3811e1192ce70d8cc03d5c3359
    AND "to" = 0x66dbff2ce099d19b4e8c5dc8b254ec7aeaf5e642
    AND block_date >= date_trunc('day', now()) - interval '30' day
    AND block_date <  date_trunc('day', now())
    AND tx_hash IN (SELECT tx_hash FROM card_tx)
  GROUP BY 1
)
SELECT c.block_date AS day,
       c.sig,
       CAST(COUNT(*) AS BIGINT) AS txs,
       CAST(COUNT(u.tx_hash) AS BIGINT) AS txs_with_usdc,
       CAST(SUM(COALESCE(u.usd, 0)) AS DOUBLE) AS usdc_usd
FROM card_tx c
LEFT JOIN usdc_leg u ON u.tx_hash = c.tx_hash
GROUP BY 1, 2
ORDER BY 1, 2
