# Dune backfill queries — historical data, categorized by platform × IP

Goal: fill the time-series spine with **platform** and **category (IP)** history for both
**marketplace (secondary)** and **gacha (primary)**, going back as far as Dune retains
(~90–365d), with **no Rarible**.

## Output contracts (so the queries wire straight into our warmers)

The warmer reads columns by name — please keep these exact aliases.

**Secondary (sale-level)** — same shape as CC's existing `7675297`:
| column | type | notes |
|---|---|---|
| `block_time` | timestamp | sale time |
| `nft_mint` | varchar | the NFT id; **joins `cards.token_id`** for the IP rollup |
| `price_usd` | double | USD value of the sale |
| `buyer` | varchar | for unique-wallet counts |
| `seller` | varchar | for unique-wallet counts |

**Gacha (daily)**:
| column | type | notes |
|---|---|---|
| `day` | timestamp | `date_trunc('day', block_time)` (UTC) |
| `pack_price` | double | keep for tier mix (gacha only); omit if not available |
| `pulls` | bigint | `count(*)` |
| `volume_usd` | double | summed spend |

**IP categorization happens in our warmer, not in Dune** — the query returns `nft_mint`
and we join it to `cards.ip_key`. So none of these need to know about Pokémon vs sports.

---

## 1. Beezie — secondary sales (Base) ✅ replaces Rarible

```sql
-- TCG.market — Beezie secondary (Base). nft.trades spans every decoded marketplace
-- on Base (OpenSea/Blur/…) — broader than the Rarible aggregator it replaces.
SELECT
  block_time,
  cast(token_id as varchar) AS nft_mint,   -- ERC-721 tokenId → joins cards.token_id
  amount_usd                AS price_usd,
  cast(buyer  as varchar)   AS buyer,
  cast(seller as varchar)   AS seller,
  project                   AS marketplace  -- debug only
FROM nft.trades
WHERE blockchain = 'base'
  AND nft_contract_address = 0xbb5ec6fd4b61723bd45c399840f1d868840ca16f
  AND amount_usd > 0
  AND block_time > now() - interval '365' day
ORDER BY block_time DESC
```

## 2. Courtyard — secondary sales (Polygon) ✅ replaces Rarible

```sql
-- TCG.market — Courtyard secondary (Polygon). Captures the OpenSea volume we
-- currently read via Rarible, plus any other Polygon marketplace, plus history.
SELECT
  block_time,
  cast(token_id as varchar) AS nft_mint,
  amount_usd                AS price_usd,
  cast(buyer  as varchar)   AS buyer,
  cast(seller as varchar)   AS seller,
  project                   AS marketplace
FROM nft.trades
WHERE blockchain = 'polygon'
  AND nft_contract_address = 0x251be3a17af4892035c37ebf5890f4a4d889dcad
  AND amount_usd > 0
  AND block_time > now() - interval '365' day
ORDER BY block_time DESC
```

