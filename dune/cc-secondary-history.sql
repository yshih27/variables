-- TCG.market - CC secondary sales HISTORY, one window per execution.
-- The same logic as cc-secondary.sql (query 7675297) - one row per USDC-settled
-- secondary sale on the Collector Crypt marketplace program, priced at the
-- largest USDC transfer in the transaction - plus tx_id, over [{{start}}, {{end}}).
-- Parameters (Dune "datetime" type, UTC): {{start}} inclusive, {{end}} exclusive.
--
-- Read by scripts/backfill-secondary-sales.ts --platform=collector-crypt --apply,
-- one calendar month per execution, into the secondary_sales store.
-- ⚠️ PAID: every month is an execution and an export on a plan already over its
-- included credits. Run `--count` first (dune/cc-secondary-history-count.sql) and
-- run this only after the owner approves the measured cost.
-- ⚠️ Saved to the Dune workspace by the orchestrator; its id goes in
-- DUNE_CC_SECONDARY_HISTORY_QUERY_ID (src/lib/dune/queryIds.ts).
WITH mkt AS (
  SELECT DISTINCT tx_id FROM solana.instruction_calls
  WHERE executing_account = 'CcmRKTuZCGJBWQwMHvDYApBRvSZNHqGJXkznqpDTSQUr'
    AND block_time >= CAST('{{start}}' AS timestamp)
    AND block_time <  CAST('{{end}}' AS timestamp)
),
xf AS (
  SELECT t.tx_id, t.block_time, t.token_mint_address AS mint, t.amount, t.from_owner, t.to_owner
  FROM tokens_solana.transfers t JOIN mkt m ON m.tx_id = t.tx_id
  WHERE t.block_time >= CAST('{{start}}' AS timestamp)
    AND t.block_time <  CAST('{{end}}' AS timestamp)
),
price AS (
  SELECT tx_id, MAX(amount/power(10,6)) AS price_usd, MAX(block_time) AS block_time
  FROM xf WHERE mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' GROUP BY tx_id
),
nft AS (
  SELECT tx_id, mint, from_owner AS seller, to_owner AS buyer,
         ROW_NUMBER() OVER (PARTITION BY tx_id ORDER BY amount ASC) AS rn
  FROM xf
  WHERE mint NOT IN ('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        'So11111111111111111111111111111111111111111','So11111111111111111111111111111111111111112')
    AND amount = 1
)
SELECT p.block_time, p.price_usd, n.mint AS nft_mint, n.buyer, n.seller, p.tx_id
FROM price p JOIN nft n ON n.tx_id = p.tx_id AND n.rn = 1
WHERE p.price_usd > 1
ORDER BY p.block_time ASC
