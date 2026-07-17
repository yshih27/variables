# Pre-launch QA audit — consolidated triage (2026-07-17)

Three parallel audits of live prod (`varible.rarible.com`) + the repo: data-consistency (SSR HTML cross-checks), user-eyes browser walkthrough, code sweep. Deduped and triaged. Fix briefs: FE + backend (dispatched separately); user/ops actions listed last.

**Calibration — what ties out cleanly:** the whole 24h volume chain (homepage bar = split = /platforms leaderboard = table sum), both HHIs recompute from their inputs, holders union (41,510 < platform sum ✓ deduped), trades/cards column sums, Pokémon cross-page totals, 14d card sums vs /ips, report internal sums, subscribe form, 404, gacha gating (airtight ×5 entry points), all internal links, zero console errors on every page. The failures cluster in legacy paths (Rarible history, floor-mcap, metadata enrichment) and presentation gates — not the spine.

## 🔴 Launch blockers

| # | Finding | Evidence | Owner |
|---|---|---|---|
| B1 | **Every SEO/share surface emits the dead origin.** Sitemap ×100 locs, robots Host, every og:image → `variable.rarible.com` = NXDOMAIN since the DNS flip. No canonicals to mitigate. | `site.ts:21` fallback used because `NEXT_PUBLIC_SITE_ORIGIN` unset in prod | **User** (env var + redeploy) + FE flips code fallback |
| B2 | **Old domain vanished instead of redirecting** — every pre-existing share/bookmark dies at DNS | `variable.rarible.com` NXDOMAIN; `varible.rarible.com` live 200 | **Tech team** (attach old domain in Vercel → redirect) |
| B3 | **"7d Vol" is impossible arithmetic** — CC 7d ($221K) 14× smaller than its 24h ($3.01M); Beezie 7d ($2.87M) > its own 14d marketplace total ($126K). Last live remnant of Rarible-inflated history; mixes provenance per platform | `fetchPlatform.ts:355` / hero vol7 read `readHistory()` (Rarible blobs) while everything else reads the native spine | **Backend** |
| B4 | **/ips market cap contradicts itself ×3 on one page** — rail $62.7M vs its own expansion $58.4M (Sports zeroed) vs treemap "$58.3M across 6 IPs" (drops Moonbirds, the page's #3 by mcap); IPTable hides Basketball's real $567K (it traded 4 cards) while zero-trade Football keeps its cap. Dominance/HHI inherit | one root cause: sparse gate keyed on `cards` (=cards traded 24h since D10-2) applied to STOCK metrics — `CategoryTreemap.tsx:41`, `category/rollup.ts:64-67`, `IPTable.tsx:36-37` | **FE** |
| B5 | **/ip/[key] rail clips Watchlist/Share off-screen at common laptop heights** — rail `overflow-y:hidden`, content 827px in a 655px column; actions unreachable < ~1050px window height. Share dropdown also clips | walkthrough DOM measurement | **FE** |
| B6 | **Enter key doesn't submit header search** — button-only; keyboard users see search as dead | walkthrough, 2 clean trials, hydrated tab | **FE** |

## 🟠 Major — fix before launch

| # | Finding | Owner |
|---|---|---|
| M1 | Homepage index "7d ▲+18.5%" is one weekly recompute step (series flat 13 decimals then jumps); contradicts /report "+1.3% WoW" for the same window (report frozen pre-revision). Weekly cadence needs weekly-honest labeling + report rebuild-on-revision policy | Backend (+FE label) |
| M2 | Beezie page self-disagrees: rail 205 trades/$15.7K vs all tables 186/$10.0K ("186 sales in last 24h" literally false) — `enrichSales` silently drops sales lacking metadata (Beezie traits cache: 62 rows vs CC 131K) | Backend |
| M3 | Phygitals "Market Cap $84.7K" (floor×supply lower bound) presented identically to CC's appraisal-based mcap — $3/holder next to $398K/day gacha reads absurd. Needs estimate qualifier at point of display | FE (+glossary copy) |
| M4 | Courtyard "▲+9538.6%" — tiny-base delta, no minBase floor (guard exists in `rollup.ts pctChangeDays`, skipped here). Same class: report set-deltas +4,612% | Backend |
| M5 | Phygitals revenue-mix "Secondary 0% · **$0.00**" — fake-zero regression (rail on same page correctly "—"); apply hasSecondarySource | FE |
| M6 | **32-char server-side name chop** — mid-word, no ellipsis, no title attr, site-wide (Top Sales, Trending, TOP CARD cols, search, report); makes distinct cards look like dup bugs | FE |
| M7 | /methodology: Index-naming section rendered **twice**; ~6 missing-space typos ("V-PKMis", "belongs to the The"); stale claims — says holders "currently a sum, double-counted" (union shipped), says Beezie/Courtyard "sourced from Rarible" (only true of the B3 bug) | FE |
| M8 | Homepage mcap ⓘ tooltip stale: "Tracked for Beezie & Collector Crypt only" — Phygitals now tracked | FE |
| M9 | #1 trending card driven by one-way wallet-pair sweep (9 identical $314 sales, same buyer→seller) — `secondaryHygiene` ring rule requires BOTH directions; one-way bulk passes and tops trending + inflates CC 24h marketplace vol | Backend |

## 🟡 Minor — polish batch

- Timeframe pills uppercase (IndexStudio :47-48, CategoryTrendChart :247, IPActivityChart :256 + empty states) beside lowercase captions
- Signed zeros: "-0.0%" (dead-band before print), "+0.0%" vs "0.0%" in one column; "$0.00" avg-trade on zero-trade + `restIps` rows (`platform/[key]/page.tsx:121ff`, `fetchPlatform.ts:239` → NaN not 0)
- "14D" cards spanning 16 days on sparse series (`slice(-14)` takes points not days — pad calendar days); /ips card endpoints differ (Jul 15 vs 16) in one row
- Index Studio 30D window: weekly V-MKT starts ~Jun 22 with hard area edge (include prior weekly point for continuity); picker tags benchmarks "index"
- Sticky bar-hover highlight after mouseleave (14d cards)
- Top-21 table clipped at 1280px viewport — add scroll affordance/edge fade
- /report: duplicate Charizard pull row; raw slugs ("one_piece · collector-crypt") in subtitles; tiny-base set deltas
- Search results show "Beckett 9" (grade SSOT folds BECKETT→BGS — search path bypasses the shared parser)
- Mobile: loading skeleton overflows 375px by ~170px until data streams (w-[480px] bars)
- Ribbon order flips: /ips "High · HHI 0.98" vs /platforms "HHI 0.46 · High"
- IP/Category terminology drift (nav "Categories" vs 404 "All IPs" vs "by IP" treemap labels); `watchlist` metadata "categories" vs `search` "IPs"
- Focus rings: RailActions:177 + NavBar:200 strip outline with no replacement; custom pills lack focus-visible
- /ips headline missing metadata-only note ("+ unattributed" row) if B4 keeps any gap between headline and split
- Dead code: IPVolumeChart.tsx (never imported, carries uppercase pills); gacha page metadata describes live feature while gated
- Homepage lacks page-specific metadata (inherits layout)
- "EV (coming soon)" in methodology copy — confirm intentional

## Tracked elsewhere
- `Confirm · VARIABLE` title + email old-brand strings → **email-phase branch** (files are uncommitted WIP)
- X handle placeholder, GA4 decision, Supabase upgrade → user checklist