> **Sanity check after running 1 & 2:** compare 24h/7d totals to the live Rarible
> numbers. If Beezie looks low, its **native** marketplace (`0x80d7C04B…820D`) isn't in
> `nft.trades` and needs a supplemental custom decode — ping me and I'll write it.
> `token_id` must match `cards.token_id` format for the IP join (Courtyard's `cards`
> is empty today, so it's platform-level until the traded-mint enrichment lands).

## 3. Beezie — gacha "Claw" daily (Base) ✅

```sql
-- TCG.market — Beezie Claw daily. USDC IN to the Claw = pull spend
-- (operator forwards are OUTflows, never counted).
SELECT
  date_trunc('day', block_time) AS day,
  count(*)                      AS pulls,
  sum(amount)                   AS volume_usd  -- USDC; amount is decimal-adjusted (≈ USD)
FROM tokens.transfers
WHERE blockchain = 'base'
  AND contract_address = 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913  -- USDC (Base)
  AND "to" = 0x964e72ae6be07a191be1778dbc52457272a53154              -- Beezie Claw
  AND block_time > now() - interval '365' day
GROUP BY 1
ORDER BY 1
```

## 4. Courtyard — primary (tokenization) daily (Polygon) ✅

```sql
-- TCG.market — Courtyard primary daily. USDC IN to the 20 gacha-spend receivers.
SELECT
  date_trunc('day', block_time) AS day,
  count(*)                      AS pulls,
  sum(amount)                   AS volume_usd
FROM tokens.transfers
WHERE blockchain = 'polygon'
  AND contract_address = 0x3c499c542cef5e3811e1192ce70d8cc03d5c3359  -- USDC (Polygon)
  AND "to" IN (
    0xedf073581267d82b6e4fd63b5fb288f1876555cd, 0x5e9e7841198c34bad39c7344c6e2829ebf39b8b3,
    0xda92c437e599b2c973229ca2ae5fb17ec2cf04a9, 0x92714d4827fa2e396d9f753976cc8a3d395b8064,
    0x5556bc8e4c6482e39197425e96e9fb5ef5ba05d2, 0x7fc1afb29861fd4a7dfb7859b5271d3c75e4abbd,
    0x4cd41debc6d038317379df1d059938894362ef7f, 0x13e7cdcabce0fca98df4eb5d34619144d45b6b76,
    0x43f1c23fbf8e3fb964a1337b1e697f04f7e38a5c, 0x7ee9f40d48f4e58dc9f21fbd2335c4f2ec1f3d78,
    0x33d39c79582704fc3fae79e818889cacb8cf5e6c, 0x0fc3f443d73d10866d1dff51af4d9f5a31ba2ffc,
    0x554ad79f0c9d512b624b9bfc2e1ffd4cf50cf220, 0x0af477ac793c3ee69bfcad83e148add148705d79,
    0x5a09ed135b1a9c5bf1a66084d4597d4e9f29ceb1, 0xa0e6cb4c42f0fe31846c48f2693bfe879bc10534,
    0xfaad7036e8b4f8d5613023476485e49d1eafa044, 0x29804859dbe973e844c643654269f1e16e546720,
    0xa695dfa7a885ffaafce414ded322d18ea3f24679, 0x31d058b5e02c8b01c749e6844d86cdd3f2962cd7,
    0x776023a4573bd972c4c3e2a76f611d3c2bef516e
  )
  AND block_time > now() - interval '365' day
GROUP BY 1
ORDER BY 1
```

## 5 & 6. CC + Phygitals — gacha daily (Solana) ♻️ clone your existing queries

Don't re-derive these — your `7642633` (CC) and `7642707` (Phygitals) already have the
**validated** Solana source table + wallet/exclusion/price filters. Just clone each and
swap the windowed aggregation for daily buckets, keeping the same `FROM`/`WHERE`:

```sql
-- daily-bucketed version of your validated CC (7642633) / Phygitals (7642707)
SELECT
  date_trunc('day', block_time) AS day,
  pack_price,                   -- your existing per-price expression (drop if N/A)
  count(*)                      AS pulls,
  sum(amount)                   AS volume_usd
FROM ( /* paste the exact FROM + WHERE from your existing query:
          USDC SPL mint, to_owner IN (gacha receivers),
          from_owner NOT IN (internal exclusions),
          CC: amount IN (25,50,75,80,100,250,1000) */ )
GROUP BY 1, 2
ORDER BY 1, 2
```

## 7. Phygitals — secondary (Solana cNFT) ⚠️ hard, defer

Phygitals cards are **compressed NFTs**: trades route through Bubblegum + Tensor/Magic
Eden, so the CC-style "USDC transfer per tx" parse doesn't apply, and `nft.trades` cNFT
coverage is unreliable. Recommend an **exploratory** query first (Tensor/ME Solana decoded
tables filtered to the two collection mints `BSG6Dy…` / `phygZD…`) before committing. Live
floor still comes from the Phygitals own API. Suggest landing 1–6 first.

## CC secondary — already done

`CC_SECONDARY_QUERY_ID = 7675297` already returns the secondary contract — no new query.

---

## What I do once you send query IDs

1. Register them in `src/lib/dune/queryIds.ts` (e.g. `SECONDARY_QUERY_IDS`, `GACHA_DAILY_QUERY_IDS`).
2. Rewire `src/lib/data/warmers/core.ts` + `scripts/backfill-history.ts` to read these
   instead of Rarible (Beezie/Courtyard secondary).
3. Extend `scripts/warm-metric-snapshots.ts` to bucket each into the spine —
   `platform`/`ip` × `volume_usd`/`trades` (secondary) and a new `gacha_volume_usd`
   (gacha), joining `nft_mint → cards.ip_key` for the IP rollup.
4. Then build the Beezie own-API client for the *live* secondary path.
```
