# Executor WP — Renaiss as complete as Collector Crypt, and every venue's gacha compared: backend

Backend executor, Varible. TWO PRs off `origin/main`, in this order, each pushed and opened against main, NO merging:
- **PR A `feat/renaiss-platform`:** the Renaiss platform page reads the data we already hold.
- **PR B `feat/gacha-every-venue`:** the `/gacha` payload covers every venue with a gacha, and every number on it survives a plausibility check.

Ground rules, as in every brief:
- Own worktree with the three symlinks.
- Never write to production from an executor. Use `--dry-run` defaults, `--limit` caps and `--out=<dir>` for any blob. Migrations are FILES the orchestrator gets applied.
- tsc and eslint clean. A truthful trailer.
- Zero Dune reads; state it from the credit meter. The account is at 182% of its included credits until Oct 10.

Why now: the owner wants the two most visible gaps closed. `/platform/renaiss` renders 3 sections where `/platform/collector-crypt` renders 11. The `/gacha` page, built in June and hidden behind `NEXT_PUBLIC_GACHA_ENABLED` since Jul 14, compares only 3 of the 6 venues. Its headline figure is also wrong (see PR B, item 1).

## What exists (measured by the orchestrator Oct 7, origin/main 236a749)

**The Renaiss page.** `src/app/platform/[key]/page.tsx` renders, for Renaiss, only:
- the header and its KPI rail;
- the volume chart (`IndexStudio`);
- the volume and trade bars;
- the holders bar, as an empty frame whose reason reads "forward-only… no backfill" (wrong: no holders read exists);
- Volume mix.

**Why Recent Sales, Top Cards and By IP are missing.** `enrichSales` in `src/lib/data/fetchPlatform.ts:211-227` loads metadata only for `beezie` and `collector-crypt`. Every other venue gets an empty map, and `if (!meta) continue` drops every sale. The data exists:
- `renaiss_sales` holds 18,304 sales since 2026-01-09 with card, set, number, grade, cert and image.
- `cards` holds `rn-<tokenId>` rows (`src/lib/renaiss/cards.ts:146-170`).
- `readCards("renaiss", ids)` (`src/lib/data/cards.ts:454`) already serves the card page.
- ⚠️ By IP classifies with `classifyIP(extractCategoryHints(meta))` (`fetchPlatform.ts:255,328,358`). Renaiss's `ip_key` deliberately comes from the catalog image's game, because keyword matching misreads card names ("Sunflora" → football). Renaiss must use its stored `ip_key`.

**What `renaiss_pulls` holds.** About 720K rows since 2025-11-06 (migration `20260930000001:88-105`): `pull_id, kind, product_id (= machineId), buyer, price_usd (checkout only), tx_hash, pulled_at, prize_instance_id, prize_canonical_id, prize_value_usd (Renaiss's STATED value), prize_card_name, prize_set_name, prize_card_number, prize_grade_label, prize_cert, prize_language`.
- ⚠️ `machineName` and the prize `imageUrl` arrive on every feed row (`src/lib/renaiss/pulls.ts:36-52`), and `toPullRow` (`:105-124`) drops both.
- Nothing on the page reads `buyer`, `product_id` or any `prize_*` column.

**CC-only sections.**
- **Machines:** `PlatformMachines` renders only when `key === "collector-crypt"` (`page.tsx:465`). Its rows (`MachineBoard` / `MachineRow`, `src/lib/data/playerAnalytics.ts:176-205`) come from the daily player-analytics scan of `gacha_pulls`. That scan took 38.6 min on Oct 6 and is why the daily job timed out. Never add a venue to it.
- **Players:** `PlatformPlayers` reads `readPlayerAnalytics().platforms`, CC and Phygitals only.

