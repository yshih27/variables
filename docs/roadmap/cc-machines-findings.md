# What an untagged Collector Crypt pull is

Measured 2026-09-03 against the live feed and our own `gacha_pulls` spine.
Everything below is Postgres + the unauthenticated CC endpoints the warmer
already calls — no Dune, no Helius, no CardOS.

## The answer

**Untagged does NOT mean "bought direct from Collector Crypt".** It is an
ingestion-timing artifact on OUR side: the live feed carries a `memo_slug` on
**100%** of pulls, and we store a large share of them with `memo_slug = NULL`.

So the frontend must keep the conservative label. Untagged spend stays its own
bucket, **"unattributed"**, never folded into `cc` — which is itself just another
slug, and the biggest one.

## Evidence

### 1. The feed tags everything, on both endpoints

`GET /api/getAllWinners`, the two parameter modes the client already uses:

| call | rows | carrying `memo_slug` |
|---|---|---|
| `?count=200` | 200 | **200 (100.0%)** |
| `?perTier=100` | 602 | **602 (100.0%)** |

The brief asked whether the field is endpoint-dependent. It is not — of the **82
pulls returned by both** calls, every one is tagged in both, and 81 of 82 carry
an identical slug. There is no "this endpoint omits it" effect to find.

Slug mix on the live `count=200` stream: `cc` 128 · `jupiter` 39 · `sol` 20 ·
`slabz` 11 · `arena` 2.

### 2. We store as NULL what the feed serves tagged

Taking the 686 distinct pulls the live feed returned (every one tagged) and
looking each up in our spine by the mint embedded in `pull_id`:

```
present in our spine            667
  tagged in both, same slug     152
  tagged LIVE, NULL in ours     490   ← the loss
  slug differs                   25
  tagged ours, absent live        0
```

e.g. `onepiece_50 2026-09-03T07:28:10 live="cc" ours=NULL`,
`pokemon_50 2026-09-03T07:26:07 live="jupiter" ours=NULL`.

*(Caveat on the 25 "differs": the lookup matches on the mint substring of
`pull_id`, so a mint appearing in more than one row would land here. It is not
evidence that CC rewrites a slug, and nothing here depends on it.)*

### 3. The loss is an AGE effect, which is what names the mechanism

The live feed tags 100% of these pulls at every age. What OUR spine holds for the
same pulls, bucketed by how old the pull is:

```
age          n    we-have-slug
< 30 min   181       4.4%
30-60 min   15       0.0%
1-3 h      119       0.0%
3-12 h      74      21.6%
12-48 h     63      50.8%
> 48 h     208      56.7%
```

Monotonic in age. The fresher the pull, the less likely our copy carries the
slug — while the vendor's copy always does.

### 4. The same shape shows up in the spine's own history

Tagged **count** is pinned near ~1,100-1,250 per day while total rows swing by
5×:

```
2026-09-02  20,192 rows   1,141 tagged   5.7%
2026-08-29   6,990 rows     874 tagged  12.5%
2026-08-23   4,090 rows   1,121 tagged  27.4%
2026-08-26  22,854 rows   1,131 tagged   4.9%
```

A stable absolute number against a varying denominator is a fixed-rate capture,
not a partner-mix fact. Hourly, it swings 0%-100%: hours with few pulls come out
~100% tagged (11:00 on Sep 2: 116 of 116), busy hours ~0% (05:00: 8 of 1,519).

And untagged rows cluster on the HOT machines while tagged rows cluster on slow
ones — sampled over a busy three-hour stretch:

```
UNTAGGED (986)  pokemon_25 277 · pokemon_100 260 · onepiece_50 252 · pokemon_1000 74
TAGGED    (14)  degen_100 5 · evintage_80 3 · onepiece_1000 3 · pokemon_25 2
```

Both groups are byte-identical otherwise: same `source` (`cc-gacha-api`), same
`pull_id` shape, same writer.

## The mechanism, stated plainly

We record a pull **once, at first sight**, and never revisit it:

* `listen-gacha.ts` polls `?count=200` every ~90s and catches the busy machines
  within a minute or two of the pull.
* `warm-cc-gacha` runs 6-hourly on a `perTier=100` stratified slice, which for
  slow machines reaches back days.

The pulls we catch fastest are the ones stored without a slug; the ones we only
see hours later come with one. And `listen-gacha.ts` keeps an in-memory dedup set
specifically so it does not re-ingest a pull it has already seen (its own
comment: *"in-memory dedup so cycle logs say what's actually NEW (DB upsert is
idempotent)"*), so a row first written with `NULL` is never rewritten.

## Recommended fix — NOT made in this PR

Let a later pass re-upsert `memo_slug` for pulls already in the spine: drop the
in-memory dedup for rows whose stored slug is NULL, or have `warm-cc-gacha`
re-write the slug for every pull in its slice regardless of prior ingestion. The
DB upsert is already idempotent and already writes the column, so the change is
small — but it alters the behaviour of an always-on worker that is deployed
outside this repo's CI, so it belongs in its own change with its own rollout,
not bolted onto a read-side feature.

Until then attribution stays low, and every share on the machines board is stated
against attributed spend with the rate beside it — the same honesty rule the
existing partner board already follows.

⚠️ The rate is **7.8% of spend over 30 complete days** (measured: $7,198,315
attributed of $92,206,555), not the ~17% the brief quotes from a 3-day sample.
The difference is the age effect above: a 3-day window is disproportionately made
of older pulls that have had time to be re-ingested. The longer the window, the
lower the attribution rate — which is itself further evidence that this is a
capture artifact rather than a partner-mix fact.

## What this means for the frontend

* Untagged is **"unattributed"**. Not "Collector Crypt direct", not folded into
  `cc`, not dropped from the denominator.
* The unattributed remainder gets a neutral segment in the split bar, never a
  partner colour.
* The attribution rate belongs in the section header once, not per row.
