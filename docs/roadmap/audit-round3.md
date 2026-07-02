# Round-3 audit — design + data consistency, app-readiness (7/2)

_Orchestrator audit: live walk of every page + two code sweeps. /status healthy (18 feeds OK). Trending panel verified live on the homepage. Grouped: D = design, X = data, U = upgrade._

## D — Design inconsistencies (frontend)

**D1 — Six modules bypass the shared `<Section>` frame** (the QA-4 fix didn't reach them):
`MarketHeader.tsx` (hand-rolled section), `GachaPackMatrix.tsx` (naked title + unframed grid — visible in the live walk), `GachaHitsTicker.tsx` (bare `.ght` CSS marquee), `PlatformGachaPanel.tsx` (own rounded div, header outside the card), `IPDominance.tsx` + `IPByPlatform.tsx` (manual sections, floating titles). Wrap each in `<Section>` (or match its header structure exactly). This finishes the "one section frame" rule app-wide.

**D2 — Card-page breadcrumb breaks the pattern**: `Home / Category / Card` with slashes vs `Rankings › X` everywhere else (`CardDetailView.tsx` ~86–101). Standardize.

**D3 — Recurring blank card images**: gacha hits ticker ($9K Sanji blank in live walk) + previously a Top Sales card. Build one `<CardImage>` fallback (IP-colored placeholder + name) and use it in every card-art slot.

**D4 — No loading skeletons**: empty components return `null` gracefully, but slow loads show nothing. With ISR most hits are fast; add skeletons only to the two slowest (SliceView main column, homepage tables).

_Confirmed clean: `.tabular` mono numbers, hover states, chart palette semantics, radius tiers (2xl/xl/lg), no stray emojis._

## X — Data inconsistencies (backend-led)

**X1 (HIGH) — Rolling-24h vs UTC-calendar-day windows mixed across surfaces.** Hero stats/tables read rolling-24h bucket snapshots; every chart reads calendar-day spine rows; gacha vol is rolling-24h Dune summed into bars next to calendar-day series. Same metric ≠ same number on the same screen. Fix: (a) label windows in the UI ("24h" vs "daily"), (b) align `gacha_volume_usd` spine to calendar-day and verify it's backfilled, (c) document the two-tier rule (live = rolling, charts = calendar-day) in `metricSnapshots.ts`.

**X2 (HIGH) — Homepage "Holders" double-counts**: `fetchHomepage.ts` sums per-platform holder counts — a wallet on two platforms counts twice (this is the 1,074→41,318 jump). Either compute a true cross-platform union in the holders warmer, or relabel/tooltip as "sum of per-platform holders."

**X3 (MED) — Two "index" types shown without distinction**: homepage MarketHeader = **mcap** index ("104.0 since Jun 9"), /ips + IP pages = **price** index (Apr history). They can legitimately diverge (supply vs price) and will read as a bug. Fix: switch the homepage headline to the price index (market roll-up exists) with mcap as the labeled size stat, or label the homepage one "market-cap index."

**X4 (MED) — Mcap fallback shows stale value unlabeled**: hero falls back to last known hourly mcap with no age label. Append "(~Xh old)" when the fallback is used.

**X5 (MED) — `$0` vs `—` policy inconsistent**: `fetchPlatform.ts` defaults missing mcap to `0` (renders $0 = "worthless") while other readers use NaN (renders — = "not tracked"). Make NaN-for-missing the policy everywhere.

**X6 (MED) — Trending panel data quirks** (live-verified): every row ties at Trades 2 / +2 / 2.0× — the ranking reads arbitrary/broken. Also momentum is CC-only (Beezie/Phygitals have no prior window) and huntPressure divides fresh-ish trades by possibly-stale listings. Fix: default the panel to the 7d window when 24h is this thin (tie-heavy), add volume as a visible tiebreak column, note momentum coverage, and timestamp the float.

**X7 (LOW) — Freshness chips**: homepage has `dataUpdatedAt`; IP/platform detail pages show none. Reuse the same chip (keep /status as the deep view — no global banner, per the established rule).

## U — Side-project → real app

**Trust & identity (cheap, high-signal):** footer with About/Methodology/Status/contact + a one-line data disclaimer ("informational, not financial advice"); per-entity dynamic OG images (card/IP pages → rich share cards); "About Variable" blurb for the beginner audience (#6).

**Operational maturity:** GitHub Actions failure notifications (a dead warmer currently fails silently until someone checks /status); error tracking (Sentry) + Vercel Analytics (which pages do testers actually use?); uptime check on prod.

**Product stickiness (the app loop):** `/watchlist` page (the toggle already saves to localStorage — give it a home + a nav entry); weekly digest (the index engine already computes WoW moves — a shareable "TCG market this week" is the habit loop); price/listing alerts (needs infra — later).

**Moat/depth:** slice engine (specced, next build); public read API (`/api/v1/index`, `/api/v1/trending` — makes Variable *the* citable source, rate-limited); platform expansion (Grailed / Fanatics candidates from the 6/29 scan); repeat-sales index v2.

## Recommended next round

- **Frontend:** D1–D3 + X6 presentation + X7 chips + footer/disclaimer + /watchlist page.
- **Backend:** X1 window alignment + X2 holders union + X3 homepage→price-index + X5 NaN policy + Actions failure notifications.
- **Then:** slice engine (already specced in `slice-engine.md`).
