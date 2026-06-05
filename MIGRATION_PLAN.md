# TCG.market — Migration Plan: local prototype → global (Vercel + Supabase)

**Status:** DESIGN — awaiting approval before any code change.
**Target DB:** dedicated Supabase project `tsneiigqszqspqpdorxi` (separate account; isolated from Fuda's "TCG data" DB).
**Author:** systems/backend design pass, 2026-06-04.

---

## 0. The problem in one paragraph

Every number the site renders is read from `./.cache/` on local disk (~490 MB, dominated by **122,214** individual `cc-traits/*.json` files). Warmers are manual `tsx scripts/*.ts`, never scheduled, so data goes stale ("Live · 476h ago"). On a cache miss, pages fall back to **live Helius/Rarible** inside `unstable_cache(1h)` — that's the 30–60 s cold renders and the 429s, then frozen for an hour. And the same metric comes from a mix of sources (Dune / Helius / Rarible / RPC estimates) with no record of "as of when, from where," which is why the numbers feel untrustworthy. **None of this survives a move to Vercel**, because serverless has no shared writable disk: a cron that writes `.cache/` and a page that reads it run on different ephemeral instances.

Goal: one trustworthy, always-fresh, globally-served source of truth. Postgres becomes that source; warmers write to it on a schedule; pages read it cache-only; every table carries an honest `generated_at`.

---

## 1. Target architecture

```
   Dune ($349)  ┐        ┌──────── Scheduler (pluggable) ────────┐
   Helius DAS   ┼──used──▶│  GitHub Actions cron  (heavy/bulk)    │
   Rarible      ┤   by    │  Vercel Cron / Supabase pg_cron (fast)│
   CoinGecko    ┘ warmers └──────────────────┬────────────────────┘
                                             │ POST /api/cron/<name>  (CRON_SECRET)
                                             ▼
                              warmer core (refactored from scripts/*.ts)
                                             │ upsert rows + write source_freshness
                                             ▼
                          ┌──────────────────────────────────────┐
                          │   Supabase Postgres (tsneiigqsz…)     │  ← single source
                          │   cards · listings · sales · metrics  │     of truth,
                          │   · metric_snapshots · snapshots      │     replaces .cache/
                          │   · source_freshness                  │
                          └──────────────────┬───────────────────┘
                                             │ server-side reads, CACHE-ONLY
                                             │ (NO live external calls in request path)
                                             ▼
                          Next.js Server Components on Vercel
                          sub-second · honest "as of <generated_at>" per source
```

Three structural moves:

1. **Postgres replaces `.cache/`** as the one place warmers write and pages read. 125K trait rows + hourly snapshots is trivial for Postgres, and it becomes the **time-series spine** the `/card/[id]` depth needs.
2. **Warmers run on a schedule and write to Postgres**, never disk. Their logic is refactored so the same core function is called by both the existing CLI script (local/manual) and a new cron route (production).
3. **Pages read Postgres cache-only.** Kill the live fallback. Renders go sub-second and never stale mid-render. The UI shows a real per-source "as of," and "not tracked on this platform" instead of blank/zero cells.

---

## 2. The migration seam (why this is low-risk)

The codebase already funnels all data access through a small set of reader functions. **We rewrite only their internals (fs → Postgres) and keep their signatures.** Pages and fetchers are largely untouched.

| Reader (signature kept) | Today reads | New backing |
|---|---|---|
| `getCCMetadata(id)` / `getCCMetadataCachedOnly(ids)` — `ccTraits.ts` | `.cache/cc-traits/*` (122K files) | `cards` where `platform='collector-crypt'` |
| `getBeezieMetadata(id)` / `getBeezieMetadataCachedOnly(ids)` — `beezieTraits.ts` | `.cache/beezie-traits/*` | `cards` where `platform='beezie'` |
| `readMarketCap()` / `readMarketCapHistory()` — `marketcap.ts` | `marketcap.json` / `marketcap-history.json` | `ip_metrics` + `metric_snapshots` |
| `readListings()` — `listings.ts` | `listings.json` | `listings` |
| `readHolders()` — `holders.ts` | `holders.json` | `platform_metrics.holders` + `ip_metrics.holders_by_platform` |
| `readHistory(key)` — `history.ts` | `history/{key}.json` | `metric_snapshots` (`entity_type='platform'`, `metric='volume_usd'`) |
| `readGachaDune()` — `gachaDuneCache.ts` | `gacha-dune.json` | `snapshots` where `key='gacha'` |
| `readCCSales()` — `ccSalesCache.ts` | `cc-sales-24h.json` | `sales` where `platform='collector-crypt'` and `sold_at > now()-24h` |
| `getPlatformBuckets()` — `buckets.ts` | caches **+ live Helius/Rarible fallback** | precomputed `platform_metrics` + `sales` reads — **live fallback deleted** |

`sources.ts` (verified contracts, wallet lists), `ipCatalog.ts` (IP classification), and `classifyIP()` stay in code — they're configuration, not data.

---

## 3. Schema

Full DDL below. Conventions: `text` keys (chain-agnostic ids), `numeric` for money (never float), `timestamptz` everywhere, every warmer-written table carries `generated_at`. RLS enabled on all tables with **no anon policies** — server components use the service-role key (bypasses RLS); the browser never queries Supabase directly. (This deliberately avoids the "17 tables with RLS disabled" exposure on the Fuda DB.)

### 3.1 `cards` — the atomic unit (replaces 477 MB of trait JSON)

Store only the fields the app uses, not the full Helius DAS asset (~3.9 KB each → ~400 B/row → **~50 MB total**, comfortably inside the free 500 MB tier).

```sql
create table cards (
  id                text primary key,           -- 'cc-<mint>' | 'bz-<tokenId>' (matches src/lib/card/ids.ts)
  platform          text not null,              -- collector-crypt | beezie | phygitals | courtyard
  token_id          text not null,              -- Solana mint or ERC-721 tokenId
  chain             text not null,              -- Solana | Base | Polygon
  name              text,
  card_name         text,                       -- normalized display name (traits.cardName)
  ip_key            text,                       -- classifyIP() result: pokemon, one_piece, ...
  set_name          text,
  grade             text,
  grade_label       text,
  category          text,
  image             text,
  image_fallback    text,
  insured_value_usd numeric,                    -- CC "Insured Value" trait → mcap input
  attributes        jsonb,                      -- cleaned label/value pairs used by /card/[id]
  source            text not null,              -- helius-das | beezie-tokenuri
  updated_at        timestamptz not null default now(),
  unique (platform, token_id)
);
create index cards_ip_key_idx        on cards (ip_key);
create index cards_platform_idx      on cards (platform);
create index cards_card_name_idx     on cards (lower(card_name));         -- /search
create index cards_insured_desc_idx  on cards (insured_value_usd desc nulls last);
```

### 3.2 `listings` — cheapest active listing per token (replaces `listings.json`)

```sql
create table listings (
  item_id    text primary key,                  -- 'POLYGON:0x..:tokenId' | 'SOLANA:mint'
  platform   text not null,
  token_id   text not null,
  price_usd  numeric not null,
  source     text not null,                     -- OPEN_SEA | RARIBLE | COLLECTOR_CRYPT
  updated_at timestamptz not null default now()
);
create index listings_platform_idx on listings (platform);
create index listings_price_idx    on listings (price_usd);
```

### 3.3 `sales` — raw sales (NEW capability: real history + per-card sale logs)

Today sales live only as 24h buckets and vanish. Persisting them backs Top Sales, Recent Sales, per-card sale logs, and lets us compute history from source. Retention: keep raw 90 days; older rolls into `metric_snapshots`.

```sql
create table sales (
  id           text primary key,                -- 'platform:txid:logIndex' (idempotent upsert)
  platform     text not null,
  token_id     text not null,
  price_usd    numeric not null,
  price_native numeric,
  currency     text,
  buyer        text,
  seller       text,
  source       text not null,                   -- rarible | helius | dune
  sold_at      timestamptz not null
);
create index sales_sold_at_idx       on sales (sold_at desc);
create index sales_platform_time_idx on sales (platform, sold_at desc);
create index sales_token_idx         on sales (platform, token_id);
create index sales_price_desc_idx    on sales (price_usd desc);
```

### 3.4 `platform_metrics` / `ip_metrics` — precomputed rows (map 1:1 to `PlatformRow` / `IPRow`)

The warmer does the aggregation once and stores the result, so pages are a thin read + rank (no per-request join). One computation → numbers agree across every page.

```sql
create table platform_metrics (
  platform        text primary key,             -- courtyard | beezie | collector-crypt | phygitals
  vol_24h_usd     numeric,
  vol_7d_usd      numeric,
  primary_24h_usd numeric,                       -- null = not tracked (renders as "—", not 0)
  active_24h      int,
  cards_24h       int,
  trades_24h      int,
  holders         int,
  avg_trade_usd   numeric,
  spark           jsonb,                          -- number[]
  trend           text,                           -- up | down | flat
  source          text,
  generated_at    timestamptz not null
);

create table ip_metrics (
  ip_key              text primary key,
  cards               int,
  cards_valued        int,
  platforms           int,
  holders             int,
  holders_by_platform jsonb,
  buyers_24h          int,
  trades_24h          int,
  vol_24h_usd         numeric,
  vol_7d_usd          numeric,
  vol_total_usd       numeric,
  mcap_usd            numeric,
  floor_usd           numeric,
  insured_usd         numeric,
  pct_7d              numeric,
  trend               text,
  spark               jsonb,
  top_card            text,
  source              text,
  generated_at        timestamptz not null
);
```

### 3.5 `metric_snapshots` — the time-series spine (replaces scattered history JSON)

One append-only table unifies `marketcap-history.json` and `history/{platform}.json`, and extends to per-IP and per-card. **Start writing this in Phase 2** even though charts ship in Phase 3 — you can't backfill history you never recorded.

```sql
create table metric_snapshots (
  entity_type text not null,                     -- market | platform | ip | card
  entity_key  text not null,                     -- 'total' | platform key | ip key | card id
  metric      text not null,                     -- volume_usd | mcap_usd | floor_usd | holders
  value       numeric not null,
  ts          timestamptz not null,
  primary key (entity_type, entity_key, metric, ts)
);
create index metric_snapshots_lookup_idx on metric_snapshots (entity_type, entity_key, metric, ts desc);
```

### 3.6 `snapshots` — blob singletons (gacha)

`fetchGacha` reads one whole `GachaDuneSnapshot` object; a jsonb blob row is the pragmatic backing (normalize into per-platform gacha tables only if/when cross-cutting queries need it).

```sql
create table snapshots (
  key          text primary key,                 -- 'gacha' | ...
  payload      jsonb not null,
  generated_at timestamptz not null
);
```

### 3.7 `source_freshness` — the honest "as of" / provenance

Every warmer writes one row here when it finishes. The UI reads it for the per-source badge and provenance chips. This is the heart of the trust layer.

```sql
create table source_freshness (
  source           text primary key,             -- gacha-dune | listings | marketcap | holders | cc-sales | cc-traits | beezie-traits | history
  generated_at     timestamptz not null,
  status           text not null default 'ok',   -- ok | stale | error
  rows_written     int,
  duration_ms      int,
  error            text,
  next_expected_at timestamptz
);
```

### 3.8 RLS (apply to every table)

```sql
alter table cards            enable row level security;
alter table listings         enable row level security;
alter table sales            enable row level security;
alter table platform_metrics enable row level security;
alter table ip_metrics       enable row level security;
alter table metric_snapshots enable row level security;
alter table snapshots        enable row level security;
alter table source_freshness enable row level security;
-- No anon/authenticated SELECT policies: server uses the service-role key (bypasses RLS).
-- Add explicit read-only policies later only if the browser ever queries Supabase directly.
```

---

## 4. Warmers → schedule

Each warmer's core becomes an importable function `runX()` called by (a) the existing `scripts/*.ts` CLI and (b) a `/api/cron/<name>` route gated by `CRON_SECRET`. **Schedule is decoupled from platform** — routes are just HTTP, so any scheduler can drive them.

| Warmer | Source | Cadence | Runtime | Driver | Writes |
|---|---|---|---|---|---|
| `warm-gacha-dune` | Dune `runQuery` (≤3 min) | 6h | fits 300 s | Vercel Cron / GH Action | `snapshots('gacha')`, freshness |
| `warm-listings` | Rarible `/orders/all` + CoinGecko | hourly | fits | Cron route | `listings`, freshness |
| `warm-marketcap` | `listings` ⋈ `cards` | hourly (after listings) | fits | Cron route | `ip_metrics`, `metric_snapshots`, freshness |
| `warm-courtyard-primary` | Rarible MINT count | hourly | fits | Cron route | `platform_metrics`(courtyard) |
| `warm-cc-sales` | Dune (preferred) or Helius | 5–10 min | fits | Cron route | `sales`(cc), freshness |
| `backfill-history` | Rarible + Helius/Dune 7d | 4–6h | fits | Cron route | `metric_snapshots`(platform) |
| `warm-traits` (Beezie, 2.6K) | Base RPC tokenURI | daily | fits | Cron route | `cards`(beezie) |
| **`warm-cc-traits` (122K)** | Helius DAS `searchAssets` | daily | **won't fit 300 s** | **GitHub Action** | `cards`(cc) |
| `warm-holders` | Rarible ownerships + DAS (full pagination) | daily | likely >300 s | **GitHub Action** | `*_metrics.holders` |

**Split rule:** light/fast/frequent jobs → cron routes; heavy bulk crawls (the 122K trait refresh, full holder pagination) → GitHub Actions running the existing `tsx scripts/*.ts` against Postgres (no timeout, free at this cadence). Traits are near-immutable, so a daily full refresh + incremental for new mints is plenty.

**Scheduler choice (confirm during build):** Vercel Cron needs the **Pro** plan for sub-daily schedules. To stay plan-independent, drive the fast routes from **GitHub Actions cron** (free, any cadence) or **Supabase `pg_cron` + `pg_net`** (schedule lives in the DB itself). Recommendation: ship everything on GitHub Actions first; move the fast ones to Vercel Cron if/when on Pro.

---

## 5. Page cutover

Because of the seam (§2), page-level changes are small and mostly about honesty:

1. **Kill the live fallback** in `buckets.ts` (`getCCSales` live Helius path) → read the `sales` table only. This alone removes the 30–60 s cold renders and 429s.
2. **Reads become DB reads** wrapped in a short cache (`unstable_cache`/`use cache`, ~60 s) — the DB is already the warm store, so TTL is for request coalescing, not freshness. Optionally tag-revalidate when a warmer finishes.
3. **Replace "Live · Xs ago"** (currently shows cache *write* time and is misleading) with a real per-source "as of `generated_at`" from `source_freshness`.
4. **"Not tracked on this platform"** instead of 0/blank where a row is genuinely absent (Phygitals secondary volume, Courtyard per-card traits) — `primary_24h_usd = null` → "—", etc.

Two-step sequencing to de-risk:

- **Style A (Phase 2):** keep `fetchHomepage`/`fetchIP`/`fetchPlatform` join logic as-is; just back their readers with Postgres (`WHERE token_id IN (...)` batched). DB-only, no external calls, low risk.
- **Style B (Phase 3):** move the heavy join into `warm-marketcap`/a new aggregate warmer → `ip_metrics`/`platform_metrics` precomputed; fetchers become thin reads. Fastest pages + one-source-of-truth consistency.

---

## 6. Phased rollout

### Phase 0 — Foundations (no behavior change)
- `git add` the (currently untracked) repo; push to GitHub.
- Create + link Vercel project; set env: `DUNE_API_KEY`, `HELIUS_API_KEY`, `RARIBLE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`.
- Add `src/lib/db/client.ts` (server-only Supabase client, service role).
- Apply the §3 schema to `tsneiigqszqspqpdorxi`.
- **Acceptance:** server component can `select` from an empty table; app still runs on disk caches, unchanged.

### Phase 1 — Vertical slice: gacha end-to-end
- Refactor `warm-gacha-dune` core into `runGachaWarm()`; add `POST /api/cron/gacha` (CRON_SECRET) that runs it → `snapshots('gacha')` + `source_freshness`.
- Swap `readGachaDune()` internals fs → Postgres (interface unchanged → `fetchGacha`/`/gacha` untouched).
- Schedule every 6h.
- Add the honest "as of" badge to `/gacha`.
- **Acceptance:** `/gacha` renders identical numbers from Postgres with a real "updated Xh ago"; hitting the route updates the DB and the page reflects it; **deploys to Vercel and works in prod** (it can't today — no disk cache there).

### Phase 2 — Migrate the rest; delete disk + live fallback
- One-time loader: 122K cc-traits + 2.6K beezie-traits → `cards`.
- Swap remaining readers fs → Postgres (`cards`, `listings`, `holders`, `history`, `marketcap`, `cc-sales`).
- Add cron routes + GitHub Actions per §4.
- **Delete the live-Helius fallback** in `buckets.ts`.
- Begin appending `metric_snapshots` hourly (start the clock on history).
- **Acceptance:** every page renders from Postgres only; no external API call in any request path; rename `.cache/` and the site still works; cold renders sub-second.

### Phase 3 — Trust layer + precompute + depth
- Provenance UI everywhere (per-source "as of" chips; "not tracked" cells).
- Move heavy joins into the warmer (Style B) → precomputed `ip_metrics`/`platform_metrics`.
- Time-series charts (real 7D/30D/90D/1Y) from `metric_snapshots`.
- Finish `/card/[id]`: price history + cross-platform floor + sales log (now that `sales` + `cards` are in Postgres) — the unique-to-phygital cross-platform price intelligence.
- **Acceptance:** charts show real multi-window history; `/card/[id]` shows a price line + sales; numbers agree across homepage/IP/platform/card.

---

## 7. Cost & limits

- **Supabase free:** 500 MB DB, pauses after 7 days idle (regular crons keep it awake — non-issue). Estimated footprint: cards ~50 MB + listings/metrics few MB + 90 d sales + snapshots → low-hundreds of MB. Headroom OK. Upgrade to **Pro ($25/mo, 8 GB)** only if storage/egress demands.
- **Dune Plus $349/mo** already paid; 6h cadence ≈ 4 runs/day/query × a handful of queries = cheap.
- **Vercel:** Hobby restricts cron to daily/limited; sub-daily needs Pro — hence the pluggable scheduler in §4. Functions default 300 s timeout (fits all but the two bulk crawls).

---

## 8. Open decisions (confirm to finalize)

1. **Dune-first for core volume/sales?** Recommended yes (proven complete; free RPC undercounted CC 3.6×). Traits stay on Helius DAS (Dune has no trait metadata), listings stay on Rarible. → source-of-truth per metric.
2. **Scheduler:** GitHub Actions for all initially (free, plan-independent), promote fast jobs to Vercel Cron on Pro. OK?
3. **Sales retention:** raw 90 d, roll up beyond into `metric_snapshots`. OK?
4. **Supabase plan:** start free, upgrade to Pro only on demand. OK?

## 9. What I need to start building (Phase 0)

- **The service/secret key** (`sb_secret_…`) **or the Postgres connection string** for `tsneiigqszqspqpdorxi` — the publishable key you gave is client-side and can't write past RLS. (Goes into `.env.local`, gitignored.)
- Confirmation to create + link a **Vercel project** (and which Vercel account/team).
- A **GitHub repo** to push to (or confirm I should create one).
- Answers to §8.