**Holders and market cap.**
- `scripts/warm-holders.ts` scans Beezie, CC and Phygitals only. `scripts/warm-marketcap.ts:232-235` values Beezie, CC, Phygitals and DYLI.
- `MCAP_BASIS` (`src/lib/data/marketcap.ts:26`) has two labels: `appraisal` ("vault appraisal", CC's insured value) and `floor`.
- `src/lib/onchain/ownerOf.ts` (bet 2) reads `ownerOf` for many tokens in ONE `eth_call` through Multicall3 (`0xca11…ca11`, also deployed on BNB Chain), over the public RPCs in `tokenUri.ts:9` (Polygon and Base today).

**Listings and floor.** Renaiss's API publishes neither. The orchestrator read the marketplace contract on Oct 6 (proxy `0xAE3e…11d0`; impl has `executeTrade(trade, sig)`, EIP-712 asks and bids, `usedAsks`). Asks appear to be signed off-chain, so the chain does not hold the book either. Renaiss's terms forbid scraping beyond the API. Floor and listings stay withheld, with that reason.

**The live header wart.** `/platform/renaiss` printed "24h Marketplace Vol $0.00 · −47.7%" and "24h Trades 0 · +40.0%" on Oct 7. The level is the rolling 24 h from `core-volume`, and the delta compares complete days (`page.tsx:92-97`, by design site-wide). Note that `core-volume` runs BEFORE the Renaiss warmers in the core batch, so its Renaiss read is one run old.

## PR A — `feat/renaiss-platform`
1. **Sales on the page.** Add a `renaiss` branch to `enrichSales`: `readCards("renaiss", tokenIds)` mapped to `TokenMetadata`, with the IP taken from the stored `ip_key`. Recent Sales, Top Cards, By IP and IP share then render from the existing components.
   - Renaiss clears about 6 sales a day (81 in the 14 days to Oct 3). When a venue's 24 h holds fewer than 10 sales, its Top Cards and Recent Sales come from the trailing 7 days instead. The payload carries the window (`salesWindow: "24h" | "7d"`) so the frontend labels it. Never return an empty table when the store holds sales.
   - Verify the $0.00. Report `max(sold_at)` in `renaiss_sales` against the last core run's time. If the 24 h is truly empty, say so. If it comes from step order, move `core-volume` after the two Renaiss steps in `warm.yml` (measure that the core job stays under its 75 min).
2. **Machine names and prize images.**
   - Write a migration file adding `machine_name text` and `prize_image_url text` to `renaiss_pulls`. `toPullRow` writes both.
   - Fill history with a re-read. About 1,450 pages at 500 rows: within one day's 10,000-call quota, but not inside the 75-min core job (it timed out on Oct 5 doing exactly that). Ship it as `warm-renaiss-pulls --refill-columns`, resumable from a cursor, under the `RENAISS_MAX_CALLS` ceiling. The orchestrator runs it by dispatch. Report the call count and the runtime from a `--limit 3` dry run.
3. **The Renaiss machine board.** Build a `MachineBoard` for Renaiss from `renaiss_pulls` over 30 complete days. This is a 30-day windowed read (about 60K rows), not a full scan, in its own core step with its own freshness row.
   - Per machine: name, price, 30-day spend, pulls, 7-day spend.
   - Also the stated value back: Σ `prize_value_usd` ÷ Σ spend, labelled "Renaiss's stated prize value".
   - Also the hit share: the share of pulls whose stated prize value ≥ the price paid, with its n.
   - Also the top prize: card, grade, value, image.
   - No partner columns: Renaiss has no partner field. Write it to its own snapshot, `machines:renaiss`. Do not touch player analytics.
   - Generalise `MachineBoard`'s type only as far as Renaiss needs (optional partner fields, a `valueBasis` string). CC's board must render byte-identical.
4. **Players.** Lifetime spend per wallet over all 720K pulls is a full scan. Do it in the database: a migration file with one SQL function (`renaiss_wallet_spend()` → buyer, spend, pulls, first_pull, last_pull) called through `db().rpc()`. It's the repo's first RPC, so say so in the PR. Tiers, concentration and active-30d are computed in app code in the `PlatformPlayerAnalytics` shape, into a `players:renaiss` snapshot.
   - Measure the function on a local Postgres with a synthetic 720K-row table, and paste the timing.
   - It runs in the core batch or its own daily step, never inside the daily job.
5. **Biggest pulls (every venue with a named pull feed).** One reader, `readBiggestPulls(platform, days)`, returns the top 12 prizes by value over 30 days. Each prize carries card name, grade, image, machine, value, `valueBasis` and the pull time:
   - Renaiss from `renaiss_pulls`, basis "Renaiss's stated prize value";
   - CC from `gacha:cc` big hits, basis "Collector Crypt's insured value";
   - Phygitals from `gacha:phygitals`, basis "Phygitals FMV".

   DYLI is left out until PR B stores item titles.
6. **Holders on BNB Chain.** Add `bnb` to `RPCS` (publicnode first, then two more public endpoints, cited) and to `ownerOf.ts`. The token universe is every `prize_instance_id` in `renaiss_pulls` ∪ every `token_id` in `renaiss_sales`.
   - Holders = distinct owners, excluding the zero address, the burn address and Renaiss-operated wallets. Identify those by the top owners by count, checked against the role holders the contract exposes. Name each excluded wallet and its count in the PR.
   - A token whose `ownerOf` reverts is counted as burned. `burnToken` is likely redemption: report it as "burned (likely redeemed)", never "redeemed".
   - Measure on `--limit 20` multicalls first (tokens per call, latency, throttling), and project the full run. The holders run joins `warm-holders` as a Renaiss step, with the spine's `holders` series forward-only from the first run. The empty-state reason comes from data: `holdersReason`.
7. **Market cap, labelled.** Σ over tokens held outside Renaiss's wallets of the token's `prize_value_usd` at pull. A new `MCAP_BASIS` value `stated` with the label "platform's stated prize value" carries its coverage (tokens valued ÷ tokens held).
   - This is the same class of figure as CC's insured value: the venue's own appraisal. It is not a price.
   - Tokens that never came through a pull have no value and count in the coverage gap, never at zero.
   - Ship it only if coverage ≥ 80%; otherwise market cap stays withheld with the coverage figure as its reason.
8. **Honest legs.** Update the methodology `VENUE_LEGS.renaiss`:
   - holders: counted on-chain;
   - market cap: stated prize value with coverage;
   - listings and floor: "Renaiss's asks are signed off-chain and its API does not publish them";
   - player analysis: now covered.

   Every figure comes from data with its window.
9. **Tests** (`test:renaiss` grows): the enrich branch on fixture `cards` rows, including an `ip_key` that keyword matching would get wrong; the machine board on a constructed pull set (spend, hit share, stated value back, top prize, the 30-complete-day cut); the 7 d fallback threshold; holders exclusions and the reverted-`ownerOf` count; market cap coverage below and above 80%.

## PR B — `feat/gacha-every-venue`
1. **The headline is wrong today. Fix this first.**
   - The hidden page's ticker reads "Best Typical Return 2.01×". That is CC's PKMN 50: realized median 2.36× on n=25, × 0.85 buyback. PKMN 25 shows 1.6× on n=19.
   - CC states an EV of about 1.02–1.10× the price. A right-skewed payout's median sits below its mean, so a median of 2.36× on a machine that clears thousands of pulls a day is a sampling artifact, not a finding.
   - Diagnose where the CC realized sample comes from (`ccGacha.ts`: the `perTier` stratified `getAllWinners` sample and its complete-coverage window), and fix it. Either compute CC realized stats from `gacha_pulls` over intervals with continuous coverage, or withhold them.
   - Add a plausibility gate to the pack view: a realized median above the realized mean, or above the stated EV × 1.5, is withheld with its reason.
   - The hero never headlines a pack that fails the gate.
   - In the PR, paste the before and after for every CC pack: n, median, mean, stated EV.
2. **DYLI boxes.** `gacha_products` rows with `platform_id = 'dyli'` hold DYLI's declared EV, FMV ratio, buyback rate and floor, inventory, odds buckets and `active`. `gacha_pulls` holds realized pulls with DYLI's FMV mark and no buyer.
   - Add DYLI packs to `gacha:packs` with stated (declared) and realized fields, each tagged with its basis.
   - Store the item title the box history already returns (`warm-dyli-boxes.ts`: fetched, not stored) so DYLI prizes can be named.
   - Probe the DYLI v1.1 docs for a box-contents route. If one exists, its items join `prizes` as the box's pool; if not, DYLI prizes are "pulled recently" only.
3. **Renaiss packs.** Each machine active in the last 72 h becomes a pack:
   - price;
   - pulls 24 h and 7 d;
   - realized hit share (stated prize value ≥ price) and value back, both on Renaiss's stated value and labelled so;
   - biggest pulls with images (from PR A's columns).

   Renaiss publishes no stated odds, EV or buyback: those fields are null, never assumed. Its recently pulled prizes join `prizes` with `pulled: true`. Renaiss's V3 packs name a prize when the set sells out, so a pull without a name is counted and not shown.
4. **Courtyard.** Probe whether Courtyard publishes a pack or machine catalog (its app and the Rarible activity index). If it doesn't, Courtyard stays out of the matrix, and the payload says why for the page's coverage line. Do not build a Courtyard row from Dune aggregates.
5. **Phygitals catalog.** Replace the 13 hard-coded slugs (`src/lib/phygitals/client.ts:195-208`) with every live pack in `/vm/available` (about 69). Fetch the chase pool for each live pack. Fix the realized read: `.limit(8000)` with no order (`gachaPacks.ts:253-258`) truncates arbitrarily. Use keyset paging over the window.
6. **Recent hits that do not depend on a laptop.**
   - `gacha:live` is written by `scripts/listen-gacha.ts`, a launchd job on the owner's Mac. It stops when the Mac sleeps, and the page never checks its age.
   - The payload's hits use `gacha:live` only while its heartbeat is under 15 minutes old. Otherwise they fall back to the 6-hourly warmers' big hits, and the payload carries `hitsAsOf` and `hitsSource`.
   - The 1-hour page cache must not freeze the "Xm ago" labels: send timestamps, never pre-formatted ages.
   - "Biggest Hit 7d" must filter to 7 days. It mixes weekly Dune hits up to about two weeks old today (`page.tsx:57`).
7. **The venue list is data.** The payload carries `venues: { key, name, kind: "pack" | "machine" | "claw" | "box", covered: boolean, reason?: string }[]`. The frontend renders rows and the coverage line from it, never from a hard-coded three. Beezie's kind is `claw`.
8. **Remove what nothing uses.** Delete:
   - `GachaTable.tsx`, `GachaBigHitsRail.tsx` and `PlatformGachaPanel.tsx`, which nothing imports;
   - the four `/api/cron/{gacha,cc-gacha,phygitals-gacha,gacha-packs}` routes, which have no caller (Actions runs the scripts);
   - `RAIL_SHOWS_GACHA`;
   - the stale comments (`fetchGacha.ts:4,117,164`; `claw.ts:76` "4 active claws today"; `gachaHits.ts:8-13`).

   Bump the cache key `gacha:v18` → `gacha:v19`. Fix `DATA_MODEL.md`'s cache-key line.
9. **Tests** (`test:gacha`, new): the plausibility gate (median > mean, median > 1.5 × stated EV, n thin); a DYLI box and a Renaiss machine mapped to `GachaPack` with null-not-assumed stated fields; the hits fallback by heartbeat age; the 7-day filter; the venue list.

## Constraints
- **Copy:** none beyond log lines, registry legs and payload reason strings. In those, figures only from data with their window.
- **Wording:**
  - Beezie's machine is "the Claw", never "gacha" or "pack" in anything Beezie-facing.
  - Renaiss and Phygitals sell "packs"; CC runs "machines"; DYLI sells "boxes".
  - "Tokenized collectibles", never "trading cards".
- **Values:** a venue's stated value is labelled as the venue's own claim wherever it travels. No per-card pull probability exists anywhere: never compute or imply one.
- **The flag:** the orchestrator measures, and the owner decides when `NEXT_PUBLIC_GACHA_ENABLED` flips. The reason it went in (Rarible's `pokemon_151` machine on CC, `flags.ts:8-11`) is the owner's call to retire.
- **Production:** zero writes from the executor. The orchestrator gets the two migrations applied, then runs the refill, the holders run and the first machine and player builds.

## Report in each PR body
- **PR A:**
  - the enrich result on a local `--out` build: sales enriched of fetched, IP split, and which window the tables took;
  - the $0.00 diagnosis;
  - the refill's projected calls and runtime;
  - the holders probe (tokens per multicall, latency, projected full run, excluded wallets and counts);
  - market cap coverage, and whether it clears 80%;
  - the RPC's timing on a synthetic table.
- **PR B:**
  - the CC before/after table;
  - DYLI and Renaiss packs as built (count, which fields are null and why);
  - the Courtyard probe result;
  - the Phygitals live-pack count;
  - the hits fallback, shown with a stale heartbeat.
- **Both:** the exact orchestrator sequence after merge. Screenshots are the orchestrator's.
