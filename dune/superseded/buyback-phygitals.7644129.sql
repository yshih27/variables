SELECT 
  COUNT(*) AS bb_30d, SUM(amount/power(10,6)) AS pay_30d,
  COUNT(*) FILTER (WHERE block_time > now() - interval '7' day) AS bb_7d,
  SUM(amount/power(10,6)) FILTER (WHERE block_time > now() - interval '7' day) AS pay_7d,
  COUNT(*) FILTER (WHERE block_time > now() - interval '24' hour) AS bb_24h,
  SUM(amount/power(10,6)) FILTER (WHERE block_time > now() - interval '24' hour) AS pay_24h
FROM tokens_solana.transfers
WHERE from_owner = '62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS'
  AND to_owner NOT IN ('42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e','5sn2nniGv88bxzxBDkqWP6i8bejsr9WwCpZXq2ZkLHgf')
  AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' AND block_time > now() - interval '30' day