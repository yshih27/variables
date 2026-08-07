# Dune queries

Mirror of every Dune query this repo executes. The queries themselves live in the
Dune workspace (owner `impossible_data`); these files are the reviewable copy —
edit Dune via the API, then re-export here so the two never drift.

IDs are wired in [`src/lib/dune/queryIds.ts`](../src/lib/dune/queryIds.ts).
Inspect one at `https://dune.com/queries/<id>`.

## Cost model — read before adding a query

Dune bills **per execution, by the compute that execution does**, and bills
result reads **per MB exported**. Two failure modes follow, and this repo has hit
both:

1. **Per-platform copies of the same query.** Four platform queries = four
   executions for one fan-out scan. Fixed by `UNION ALL` with a `platform`
   column, split client-side in the loader.
2. **Unbounded history.** A full-history scan is re-billed on *every* run and
   buys nothing, because the Postgres spine is the system of record and upserts
   by `(entity_type, entity_key, metric, ts)`. Courtyard secondary ran unbounded
   for 18 days at ~2.7M datapoints/day; the four gacha-daily queries cost ~12.2
   min of compute daily (CC alone 7.6 min, past the warmer's 8 min budget).

**So: one multi-platform query per concern, and always a time window.**

## Active

| File | Query | Window | Executed | Consumer |
|---|---|---|---|---|
| `gacha-live-all-platforms.sql` | 8252733 | 30d | daily | `runGachaWarm` → homepage rips, platform gacha panels |
| `gacha-daily-all-platforms.sql` | 8252734 | 90d | daily | `warm-metric-snapshots` → spine `gacha_volume_usd` |
| `buyback-all-platforms.sql` | 8252735 | 30d | daily | `runGachaWarm` → net-take / buyback |
| `cc-secondary.sql` | 7675297 | 30d | daily | `warm-core-dune` → CC secondary volume |
| `courtyard-secondary.sql` | 7845248 | 30d | daily | `warm-core-dune` → Courtyard secondary volume |
| `cc-big-hits.sql` | 7643571 | 7d | **weekly** | weekly report → Notable Pulls |
| `cc-odds.sql` | 7643215 | 30d | **paused** | `/gacha` page only (gated by `GACHA_ENABLED`) |

`cc-odds` and `cc-big-hits` are not executed on the daily cadence: the first
feeds a page that is flag-gated off, the second feeds only the Monday report.
`runGachaWarm` carries both forward from the previous snapshot in between — it
rewrites the whole `gacha` blob, so skipping a fetch without carrying forward
would blank them.

## Superseded

`superseded/` holds the per-platform queries the combined ones replaced, named
`<slug>.<query-id>.sql`. They still exist on Dune but nothing executes them —
kept for provenance and as the reference the `UNION ALL` branches were spliced
from. Delete them from Dune only once the combined queries have a few clean
weeks.

| Replaced by | Superseded |
|---|---|
| `gacha-live-all-platforms.sql` | `gacha-live-{cc,beezie,phygitals,courtyard}` (7642633 / 7642705 / 7642707 / 7642710) |
| `gacha-daily-all-platforms.sql` | `gacha-daily-{cc,beezie,phygitals,courtyard}` (7845475 / 7845392 / 7845484 / 7845479) |
| `buyback-all-platforms.sql` | `buyback-{cc,phygitals}` (7644128 / 7644129) |

## Gotchas

- **Per-platform predicates are not interchangeable.** Each `UNION ALL` branch's
  `FROM`/`WHERE` was spliced verbatim from its original query. CC's pack-price
  allowlist is deliberately *narrower* in the live query than in the daily one
  (no 151 / 2500 / 5000). Harmonising them would move published numbers.
- **Amount scaling differs per chain.** `tokens_solana.transfers.amount` is raw
  (needs `/power(10,6)`); `tokens.transfers` / `tokens_polygon.transfers` /
  `tokens_base.transfers` are already decimal-adjusted. Branches cast to
  `DOUBLE`/`BIGINT` so Trino accepts the union.
- **A windowed daily query's oldest day is partial.** It is clipped by the
  window boundary, so publishing it would overwrite a complete stored day with a
  smaller number. `warm-metric-snapshots` drops the oldest day per platform;
  this is safe because the spine upserts and never deletes.
- **Courtyard has no pack tiers.** Its branch emits one row with `pack_price`
  null. The standalone query called these columns `txns_*`; the combined query
  normalises them to `pulls_*`.
