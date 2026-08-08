
SELECT CAST(amount AS INTEGER) AS pack_price,
  COUNT(*) AS pulls_30d, SUM(amount) AS volume_30d,
  COUNT(*) FILTER (WHERE block_time > now() - interval '7' day) AS pulls_7d,
  SUM(amount) FILTER (WHERE block_time > now() - interval '7' day) AS volume_7d,
  COUNT(*) FILTER (WHERE block_time > now() - interval '24' hour) AS pulls_24h,
  SUM(amount) FILTER (WHERE block_time > now() - interval '24' hour) AS volume_24h
FROM tokens_base.transfers
WHERE "to" = 0x964E72Ae6BE07a191bE1778DbC52457272a53154 AND contract_address = 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
  AND amount > 0 AND block_time > now() - interval '30' day
GROUP BY 1 ORDER BY volume_30d DESC