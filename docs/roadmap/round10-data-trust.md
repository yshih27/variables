# Round 10 — data trust (7/9)

_User principle: data correctness is the one thing we cannot get wrong. Two anomalies investigated to root cause; fixes + a systemic invariant harness so the next one is caught by CI, not by users._

## D10-1 (CRITICAL, backend) — CC secondary feed has massive duplicate rows

**Evidence (probed live):** token `8eLxTT…` ("Bulbasaur"): **506 sale rows, 2 unique tx signatures.** Token `EB5BQb…` ("Zamazenta"): **400 rows, 5 signatures.** Feed total 9,789 rows — a meaningful share is duplicates of a handful of transactions.

**Impact:** inflates trending trades/momentum/hunt-pressure (the visible symptom), CC volume aggregates, spine `volume_usd`/`trades` for affected days, and trade-weights in the sale panel → price index cells.

**Fix:**
1. **Dedupe at ingestion** in `fetchDuneSecondarySales` (core.ts): unique on tx signature (+tokenId); log dropped-dupe counts.
2. **Root-cause the source:** Dune SQL fan-out (JOIN multiplying rows) vs our pagination appending overlapping pages (the loop-push path) vs the self-healing cache merging old+new result sets. Fix at the source too — dedupe is the belt, source fix is the suspenders.
3. **Audit Courtyard** (same `fetchDuneSecondarySales` path, query 7845248) for the same pattern before assuming it's CC-only.
4. **Re-warm after fix:** secondary-sales, metric-snapshots (affected days), sale-panel/price-index, trending, homepage.

## D10-2 (HIGH, backend) — "Cards 24h" column mixes two different metrics

`fetchHomepage.ts`: trading IPs get `acc.cardIds.size` (cards **traded** in 24h — Pokémon 162 ✓), but `mcapOnlyIpRow(ip, cards)` fills the same field with the **total mcap-rollup collection size** (Moonbirds 11,700 ✗). One column, two semantics.

**Fix:** `mcapOnlyIpRow` sets `cards: 0` (honest — nothing traded). If total tracked collection is worth showing, add a separate `cardsTracked` field and let /ips render it as its own column with its own ⓘ. Never overload.

## D10-3 (MED, backend) — "Other" shows −92.6% 7d/30d: taxonomy migration, not a crash

Reclassification (moonbirds/yugioh/comics/magic promoted out of "other") moved most of the bucket's mcap away → its spine series reads as a −92.6% collapse. Any future reclassification will fake moves in BOTH directions (receiving IPs "pump").

**Fix:** on reclassification, either backfill the affected entities' spine history under the new keys (preferred — series reflect today's taxonomy), or annotate/reset series at the migration date. Add to the backfill-ip-keys runbook: taxonomy changes MUST ship with a spine-history migration.

## D10-4 (the systemic answer) — automated data invariants in the health gate

New `scripts/check-invariants.ts` (run in the Actions gate beside check-freshness; red on violation):
1. **Dupe rate:** sale feeds — rows ÷ unique signatures ≤ 1.02 per platform.
2. **Trades sanity:** per card-type, window trades ≤ unique sigs; no type > P99×10 of typical.
3. **Column semantics:** cards24h > 0 ⇒ vol24h > 0 (and vice versa); avgTrade ≈ vol/trades ±1%.
4. **Holders:** union ≤ sum of per-platform; per-IP sum ≥ union.
5. **Spine continuity:** day-over-day mcap move > ±30% on any entity → flag (catches migration artifacts + bad writes).
6. **Cross-surface:** homepage hero totals == sum of platform rows (same snapshot).

## Frontend (small)
- **/report discoverability:** add "Report" to the main nav (currently footer-only; user couldn't find it).
- After D10-2: render `cards24h=0` as "0" (not "—") for mcap-only IPs — zero-that-means-zero.

## Relay note
Backend leads this round (D10-1..4). Frontend items ride along. After fixes land: full re-warm, then orchestrator re-probes Bulbasaur/Zamazenta (expect 2 and 5 trades) and Moonbirds (expect 0 cards 24h).
