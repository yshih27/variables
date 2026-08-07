-- TCG.market — gacha (primary) LIVE windows · ALL PLATFORMS
-- ONE execution replacing four: 7642633 (CC) / 7642705 (Beezie) /
-- 7642707 (Phygitals) / 7642710 (Courtyard). Dune bills per execution, so the
-- fleet was paying 4× for what is one fan-out scan.
--
-- Row shape: platform, pack_price, pulls_30d, volume_30d, pulls_7d, volume_7d,
-- pulls_24h, volume_24h. The warmer splits rows by `platform` client-side.
--   • CC / Beezie / Phygitals → one row per pack_price tier.
--   • Courtyard              → ONE row, pack_price NULL (it has no pack tiers;
--     the old query called these txns_* — normalised to pulls_* here).
--
-- ⚠️ Every branch's FROM/WHERE is copied VERBATIM from its original query. In
-- particular CC's pack-price allowlist is NARROWER here than in the daily query
-- (no 151 / 2500 / 5000) — that asymmetry is pre-existing. Do not "harmonise"
-- these lists without re-checking the loaders; it would move published numbers.

SELECT 'collector-crypt' AS platform,
       CAST(amount/power(10,6) AS INTEGER) AS pack_price,
       CAST(COUNT(*) AS BIGINT) AS pulls_30d,
       CAST(SUM(amount/power(10,6)) AS DOUBLE) AS volume_30d,
       CAST(COUNT(*) FILTER (WHERE block_time > now() - interval '7' day) AS BIGINT) AS pulls_7d,
       CAST(SUM(amount/power(10,6)) FILTER (WHERE block_time > now() - interval '7' day) AS DOUBLE) AS volume_7d,
       CAST(COUNT(*) FILTER (WHERE block_time > now() - interval '24' hour) AS BIGINT) AS pulls_24h,
       CAST(SUM(amount/power(10,6)) FILTER (WHERE block_time > now() - interval '24' hour) AS DOUBLE) AS volume_24h
FROM tokens_solana.transfers
WHERE to_owner IN ('GachazZscHZ5bn3vnq1yEC4zpYdhAYJBzuKJwSJksc9z','GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3','96DULv1BqYfe5wyMr6pVUNC6Uyrtj6yr3tNi6VtfwW9s') AND from_owner NOT IN ('BAxTk97HsaJqbnbFmTiQTaL4KSRvJ8Y65ArZCsP6vA5M','21KhtC7y2JGYvwc8dcGqTdbrudbM8fgMPJsVwxRQqdY8','DFEstpYN3fsz93AC9v2ujzPPngPgodqH2xxopuyfSsAE','HW2HRqN1pXQGH9GfP9xet4XwqtLqFyYGDNRKjUAVgh9u','HighJBfnAaqH9cKkeMErQFJZ4ATxQJwxqFupX6zaKTns','LGNDXqcm6U57QQ6Ad7icZ6oizkAVKRWrw97KwZy5nVf','EpicWWZspT1trKndbDDr29ULViN56rN5vofWSKZp8ePF','Mid9NeCpPNxP59fAdsLgMLy7BYexxXFw52ZP58Jrney','Lowq9dkpY43VpjfYeRjtKfGA6JtB7HaMmwQgXkjHLvN','Low6UekJP3QrFVMfNRTL8CPK2SiGFhvp57sgF2pkmVu','miDtj3vgdxVykHzRyFwyG8MXpvK8eQqamSLVdBr7WPt','HiGHqwYddP5N2waqUmXPdaASpMpUEvfqPr2fSawctEb','epiC3zkqa1RfcPMMM1Kc8m3GZGDwF2RmjbfA3g1BBjn','LGNDfXQFMiRMz3qqTNAREmRFQutMvazqqRrzn5i98uj','SPrT7eFrCM9UJ4j7Xf9iktKCoBwJjfykFbiNbRsKQm8')
  AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  AND amount/power(10,6) IN (50,100,250,25,75,80,1000) AND block_time > now() - interval '30' day
GROUP BY CAST(amount/power(10,6) AS INTEGER)

UNION ALL

SELECT 'beezie' AS platform,
       CAST(amount AS INTEGER) AS pack_price,
       CAST(COUNT(*) AS BIGINT) AS pulls_30d,
       CAST(SUM(amount) AS DOUBLE) AS volume_30d,
       CAST(COUNT(*) FILTER (WHERE block_time > now() - interval '7' day) AS BIGINT) AS pulls_7d,
       CAST(SUM(amount) FILTER (WHERE block_time > now() - interval '7' day) AS DOUBLE) AS volume_7d,
       CAST(COUNT(*) FILTER (WHERE block_time > now() - interval '24' hour) AS BIGINT) AS pulls_24h,
       CAST(SUM(amount) FILTER (WHERE block_time > now() - interval '24' hour) AS DOUBLE) AS volume_24h
