/**
 * Dune query IDs powering the gacha page.
 *
 * Created via the Dune API from the team's validated SQL. Private queries
 * named "TCG.market — …" in the Dune workspace. To inspect/edit, open
 * https://dune.com/queries/<id>. The SQL is mirrored in `dune/` — see
 * dune/README.md for the file ↔ query-id manifest.
 *
 * ⚠️ COST MODEL. Dune bills each execution by the COMPUTE it does, so the two
 * things that matter are (a) how many queries we execute and (b) how much each
 * one scans. Per-platform copies of the same query multiply (a); unbounded
 * history multiplies (b). Both were true here and the account ran to 174% of
 * plan. Hence: one multi-platform query per concern, every one time-windowed,
 * with the loaders splitting rows on a `platform` column.
 */

/** Platforms the combined gacha queries cover, in display order. */
export const GACHA_PLATFORMS = ["collector-crypt", "beezie", "phygitals", "courtyard"] as const;

export type GachaQueryPlatform = (typeof GACHA_PLATFORMS)[number];

/**
 * Gacha (primary) LIVE windows, ALL PLATFORMS — one execution, replacing four
 * (7642633 CC / 7642705 Beezie / 7642707 Phygitals / 7642710 Courtyard, now
 * dormant). Rows: `{ platform, pack_price, pulls_30d, volume_30d, pulls_7d,
 * volume_7d, pulls_24h, volume_24h }`, 30d window.
 *   • CC / Beezie / Phygitals → one row per pack_price tier.
 *   • Courtyard              → ONE row, pack_price null (no pack tiers). Its
 *     old `txns_*` columns are normalised to `pulls_*` here.
 * Split by `platform` in runGachaWarm. SQL: dune/gacha-live-all-platforms.sql
 */
export const GACHA_LIVE_QUERY_ID = 8252733;

/**
 * Realized rarity-tier odds (CC only — it's the one platform whose prize
 * inventory is split into named tier wallets). Returns per-tier prize counts
 * for 24h/7d/30d. 7d is the headline window (24h is small-sample; 30d can
 * include occasional bulk inventory moves).
 *
 * ⚠️ EXECUTION PAUSED. This feeds ONLY the /gacha page, which is gated off
 * behind GACHA_ENABLED — so we were paying for a daily execution nothing could
 * display. The warmer skips it while the flag is off and carries the last odds
 * forward in the snapshot; flipping GACHA_ENABLED on resumes it. The code path
 * is deliberately intact — do not delete it.
 */
export const CC_ODDS_QUERY_ID = 7643215;

/**
 * High-tier prize deliveries (Epic/LGND/SPrT) last 7d → the big-hit
 * candidates. Returns (block_time, mint, tier); the warmer joins each mint to
 * its Insured Value + name + image from the local cc-traits cache and ranks.
 *
 * ⚠️ WEEKLY, not daily. Its only consumer is the weekly report's Notable Pulls,
 * so it runs in the Monday job (after cc-traits, before the report build) via
 * `warm-gacha-dune.ts --big-hits`. Daily runs carry the last hits forward.
 */
export const CC_BIG_HITS_QUERY_ID = 7643571;

/** Platforms with a known on-chain buyback wallet (the only ones the query covers). */
export const BUYBACK_PLATFORMS = ["collector-crypt", "phygitals"] as const;

