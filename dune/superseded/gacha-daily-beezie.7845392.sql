SELECT date_trunc('day', block_time) AS day, count(*) AS pulls, sum(amount) AS volume_usd
FROM tokens.transfers
WHERE blockchain = 'base'
  AND contract_address = 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913  
  AND "to" = 0x964e72ae6be07a191be1778dbc52457272a53154              
GROUP BY 1 ORDER BY 1