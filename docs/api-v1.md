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

`data.points` = `[{ ts, value, n?, lo?, hi? }]` (price points carry sample size
+ IQR band). `data.stats` (price only) = 30/90d return + beta/correlation vs BTC.

### GET /api/v1/benchmarks

External benchmarks on the same rebased axis — overlay them on the index.

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
behind `activeListings`.
