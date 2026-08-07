-- TCG.market - CC secondary sales (Collector Crypt marketplace program CcmRKTuZ...)
-- One row per USDC-settled secondary sale: time, price, NFT mint, buyer, seller.
-- price_usd = MAX USDC transfer per tx (robust to escrow/fee splits). Native-SOL
-- transfers in these txs are fees/rent (validated), so USDC carries the sale value
-- and the high-end tail. The warmer derives 24h/7d/30d aggregates + a recent list.
WITH mkt AS (
  SELECT DISTINCT tx_id FROM solana.instruction_calls
  WHERE executing_account = 'CcmRKTuZCGJBWQwMHvDYApBRvSZNHqGJXkznqpDTSQUr'
    AND block_time > now() - interval '30' day
),
xf AS (
  SELECT t.tx_id, t.block_time, t.token_mint_address AS mint, t.amount, t.from_owner, t.to_owner
  FROM tokens_solana.transfers t JOIN mkt m ON m.tx_id = t.tx_id
  WHERE t.block_time > now() - interval '30' day
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
SELECT p.block_time, p.price_usd, n.mint AS nft_mint, n.buyer, n.seller
FROM price p JOIN nft n ON n.tx_id = p.tx_id AND n.rn = 1
WHERE p.price_usd > 1
ORDER BY p.block_time DESC