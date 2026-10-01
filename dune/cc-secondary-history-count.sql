-- TCG.market - CC secondary sales HISTORY, COUNTED per month: the cost probe the
-- backfill runs first. The same CTEs as cc-secondary-history.sql over the same
-- [{{start}}, {{end}}), grouped by calendar month: one small row per month, so
-- its export costs almost nothing, and its EXECUTION scans the same data the
-- backfill's executions will - which is what makes its measured credit cost the
-- estimate for theirs.
-- Parameters (Dune "datetime" type, UTC): {{start}} inclusive, {{end}} exclusive.
-- ⚠️ Saved to the Dune workspace by the orchestrator; its id goes in
-- DUNE_CC_SECONDARY_HISTORY_COUNT_QUERY_ID (src/lib/dune/queryIds.ts).
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
SELECT date_trunc('month', p.block_time) AS month, count(*) AS sales, sum(p.price_usd) AS volume_usd
FROM price p JOIN nft n ON n.tx_id = p.tx_id AND n.rn = 1
WHERE p.price_usd > 1
GROUP BY 1
ORDER BY 1
