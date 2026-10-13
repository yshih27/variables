# Executor WP — the market hub, backend: the series the hub needs and the spine does not carry yet

Backend executor, Varible. Two PRs off `origin/main` (B1 and B2 may share one; B3 is built), pushed, opened against main, NO merging.

**Ground rules:**
- Own worktree with the three symlinks.
- No production writes from the PR. Every script dry-runs by default and prints what it would write. The orchestrator applies after the merge.
- Dune: count first, and print every execution's datapoints and the credit meter before and after. The period (Oct 10 → Nov 10) read 2,659.8 credits on Oct 13; any execution over 100 credits waits for the owner's word.
- tsc and eslint clean. A truthful trailer.

Context: `brief-frontend-market-hub.md`, which builds the hub on today's data and names the panels that wait on this brief.

## B1 · Resale history into the spine from the sales store (free)
- **Why.** The spine's resale starts on 2026-05-26 for Collector Crypt and 2026-05-31 for Beezie (production, read Oct 13). The daily writer only ever re-derives its 30-day window (`scripts/warm-metric-snapshots.ts`). The `secondary_sales` store holds both further back: the v4.3 index reads Collector Crypt from 2026-02-09 and Beezie from 2026-01-15. On an "All" chart both venues would appear from nowhere in May.
- **Script.** `scripts/backfill-resale-from-store.ts --platform=<collector-crypt|beezie> [--apply]`. It reads the store with `readStoredSales`, cleans the rows with the same `cleanSecondarySales` the daily writer applies, and sums complete UTC days into `platform/<key>/volume_usd` and `trades`.
- **Days it writes.** Only days before the spine's first day for that venue: never a day the daily writer owns, and never today.
- **Dry run.** Prints the store's first and last day per venue and a per-month table (days, sales, volume). It also prints the overlap check described under Verify.
- **Report.** Whether the IP rows (`ip/<ip>/volume_usd`, `trades`) for the same days should follow. Not written in this PR.

## B2 · Daily pulls per venue (`gacha_pulls`)
- **Why.** "Pulls by venue", "Pulls · 30D" and "Average pull" on the hub's Packs tab need a daily count; the spine has none.
- **Collector Crypt, Beezie, Phygitals, Courtyard.** The daily gacha query (8252734, `dune/gacha-daily-all-platforms.sql`) already returns `pulls` per venue per day. `warm-metric-snapshots.ts` reads `volume_usd` from it and drops `pulls`. Write `platform/<key>/gacha_pulls` from the same rows: zero extra datapoints.
- **Renaiss.** `readDailyPackSpend` (`src/lib/renaiss/pulls.ts`) already returns `{ usd, packs }` per day; write `packs`.
- **DYLI.** Write its box pulls per day if its box lane carries a daily count. If it does not, the report says so and DYLI has no series.
- **Definition.** "Pulls" counts paid on-chain pulls. Courtyard's packs paid by card with no on-chain payment are not in it.
  - Measure whether the daily query can emit a per-day count of those card-paid packs (today only `unpriced_packs_30d` exists) and at what datapoint cost.
  - If it is cheap, write `platform/courtyard/gacha_unpriced_packs`; otherwise report it.
- **History.**
  - The history SQLs already emit `pulls` (`dune/cc-gacha-history.sql` and the Courtyard gacha history). Prefer a cached result if the backfill caches still exist.
  - Otherwise count first and give the cost per venue before any execution.
  - Beezie and Phygitals history: report what exists and what it would cost.
- **Wiring.**
  - Add `gacha_pulls` to the chart route's metric allowlist (`src/lib/api/chartSeries.ts`) and to the source-death metrics in `scripts/check-invariants.ts`.
  - Unit-test the row mapping (`test:spine`).

## B3 · Courtyard's buyback arbitrage: decided Oct 13 (exclude, with a receipt line) and built by the orchestrator in `feat/courtyard-arbitrage`; kept here as the record of the rule
- **Measured Oct 13 on Polygon** (the repo's own `fetchExchangeTrades` over the public RPC):
  - Some of Courtyard's peer-to-peer trades are bought by a wallet that sells the same card to Courtyard's buyback wallet (`COURTYARD_OPS_WALLET`) within 24 hours.
  - Oct 11: 1,791 of 5,970 trades (30.0%), $39,760 of $297,634 (13.4%), by 117 wallets; one made 805 of them.
  - Aug 3: 24,372 of 30,810 (79.1%), $517,214 of $817,959 (63.2%), by 88 wallets; one made 10,605.
  - They are real trades between different parties. They are also not collectors buying cards, and they explain most of the summer peak in Courtyard's resale chart.
- **Definition.** A peer-to-peer trade at time T is an arbitrage trade when its bidder appears as the asker of a buyback on the same `tokenId` in [T, T + 24 h] (the same block counts). One buyback settles one purchase: that wallet's latest open purchase of the card.
- **Live feed.**
  - `scripts/warm-courtyard-exchange.ts` already reads both kinds in one pass. Keep each buyback's `(asker, tokenId, ts)` long enough to classify, and classify a trade once 24 hours past it have been read.
  - A spine day is written with the split only when the feed has read 24 hours past the day's end. Until then the day keeps its previous value.
  - In the store, the classification travels with the row: either a distinct source (`courtyard:exchange:arb`, so readers that filter on `courtyard:exchange` drop it with no reader change) or a column. Say which and why.
- **Spine, by the owner's decision:**
  - **exclude:** `volume_usd` and `trades` drop the arbitrage trades, and the dropped part is written as `resale_arb_usd` and `resale_arb_trades` so a receipt line can say how much was excluded, computed.
  - **disclose:** resale is unchanged and the same two metrics carry the share for the receipt line.
  - **leave:** nothing is written.
- **History (as built).**
  - The store period (from 2026-09-08) is reclassified by re-running the live feed with `--from`.
  - The spine's earlier days are measured from the chain, free: `scripts/measure-courtyard-arbitrage.ts` (about 100 s per day, per-day cache, parallel streams, resumable).
  - They are applied with `scripts/backfill-courtyard-exchange-history.ts --arbitrage=<dir>`, which refuses any day where the chain's peer-to-peer count disagrees with Dune's.
- **Methodology.**
  - Courtyard's row in the methodology's Sources states the rule.
  - The restatement is listed per month (before, after, the part moved) in the PR body.
  - No index level moves: Courtyard has no card identities, so it is not in the sale panel.

## Verify
- **B1:** the dry run's monthly table, plus an overlap check for one month that both the store and the spine already cover: on those days the script's figure against the spine's, per day. Explain every day off by more than 0.5% (hygiene's sweep rule depends on the window it sees, so a small difference can be legitimate). Paste it.
- **B2:** the new metric read back through `/api/internal/chart/series?metric=gacha_pulls` on a local `next start`. One day's pulls against the Dune result row it came from.
- **B3:** the Oct 11 and Aug 3 figures above reproduced by the new code path, and a 7-day dry run with the per-day split.
- **All:** tests for every pure piece (`test:spine`, `test:courtyard-exchange`), tsc and eslint clean.

## Report in the PR body
- For every series written or proposed: venue, first day, rows, and the before/after per month.
- Every Dune execution with its datapoints and the meter before and after.
- What could not be measured, said as such.
