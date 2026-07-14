# API v1 — attribution-required free tier (B9-3)

Read-only JSON over the same readers the site uses. Three endpoints, one auth
scheme, one envelope.

## Auth

Every request needs an API key — either header or query param:

```
curl -H "Authorization: Bearer <key>" "https://<site>/api/v1/index"
curl "https://<site>/api/v1/index?api_key=<key>"
```

Keys are hand-issued: add `label:secret` pairs to the `API_V1_KEYS` env var
(comma-separated) and redeploy. The label is the key's identity — it names the
quota bucket and the attribution owner. Per-key quota is `API_V1_DAILY_QUOTA`
requests per UTC day (default 1000); usage rides in `X-Quota-Limit` /
`X-Quota-Remaining` response headers, and over-quota returns `429`.

**Terms:** free tier requires visible attribution with a link to the site
wherever the data is displayed. The terms are repeated in-band in every
response (`meta.terms`).

## Envelope

```json
{ "ok": true, "meta": { "generatedAt": "…", "attribution": "…", "terms": "…" }, "data": { … } }
```

Errors: `{ "ok": false, "error": "…" }` with 400 (bad params), 401 (no key),
403 (unknown key), 429 (quota), 503 (API not configured).

## Index naming (the canonical ticker registry)

Every index belongs to **The Variable Index** family (nickname "the V"). Each has a
ticker `V-<CODE>` and a display name `The Variable <X> Index`. Codes are derived from
the IP catalog — this API is the source of truth, so hitting `/api/v1/index` returns
the `ticker` + `indexName` for any entity you ask for (build a registry by iterating).

| entity | key | ticker | name |
|---|---|---|---|
| market | `total` | `V-MKT` | The Variable Market Index |
| category | `tcg` | `V-TCG` | The Variable TCG Index |
| category | `sports` | `V-SPT` | The Variable Sports Index |
| ip | `pokemon` | `V-PKM` | The Variable Pokémon Index |
| ip | `one_piece` | `V-OP` | The Variable One Piece Index |
| ip | `yugioh` | `V-YGO` | The Variable Yu-Gi-Oh! Index |
| ip | … | `V-<short>` | … (one per catalog IP) |

The table above is illustrative; the live set is whatever the catalog defines. Ask
the API — `GET /api/v1/index?entity=ip&key=<key>` echoes that index's `ticker` +
`indexName` in `data`.

## Endpoints

### GET /api/v1/index

The rebased index series (100 = value at `from`).

| param | values | default |
|---|---|---|
| `entity` | `market` \| `category` \| `ip` | `market` |
| `key` | entity key (e.g. `total`, `pokemon`) | `total` |
| `kind` | `price` (constant-quality, weekly) \| `mcap` (market size) | `price` |
| `from` | ISO date to rebase at | `2000-01-01` (= inception) |
| `freq` | `daily` \| `weekly` (mcap only; price is natively weekly) | `daily` |

`data.ticker` + `data.indexName` identify the index (e.g. `V-PKM`, "The Variable
Pokémon Index"). `data.points` = `[{ ts, value, n?, lo?, hi? }]` (price points carry
sample size + IQR band). `data.stats` (price only) = 30/90d return + beta/correlation
vs BTC.

### GET /api/v1/benchmarks

External benchmarks on the same rebased axis — overlay them on **any** index series
(they reference no single index, so no ticker is attached).

| param | values | default |
|---|---|---|
| `symbols` | comma list of `BTC,ETH,SP500,NASDAQ,GOLD` | all |
| `from` | ISO date to rebase at | `2000-01-01` |
| `freq` | `daily` \| `weekly` | `daily` |

`data.series` = `{ SYMBOL: [{ ts, value }] }`.

### GET /api/v1/trending

Trending cards (grouped by card type: name × set × grade × IP × platform).

| param | values | default |
|---|---|---|
| `window` | `24h` \| `7d` | `24h` |
| `limit` | 1–50 | 12 |
| `sort` | `huntPressure` \| `momentum` | `huntPressure` |
| `ip` / `platform` / `grade` | optional slice filters | — |

`data.cards` = the TrendingCard rows (trades, momentum, activeListings,
huntPressure, volumeUsd, buyLinks…); `data.floatAsOf` = listings-snapshot age
behind `activeListings`. When sliced by `ip`, `data.index` = `{ ticker, indexName }`
for that IP's index (e.g. `V-PKM`); a platform/grade-only slice sets `data.index` null.

### GET /api/v1/series

Raw metric-spine series on demand — the underlying daily time-series behind the
indices (for building custom charts). `/index` + `/benchmarks` give rebased index +
benchmark series; this gives the raw metric.

| param | values | default |
|---|---|---|
| `entity` | `market` \| `platform` \| `ip` \| `card` \| `set` \| `grade` \| `platform_ip` \| `benchmark` | `market` |
| `key` | entity key; **omit for the whole leaderboard** (all keys) | — |
| `metric` | `volume_usd` \| `gacha_volume_usd` \| `trades` \| `active_wallets` \| `cards_traded` \| `cards` \| `mcap_usd` \| `floor_usd` \| `holders` | `volume_usd` |
| `from` | ISO date lower bound (takes precedence over `window`) | — |
| `window` | `7d` \| `14d` \| `30d` \| `90d` \| `180d` \| `6m` \| `365d` \| `1y` \| `all` | `all` |
| `freq` | `daily` \| `weekly` | `daily` |
| `rebase` | `true` → rebase to 100 at window start | `false` |

**Composite keys** (dominance entities):
- `set` → `"{ip}:{setName}"` — e.g. `pokemon:Obsidian Flames`
- `grade` → `"{ip}:{gradeLabel}"` — e.g. `pokemon:PSA 10`
- `platform_ip` → `"{platform}:{ip}"` — e.g. `collector-crypt:pokemon`

With a `key`: `data` = `{ entity, key, metric, unit, from, freq, rebasedTo?, points: [{ ts, value }] }`.
Without a `key`: `data.series` = `{ "<entity_key>": [{ ts, value }] }` for every key.

Notes: `weekly` resamples per ISO week (Monday) — **sum** for flow metrics
(volume/trades/wallets/cards), **last** for stock (mcap/floor/holders). `rebase`
uses the index rebase (daily, forward-filled, drops non-positive) — best for
stock/positive metrics. `unit` is `usd` or `count`.
