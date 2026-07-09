# Runbook — IP taxonomy changes (reclassification)

**Rule: a taxonomy change MUST ship with a spine-history migration.** Promoting
cards out of `other` (or between IP keys) silently corrupts the metric spine's
delta columns if you only run the card backfill. This is what produced the
"other −92.6% (7d/30d)" artifact (D10-3): a reclassification, not a market crash.

## Why

`backfill-ip-keys.ts` rewrites `cards.ip_key`, which changes what each IP's
metrics roll up. The two metric families react differently:

- **FLOW** (`volume_usd`, `trades`, `active_wallets`, `cards_traded`) — **self-heals.**
  `warm-metric-snapshots` recomputes the trailing 30d from row-level sales tagged
  with the *current* `ip_key` every run. Within 30d the series already reflects the
  new taxonomy. Nothing to do.
- **STOCK** (`mcap_usd`, `holders`, `floor_usd`) — **does NOT self-heal.** These are
  point-in-time, forward-only readings. A promoted IP's pre-migration mcap was
  recorded *inside* `other` and can never be decomposed after the fact. Left alone,
  `other`'s stock series steps down at the migration date (and the receiving IPs
  "pump" from nothing), so the leaderboard's 7d/30d deltas read a fake ±90% move.

## Procedure

1. Edit `ipCatalog.ts` (add/rename the IP).
2. Dry-run then apply the card backfill:
   ```
   npx tsx scripts/backfill-ip-keys.ts
   npx tsx scripts/backfill-ip-keys.ts --apply
   ```
   Note the migration date (today, UTC) and which keys shrank (usually `other`).
3. **Reset the shrinking bucket's STOCK spine history at the migration date** so no
   delta spans the taxonomy change (deltas then honestly return null until
   post-migration history accrues):
   ```
   npx tsx scripts/migrate-taxonomy-spine.ts --keys other --before <migration-date>
   npx tsx scripts/migrate-taxonomy-spine.ts --keys other --before <migration-date> --apply
   ```
   Pass only the *shrinking* bucket(s). Promoted keys have no pre-migration stock
   rows, so listing them is harmless but unnecessary.
4. Re-warm downstream so the surfaces refresh:
   ```
   npx tsx scripts/warm-metric-snapshots.ts   # (or wait for the daily batch)
   npx tsx scripts/warm-homepage.ts
   ```
5. Verify: `npx tsx scripts/check-invariants.ts` — the spine-continuity invariant
   (no entity mcap moving >±30% day-over-day) should pass. A remaining flag means a
   key that shrank wasn't reset.

## Pending

The R7 promotion (moonbirds/yugioh/comics/magic out of `other`, ~2026-07-02) still
needs step 3 run against `other` once the DB is reachable — that clears the standing
−92.6% artifact.
