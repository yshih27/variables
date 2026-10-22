-- Beezie Claw trace — one-shot diagnostic (Oct 22 2026).
-- The Claw contract on Base took ~$100K a day in USDC until ~Oct 19; a direct
-- RPC read found no USDC into it in the 5 hours to Oct 22 12:15Z, and the daily
-- gacha query's last Beezie day is Oct 19. Where do Claw payments go now?
--   part 'hour'      — USDC into the old Claw per hour since Oct 17: when it stopped.
--   part 'recipient' — where the wallets that paid it Oct 13–19 sent USDC since
--                      Oct 20, top 25 by distinct paying wallets: a new Claw
--                      contract shows up as one address most of them now pay.
-- Same table and predicates as the Beezie branch of gacha-daily-all-platforms.sql
-- (tokens.transfers, blockchain 'base', USDC, decimal-adjusted `amount`); one scan
-- per part, no per-group subqueries (cost notes above).
WITH payers AS (
  SELECT DISTINCT "from" AS wallet
  FROM tokens.transfers
  WHERE blockchain = 'base'
    AND contract_address = 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
    AND "to" = 0x964e72ae6be07a191be1778dbc52457272a53154
    AND block_time >= TIMESTAMP '2026-10-13 00:00:00'
    AND block_time <  TIMESTAMP '2026-10-20 00:00:00'
),
claw_hours AS (
  SELECT
    'hour' AS part,
    CAST(date_trunc('hour', block_time) AS VARCHAR) AS k,
    COUNT(*) AS n,
    COUNT(DISTINCT "from") AS wallets,
    CAST(SUM(amount) AS DOUBLE) AS usd,
    CAST(NULL AS VARCHAR) AS first_seen
  FROM tokens.transfers
  WHERE blockchain = 'base'
    AND contract_address = 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
    AND "to" = 0x964e72ae6be07a191be1778dbc52457272a53154
    AND block_time >= TIMESTAMP '2026-10-17 00:00:00'
  GROUP BY 2
),
recipients AS (
  SELECT
    'recipient' AS part,
    '0x' || lower(to_hex(t."to")) AS k,
    COUNT(*) AS n,
    COUNT(DISTINCT t."from") AS wallets,
    CAST(SUM(t.amount) AS DOUBLE) AS usd,
    CAST(MIN(t.block_time) AS VARCHAR) AS first_seen
  FROM tokens.transfers t
  JOIN payers p ON t."from" = p.wallet
  WHERE t.blockchain = 'base'
    AND t.contract_address = 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
    AND t.block_time >= TIMESTAMP '2026-10-20 00:00:00'
  GROUP BY 2
  ORDER BY 4 DESC
  LIMIT 25
)
SELECT * FROM claw_hours
UNION ALL
SELECT * FROM recipients
ORDER BY part, k
