
SELECT CAST(amount/power(10,6) AS INTEGER) AS pack_price,
  COUNT(*) AS pulls_30d, SUM(amount/power(10,6)) AS volume_30d,
  COUNT(*) FILTER (WHERE block_time > now() - interval '7' day) AS pulls_7d,
  SUM(amount/power(10,6)) FILTER (WHERE block_time > now() - interval '7' day) AS volume_7d,
  COUNT(*) FILTER (WHERE block_time > now() - interval '24' hour) AS pulls_24h,
  SUM(amount/power(10,6)) FILTER (WHERE block_time > now() - interval '24' hour) AS volume_24h
FROM tokens_solana.transfers
WHERE to_owner IN ('62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS','42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e') AND from_owner NOT IN ('62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS','42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e','5sn2nniGv88bxzxBDkqWP6i8bejsr9WwCpZXq2ZkLHgf')
  AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  AND amount/power(10,6) > 0 AND block_time > now() - interval '30' day
GROUP BY 1 ORDER BY volume_30d DESC