/**
 * Buyback payouts, ALL PLATFORMS, DAILY — one execution, replacing two (7644128
 * CC / 7644129 Phygitals, now dormant). USDC sent FROM a platform's gacha
 * wallets back to players (instant cash-out of a pulled card), excluding
 * internal/house wallets. Net house revenue = gacha spend − buyback payout.
 *
 * Rows: `{ platform, day, buyback_count, payout_usd, outflow_gross_count,
 * outflow_gross_usd }` — one per platform per UTC day, 35d window, mirroring
 * GACHA_DAILY_QUERY_ID so the two sides of net revenue share a shape AND a window
 * and can be subtracted day-for-day.
 *
 * ⚠️ BASIS CHANGE (2026-08-19, rule R3). `payout_usd` counts an outflow as a
 * player payout ONLY where the recipient also spent into this platform's gacha
 * receivers inside the same window. The previous definition — every outflow minus
 * a hand-curated internal-wallet list — is retained as `outflow_gross_usd`, and
 * the two are written to the spine as SEPARATE metrics (`buyback_payout_usd`,
 * `outflow_gross_usd`). Never sum them.
 *
 * ⚠️ `outflow_gross_usd` DOUBLES AS THE BASIS MARKER. It is emitted by the same
 * query in the same row, so a spine day carrying it is a day whose payout is
 * R3-counted. fetchPlatform publishes a net figure only for days that have it —
 * that is what stops a gross-basis payout shipping under an R3 label while the
 * Dune switchover and this code deploy independently.
 *
 * ⚠️ SPINE DAYS OLDER THAN THE 35d WINDOW KEEP THEIR PRE-R3 VALUES. Every reader
 * uses 24h/7d/30d, all inside the rewritten range. Do not sum `buyback_payout_usd`
 * past 35d without re-deriving it.
 *
 * ⚠️ WINDOWS ARE CALENDAR-ALIGNED NOW. This query used to return rolling
 * aggregates (`pay_24h` = "the last 24 hours"). Day buckets can't reproduce a
 * rolling window, so the warmer derives its 24h/7d/30d figures as trailing
 * COMPLETE-DAY sums instead. That is the same basis the spine and every delta on
 * the site already use, and it is what makes net revenue subtractable: spend and
 * payout must come from the same window on the same completeness basis, never a
 * rolling spend minus a calendar payout.
 *
 * ⚠️ 35d, matching the gacha-daily query. Rewindow the two together or the net
 * stops being like-for-like. SQL: dune/buyback-all-platforms.sql
 */
export const BUYBACK_QUERY_ID = 8252735;

/**
 * CC secondary marketplace sales (Collector Crypt program CcmRKTuZ…). Returns
 * sale-level rows `{ block_time, price_usd, nft_mint, buyer, seller }` over 30d.
 * price_usd = MAX USDC transfer per tx (robust to escrow/fee splits); native-SOL
 * movements in these txs are fees/rent, not payments (validated on-chain), so
 * USDC carries the sale value + the high-end tail. Replaces the rate-limited
 * Helius cc-sales scan. The core warmer derives 24h/7d/30d aggregates + the
 * recent sale list from these rows.
 */
export const CC_SECONDARY_QUERY_ID = 7675297;

/**
 * Courtyard secondary marketplace sales (Polygon) via Dune `nft.trades` — replaces
 * the Rarible aggregator. Same row shape as CC's 7675297
 * `{ block_time, price_usd, nft_mint, buyer, seller }`, over 30d.
 *
 * ⚠️ WINDOWED to 30d (matching CC's 7675297) — keep it that way. It ran
 * unbounded for 18 days and every scheduled read re-exported the full history:
 * ~2.7M datapoints/day. The warmer only derives 24h/7d/30d aggregates from this
 * feed and the spine persists daily history in Postgres (upserts, never
 * re-derived), so nothing downstream wants more than 30d.
 */
export const COURTYARD_SECONDARY_QUERY_ID = 7845248;

/**
 * Daily-bucketed gacha (primary) volume, ALL PLATFORMS — one execution,
 * replacing four (7845475 CC / 7845392 Beezie / 7845484 Phygitals / 7845479
 * Courtyard, now dormant). Rows: `{ platform, day, pack_price, pulls,
 * volume_usd }`. Powers the spine's `gacha_volume_usd` metric; the warmer groups
 * by platform+day and sums across pack_price. CC price list = the live
 * /api/gachas/all catalog (incl. Rarible's $151 `pokemon_151`, plus 2500/5000);
 * Phygitals excludes sub-$1 dust; Courtyard = tokenization (primary); Beezie =
 * the Claw. (Beezie secondary is its own API, not Dune.)
 *
 * ⚠️ WINDOWED to 35d — keep it that way. Unbounded, these four scans cost ~12.2
 * min of Dune compute EVERY day (CC alone 7.6 min, already past the warmer's
 * 8 min budget — the 4-way union simply timed out). The spine is the system of
 * record for history: it holds every day these queries return and upserts by
 * (entity_type, entity_key, metric, ts), so re-deriving only the trailing window
 * loses nothing. Narrowed 90d → 35d because Dune bills executions by COMPUTE and
 * these scans are the dominant credit driver — 35d still covers every window the
 * readers use (24h / 7d / 30d) plus slack for a late or corrected day.
 * SQL: dune/gacha-daily-all-platforms.sql
 */
export const GACHA_DAILY_QUERY_ID = 8252734;
