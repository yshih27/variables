-- Beezie Claw candidate — one-shot diagnostic (Oct 22 2026), after
-- beezie-claw-trace.sql: the old Claw's last USDC came in the Oct 19 06:00Z hour,
-- and from Oct 20 00:00Z three of the wallets that paid it pay 0x4cd00e…bc31.
-- Daily USDC into each from EVERY sender since Oct 15: a successor to the Claw
-- takes over its volume and its senders on the day the old one goes quiet.
SELECT
  CASE WHEN "to" = 0x964e72ae6be07a191be1778dbc52457272a53154 THEN 'old_claw' ELSE 'candidate' END AS dest,
  CAST(date_trunc('day', block_time) AS VARCHAR) AS day,
  COUNT(*) AS n,
  COUNT(DISTINCT "from") AS wallets,
  CAST(SUM(amount) AS DOUBLE) AS usd,
  CAST(MIN(block_time) AS VARCHAR) AS first_seen
FROM tokens.transfers
WHERE blockchain = 'base'
  AND contract_address = 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
  AND "to" IN (0x964e72ae6be07a191be1778dbc52457272a53154, 0x4cd00e387622c35bddb9b4c962c136462338bc31)
  AND block_time >= TIMESTAMP '2026-10-15 00:00:00'
GROUP BY 1, 2
ORDER BY 1, 2
