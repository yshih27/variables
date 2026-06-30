-- TCG.market — Phygitals gacha DAILY (cleaned)
-- Based on validated query 7642707. Two changes vs the raw clone:
--   1. Dropped the CAST(amount AS INTEGER) "pack_price" column — it truncated small
--      amounts into noisy 0/1/2/3/4/5 buckets (dust + Lucky Draw/Claw mini-games).
--      Real pack tiers come from the native pull feed, not this truncation.
--   2. Added `amount >= 1` to drop sub-$1 dust/refunds (the "pack_price=0" rows).
-- Keeps all real gacha spend (packs + Lucky Draw). No time filter = full history.
-- Output: day, pulls, volume_usd.  (To restrict to PACKS only, change >= 1 to >= 10.)
SELECT
  date_trunc('day', block_time) AS day,
  COUNT(*) AS pulls,
  SUM(amount/power(10,6)) AS volume_usd
FROM tokens_solana.transfers
WHERE to_owner IN ('62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS','42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e')
  AND from_owner NOT IN ('62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS','42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e','5sn2nniGv88bxzxBDkqWP6i8bejsr9WwCpZXq2ZkLHgf')
  AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  AND amount/power(10,6) >= 1
GROUP BY 1
ORDER BY 1