FROM tokens_base.transfers
WHERE "to" = 0x964E72Ae6BE07a191bE1778DbC52457272a53154 AND contract_address = 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
  AND amount > 0 AND block_time > now() - interval '30' day
GROUP BY CAST(amount AS INTEGER)

UNION ALL

SELECT 'phygitals' AS platform,
       CAST(amount/power(10,6) AS INTEGER) AS pack_price,
       CAST(COUNT(*) AS BIGINT) AS pulls_30d,
       CAST(SUM(amount/power(10,6)) AS DOUBLE) AS volume_30d,
       CAST(COUNT(*) FILTER (WHERE block_time > now() - interval '7' day) AS BIGINT) AS pulls_7d,
       CAST(SUM(amount/power(10,6)) FILTER (WHERE block_time > now() - interval '7' day) AS DOUBLE) AS volume_7d,
       CAST(COUNT(*) FILTER (WHERE block_time > now() - interval '24' hour) AS BIGINT) AS pulls_24h,
       CAST(SUM(amount/power(10,6)) FILTER (WHERE block_time > now() - interval '24' hour) AS DOUBLE) AS volume_24h
FROM tokens_solana.transfers
WHERE to_owner IN ('62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS','42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e') AND from_owner NOT IN ('62Q9eeDY3eM8A5CnprBGYMPShdBjAzdpBdr71QHsS8dS','42oNTirN62M3MkA52KiTTGyf9RnDh2YvqNdpFSgkf97e','5sn2nniGv88bxzxBDkqWP6i8bejsr9WwCpZXq2ZkLHgf')
  AND token_mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  AND amount/power(10,6) > 0 AND block_time > now() - interval '30' day
GROUP BY CAST(amount/power(10,6) AS INTEGER)

UNION ALL

SELECT 'courtyard' AS platform,
       CAST(NULL AS INTEGER) AS pack_price,
       CAST(COUNT(*) AS BIGINT) AS pulls_30d,
       CAST(SUM(amount) AS DOUBLE) AS volume_30d,
       CAST(COUNT(*) FILTER (WHERE block_time > now() - interval '7' day) AS BIGINT) AS pulls_7d,
       CAST(SUM(amount) FILTER (WHERE block_time > now() - interval '7' day) AS DOUBLE) AS volume_7d,
       CAST(COUNT(*) FILTER (WHERE block_time > now() - interval '24' hour) AS BIGINT) AS pulls_24h,
       CAST(SUM(amount) FILTER (WHERE block_time > now() - interval '24' hour) AS DOUBLE) AS volume_24h
FROM tokens_polygon.transfers
WHERE contract_address = 0x3c499c542cef5e3811e1192ce70d8cc03d5c3359
  AND "to" IN (0xedf073581267d82b6e4fd63b5fb288f1876555cd,0x5e9e7841198c34bad39c7344c6e2829ebf39b8b3,0xda92c437e599b2c973229ca2ae5fb17ec2cf04a9,0x92714d4827fa2e396d9f753976cc8a3d395b8064,0x5556bc8e4c6482e39197425e96e9fb5ef5ba05d2,0x7fc1afb29861fd4a7dfb7859b5271d3c75e4abbd,0x4cd41debc6d038317379df1d059938894362ef7f,0x13e7cdcabce0fca98df4eb5d34619144d45b6b76,0x43f1c23fbf8e3fb964a1337b1e697f04f7e38a5c,0x7ee9f40d48f4e58dc9f21fbd2335c4f2ec1f3d78,0x33d39c79582704fc3fae79e818889cacb8cf5e6c,0x0fc3f443d73d10866d1dff51af4d9f5a31ba2ffc,0x554ad79f0c9d512b624b9bfc2e1ffd4cf50cf220,0x0af477ac793c3ee69bfcad83e148add148705d79,0x5a09ed135b1a9c5bf1a66084d4597d4e9f29ceb1,0xa0e6cb4c42f0fe31846c48f2693bfe879bc10534,0xfaad7036e8b4f8d5613023476485e49d1eafa044,0x29804859dbe973e844c643654269f1e16e546720,0xa695dfa7a885ffaafce414ded322d18ea3f24679,0x31d058b5e02c8b01c749e6844d86cdd3f2962cd7,0x776023a4573bd972c4c3e2a76f611d3c2bef516e)
  AND block_time > now() - interval '30' day
