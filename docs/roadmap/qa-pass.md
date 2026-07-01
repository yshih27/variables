# QA pass — pre-tester (7/1)

_Walked all pages live as a user. The F-R / B-fix work landed and verified. Remaining issues below, prioritized to reach a **tester-ready steady state**._

## Verified good — no action
MarketHeader consolidation (F-R1) · rebased index promoted on `/ips` (F-R2) · **inception dip fixed** (charts start clean at 100) · **CC holders populated** (12,709 — B-fix-3) · **homepage benchmarks live** (vs BTC +10.7% / ETH / S&P / NASDAQ — B-fix-1) · IP/Platform tables deduped to teasers + "see all →" · mobile MarketHeader stacks cleanly · gacha page solid · search functions.

---

## P0 — tester-blockers (credibility breakers; fix before sending out)

**QA-1 — Fake buttons.** `★ Watchlist` and `↗ Share` on the IP/Platform rails are **dead** — no handler, no href, click does nothing (verified). A tester clicking a no-op button reads as broken. **Fix:** wire them (Watchlist = localStorage toggle + a `/watchlist` view later; Share = `navigator.share` / copy-link) **or remove** until built. Both are small, frontend-only. _Files: `IPRail.tsx`, `PlatformRail.tsx`._ **[Frontend]**

**QA-2 — Collector Crypt Activity chart renders flat at $0.00.** `/platform/collector-crypt` Activity shows a degenerate empty chart (both axes `$0.00`), while the equivalent `/ip/pokemon` Activity chart renders a real curve. So the platform-level hourly volume series is empty/miswired for CC. **Fix:** check the platform Activity volume series (hourly history for platform entities); guard the chart to show "no intraday data" instead of a flat zero line. _Likely backend data (platform hourly series) + a frontend empty-state guard._ **[Backend + Frontend]**

**QA-3 — Search is too thin for a card-heavy audience.** Works, but "charizard" returns **1 result** — it only indexes cards traded in the last 24h + the IP/platform catalog. Testers will type card/set names and hit near-empty results. **Fix (pick one):** (a) broaden to a real card-name search over the full `cards` table (~125K rows, name `ILIKE`) — a small backend endpoint; or (b) reframe the placeholder to "Search IPs, platforms, sets" and guarantee those always resolve. Recommend (a). _Files: `searchIndex.ts` + a search endpoint._ **[Backend + Frontend]**

---

## P1 — the three you flagged

**QA-4 (your #1) — Section-header inconsistency.** On `/ips`: the Performance chart is a **bordered card with its title inside**, while the treemap and the "Top 7 IPs" table have a **naked title floating on the page background**. Three different treatments on one page. **Fix:** build ONE shared `<Section title subtitle right>` wrapper (bordered card, title top-left inside, optional right-aligned controls) and apply it to every content module — `/ips`, then audit `/platforms` and the homepage so the whole app uses one section frame. This is the systemic fix, not a per-module patch. **[Frontend]**

**QA-5 (your #2) — Homepage MarketHeader "bare middle" (desktop only).** The header puts the mcap number + a small sparkline far left and the Change/Benchmark columns far right, leaving a large empty band in the middle. **Fix:** promote the tiny sparkline into a **full market-index line chart** that fills the middle (it also adds value — a real trend vs a decorative squiggle). Mobile already stacks fine — this is a wide-screen layout fix. **[Frontend]**

**QA-6 (your #3) — Benchmarks aren't drawn on the IP/category charts.** `/ips` "Performance by IP" and `/ip/[key]` "X vs market" still show only internal IPs with a "benchmarks soon" chip — even though benchmark data is **live** (the homepage already renders vs BTC/ETH/S&P/NASDAQ). **Fix:**
- **Frontend:** overlay BTC / ETH / S&P 500 / NASDAQ as toggleable lines on these charts (data is `readBenchmarkSeries`, already populated). This is the payoff — "Pokémon vs One Piece vs BTC vs S&P" on one chart.
- **Correctness:** these charts currently plot the **mcap "market size" series** (hence "market size, not price"). Overlaying BTC (a price) on a size index is the apples-to-oranges trap. If the **price index** (B1 `readPriceSeries`) is populated and sane, switch the charts to it and drop the "market size" caveat; if it's still too thin, keep size but relabel the comparison honestly. **Verify the price index before switching.**
- **Backend:** add a **GOLD** benchmark series (FRED) since you want it; the pattern extends to any other index you name. **[Frontend + Backend]**

---

## P2 — polish

- **QA-7** — Homepage `CHANGE · 30d —` shows a lone dash (index only goes back to Jun 9). Hide the 30d row until 30d of history exists, or label it "since Jun 9." **[Frontend]**
- **QA-8** — Mobile has **no search** (the box is hidden < 768px). Add a search icon/sheet for mobile testers. **[Frontend]**
- **QA-9** — Add a committed **`.env.example`** (names only, no values) — there's no template today, so a new dev/tester can't see what keys are needed. **[repo]**

---

## Owner summary
- **Frontend:** QA-1 (buttons), QA-4 (Section component), QA-5 (header chart), QA-6 (benchmark overlay), QA-7, QA-8.
- **Backend:** QA-2 (platform hourly series), QA-3 (card search endpoint), QA-6 (gold series + verify price index), QA-9 (.env.example).
- **Ship gate before testers:** P0 (QA-1/2/3) + P1 (QA-4/5/6). P2 can follow.
