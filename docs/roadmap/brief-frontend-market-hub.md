# Executor WP — the market hub, frontend: one home for the market's numbers, one card anatomy, weekly by default

Frontend executor, Varible. Three PRs in the order below, each fresh off `origin/main` once the one before it has merged (or stacked with `--base` and said so in the body), pushed, opened against main, NO merging. Own worktree with the three symlinks; `--webpack` for dev, but `next build` + `next start` for anything that exercises `revalidate` (a dev server never does); `NEXT_PUBLIC_SHELL_V2=true`; tsc/eslint/build clean; truthful trailer. Design: `docs/roadmap/analytics-benchmark-blockworks.md` §5. Blockworks' TCG dashboard (`app.blockworks.com/analytics/tcg`) is the legibility bar: seven tabs, each one question, one card anatomy, weekly bars over the whole history. Our answer keeps what they do not have: every figure with its window and source, withheld figures that say why, an index built from realized resale with receipts. Their figures are a reference, never copied into the site.

**Two decisions sit with the owner; neither blocks PR 1.**
- **D1, Courtyard's buyback arbitrage.** Measured Oct 13 from Polygon: on Oct 11, 1,791 of Courtyard's 5,970 peer-to-peer trades (30.0%; $39,760 of $297,634, 13.4%) were bought by a wallet that sold the same card to Courtyard's buyback within 24 hours. On Aug 3, the peak of the summer spike, it was 24,372 of 30,810 trades (79.1%; $517,214 of $817,959, 63.2%). Exclude them from resale, disclose them on a receipt line, or leave them. The **Resale tab waits on this**, and on `brief-backend-market-hub.md` B1 (plus B3 unless the answer is "leave").
- **D2, venue logos.** Monogram tiles ship by default (below); a `logo` slot is ready for the owner's call on using venue logos as identification.

## What exists (build on it, do not re-derive)
- **Pages today and their reads** (measured on `main` 19782b7): `/stats` (`buildStatsBoard`, `src/lib/data/statsBoard.ts`: 4 KPIs, "Market volume by venue", "Resale vs gacha", the Index Studio, Holders, `CiteBlock`); `/platforms` (`fetchHomepage` + `getPlatformSeries` → `platformVolumeBands`: 5 KPIs, `VolumeBar`, "Volume by platform", `PlatformStatBar`, 4 `MetricBarCard`s, `PlatformTable` full); `/economics` (`buildEconomicsBoard`, `economicsHeroModel`: 4 KPIs, "Spend and payout pace", `RatioTrend`, `PlayerConcentration`, `EconomicsLeaderboard`, `CoverageMatrix`). The per-venue volume stack appears three times (`/`, `/platforms`, `/stats`); the Index Studio twice with the same seed (`/stats`, `/ips`); dominance and HHI twice on `/platforms` alone.
- **Frames and cards:** `Section` (`src/components/Section.tsx`: title, readMe, subtitle, `right` slot), `StatCard`/`StatCardRow` (value above label, mono `.tabular`), `MetricInfo` (the ⓘ popover over `src/lib/metrics/glossary.ts`), `TableFoot`, `ChartActions` (CSV · PNG · Share · Embed over `ExportMeta`, `src/lib/chart/export.ts`), `StackedAreaChart` (Stacked / 100% share / Cumulative, opt-in D/W/M via `grainSurface`, a brush), `CompositionChart`, `MetricBarCard` (its own frame), `IndexStudio` (its own exporter). Four title styles, six toggle implementations, legends above, below, in-plot or in a popover, never on the right. `StackedAreaChart` exports the raw daily series with the subtitle as its window even when it shows weekly or monthly.
- **Period maths:** `resampleToPeriod(points, "D"|"W"|"M", "sum"|"last", { dropPartialLead })` (`src/lib/chart/period.ts`): ISO Monday weeks, points stamped at the period end, the running week or month dropped, `dropPartialLead` drops a first bucket the series only partly covers. The internal chart route (`/api/internal/chart/series?freq=weekly`) resamples with no cross-venue source gate: the hub does not read it for W or M.
- **Spine reads and gates** (`src/lib/data/metricSnapshots.ts`): `readMetricSeriesBulk(entity, metric)`, `getPlatformSeries(metric)` (`src/lib/data/platformSeries.ts`, cached 3,600 s; the same bulk read is also cached inside `stats-board:v1` and `ips-platform-series:v1`: reuse `getPlatformSeries`, never add a fourth), `latestCompleteDay`, `dropIncompleteTail`, `sumLastCompleteDays`, `DELTA_MIN_BASE_USD`. Two tiers never mix: rolling-24h blobs (`fetchHomepage`) and complete calendar days (the spine).
- **History per venue in the spine** (production, read Oct 13 through `/api/internal/chart/series`, first non-zero day):

  | Series | Courtyard | Collector Crypt | Phygitals | Beezie | Renaiss | DYLI |
  |---|---|---|---|---|---|---|
  | `gacha_volume_usd` | 2023-11-30 | 2024-11-21 | 2025-03-22 | 2026-01-15 | 2025-11-06 | 2025-03-24 |
  | `volume_usd` (resale) | 2023-07-28 | 2026-05-26 | no source | 2026-05-31 | 2026-01-09 | 2025-01-30 |
  | `holders` | no source | 2026-06-24 | 2026-06-30 | 2026-06-24 | 2026-10-07 | no source |

  Collector Crypt's and Beezie's resale start late in the spine only because the daily writer keeps a 30-day window; the sales store holds them from 2026-02-09 and 2026-01-15 (the v4.3 ledger). Backend B1 fills the spine from the store. Until it lands, every card that sums resale says where each venue's resale starts (see the receipt rule).
- **Venue identity today:** `short` codes (`C`, `B`, `CC`, `PH`, `RN`, `DY`) in `PlatformTable`'s 28 px box and `railCode` (`CY`, `BZ`, `CC`, `PH`, `RN`, `DY`) in the rail and `GachaPackMatrix` (`src/lib/data/sources.ts`); no logo field; `IPIcon` (`src/components/IPIcon.tsx`, logo → monogram fallback over `src/lib/data/ipCatalog.ts`) is the pattern to copy. Colours: four venue maps keyed by rank or position (`PLATFORM_BAND_COLORS` + `venueColor()` in `platformSeries.ts`, `ECONOMICS_BAND_COLORS` in `economicsHero.ts`, `COLORS` in `RatioTrend.tsx`, a page-local map in `src/app/ip/[key]/page.tsx`), so a venue changes colour with its rank. Lane colours are consistent and stay: marketplace `--color-blue`, gacha `--color-yellow` (the brand lime), direct `--color-purple`.
- **Holds and absences** stay exactly as they are: `NO_IDENTITY_VENUES` (Courtyard never lands in per-IP rows or top sales), "—" for untracked (`hasSecondarySource`; Phygitals has no resale source), economics holds (`ratioHeld`, `heldReason`, `NetHeldReason` incl. `unpriced-spend`, `test:economics`), market holders = the union row, never Σ venues.
- **Embeds** (`src/lib/chart/embeds.ts`, validated in `src/proxy.ts`): `market-volume`, `resale-vs-gacha`, `holders`, `studio`, `economics-spend`, `economics-ratio`, `economics-players`, `home-index`. Each is a public contract: pasted iframes keep working.
- **Redirects:** `src/proxy.ts` 301s with `NextResponse.redirect(url, 301)` and keeps the query string (the house rule: 301, never 307/308). Its matcher covers detail routes only; `/stats`, `/platforms` and `/economics` are not in it. Fragments never reach the proxy, so `CiteBlock`'s `/stats#…` permalinks, `src/app/embed/[chart]/page.tsx` and `src/app/sitemap.ts` are updated by hand.
- **Nav:** the rail's Market section is Overview `/`, Stats `/stats`, Economics `/economics` (`src/lib/data/railModel.ts`, `RailNav.tsx` with `inMarket` hard-coded); `BottomTabs.tsx` (Market → `/`, no Stats or Economics); `CommandPalette.tsx`'s `PAGES`; the legacy `NavBar.tsx` for the flag-off shell.

## The hub
`/market`, one static folder per tab (`src/app/market/page.tsx`, `src/app/market/packs/page.tsx`, …; a dynamic `[tab]` segment would need `generateStaticParams` to cache at all), a shared `src/app/market/layout.tsx` with the tab bar (a client component on `usePathname`, no request-time reads), each page `revalidate = 1800`. Each tab answers one question; no card appears on two tabs. Every tab has the same rhythm: a two-thirds hero series beside one or two big numbers (the pair aligned top and bottom, §7), a full-width ranking table, then a two-column grid of series.

| Tab | URL | Question | Replaces | PR |
|---|---|---|---|---|
| Overview | `/market` | How big is the market, and who leads it? | `/stats`, `/platforms` (301) | 1 |
| Packs | `/market/packs` | Where does pack money go? | the gacha half of `/stats` | 2 |
| Economics | `/market/economics` | What do venues take in, and what goes back out? | `/economics` (301) | 2 |
| Prices | `/market/prices` | What is a card worth? | the Index Studio on `/stats` | 3 |
| Resale | `/market/resale` | What trades hands after the pull? | the resale half of `/stats` | 3, after D1 |

A tab that has not shipped is not in the tab bar. `/` (the homepage) and `/ips` (Categories) stay; the platform pages stay as each venue's own view.

### 1. ChartCard: one anatomy, three kinds (PR 1)
`src/components/chart/` holds the frame and three bodies. Every hub card uses it; nothing on the hub uses `Section`, `MetricBarCard`, `StackedAreaChart` or `CiteBlock` directly.
- **Header, one row:** the title, sans 15 px semibold, saying what the number is: "<Metric> by <dimension>" ("Turnover by venue", "Gacha spend by venue"); then a window chip in mono caps computed from the card's state ("WEEKLY · ALL", "30 COMPLETE DAYS", "24H ROLLING"); then the ⓘ (`MetricInfo`: definition, how to read it, the method link, and the citation that `CiteBlock` used to print under `/stats` cards); at the right edge one "⋯" menu: CSV, PNG, Copy link, Embed, Copy citation. No readMe line and no subtitle on hub cards: what they said moves into the ⓘ.
- **Series body.** One controls row under the header, only the controls that apply (absent, not disabled): mode `Bars · Area · 100%` for flows (`Line` alone for stocks such as holders), grain `D · W · M`, range `30D · 90D · 1Y · All`. Defaults for flows: Bars, W, All. Defaults for stocks: Line, D, 90D. The plot on the left; the legend on the right from 1,024 px (a 168 px column), wrapped under the plot below it. The legend opens with an "All" row (Σ over the visible window for flows, the latest value for stocks; for holders the union, never a Σ), then venues in the fixed venue order, each with its swatch, name and window value (its share in 100% mode); a click toggles a series, a hover highlights it. A brush under every series plot sets a custom range (the range control then reads "Custom"). Hover: a crosshair and one tooltip listing every visible series for that period ("Week of 6 Oct 2026") and the total. Plots are SVG (PNG export needs it). Bars are square (the radius token) with a 1 px `bg-1` gap between stacked segments.
- **Number body:** the value (mono `.tabular`, the `StatCard` scale), the label under it with its ⓘ, the delta with its basis ("vs prior 30 complete days", in percentage points for ratios), the window chip, the receipt line. Value above label everywhere; `OverviewMetricColumn`'s label-above-value is not used on the hub.
- **Ranking body:** rows are venues: `VenueMark`, name, chain. For each measure a group of value, Δ against the prior window and share of the column total; every column sortable (default: the first measure, descending); a window menu `24H · 7D · 30D · 90D` in the header (24H reads the rolling-24h tier and its chip says "24H ROLLING"; the others read complete days and say "N COMPLETE DAYS"; holders always show the latest reading with Δ 7D); an "All venues" totals row at the foot (the union for holders); each venue row links to `/platform/<key>`; "—" with its reason in a `title` tooltip for a withheld or unsourced cell; `TableFoot`. Below 768 px the table scrolls inside its card with the venue column sticky; the page never scrolls sideways.
- **The receipt line:** exactly one line under the body, mono 10.5 px `ink-3`: `source · window · as of`, composed from data ("On-chain and venue APIs · weekly, complete weeks · through 2026-10-11"). When the venues in a card start on different days (a venue's first complete week after the window start), the line ends "· venues join over time" and the ⓘ lists each venue's first day, computed from the series; when a composite (resale + gacha) starts its two legs on different days, the ⓘ says so per venue ("Collector Crypt: gacha from 2024-11-21, resale from 2026-05-26"). Truncated with an ellipsis if it overflows, the full text in its `title`.
- **State and sharing.** A card's mode, grain and range live in the URL fragment (`#<card-id>=<grain>.<range>.<mode>`), read on mount and written on change; Copy link copies the page URL with that card's fragment; a page opened with a fragment applies it and scrolls that card into view. Nothing is read from `searchParams` (it would make the page dynamic).
- **Exports say what is shown.** CSV exports the plotted values at the shown grain and range (the shares in 100% mode), with grain, range, mode and the receipt in its comment header; PNG rasterizes the live SVG with the title, window, receipt and legend. Fix `StackedAreaChart`'s raw-daily export while you are there, so the cards that stay on it outside the hub stop exporting a window they do not show.

### 2. Venue identity, everywhere (PR 1)
- **Colour follows the venue, never its rank.** Six tokens in `src/app/globals.css` `@theme` and one `VENUE_COLOR` map keyed by venue key (beside the registry in `src/lib/data/sources.ts`, or a new `src/lib/venues/identity.ts`), with one fixed `VENUE_ORDER` for every stack, legend and tooltip:

  | Order | Venue | Token | Hex | Contrast on `bg-1` |
  |---|---|---|---|---|
  | 1 | Collector Crypt | `--color-venue-collector-crypt` | `#d95926` | 4.77 |
  | 2 | Courtyard | `--color-venue-courtyard` | `#9085e9` | 5.93 |
  | 3 | Phygitals | `--color-venue-phygitals` | `#199e70` | 5.45 |
  | 4 | Renaiss | `--color-venue-renaiss` | `#3987e5` | 5.10 |
  | 5 | Beezie | `--color-venue-beezie` | `#c98500` | 6.04 |
  | 6 | DYLI | `--color-venue-dyli` | `#d55181` | 4.70 |

  The order is fixed: it was the 30-day gacha-spend order on Oct 13, and it never re-sorts when ranks change. Validated Oct 13 with the dataviz six-checks validator against the hub's surface (`validate_palette.js "<the six, in this order>" --mode dark --surface "#131316"`): lightness band, chroma floor and contrast pass for all six; worst adjacent colour-blind separation ΔE 13.2 (target ≥ 8), worst adjacent normal-vision ΔE 19.3 (floor ≥ 15). The order is part of the palette: 140 of the 720 orders pass, this one keeps blue and violet off the two largest bands so they do not read as the marketplace lane. The six fail an all-pairs test (any two side by side, as in a scatter), so a venue is never identified by colour alone: the legend and the tooltip name every series. Lime stays the brand accent and the gacha lane, never a venue; green and red stay for up and down.
- **Every venue-keyed chart reads `VENUE_COLOR`:** `platformVolumeBands`, `venueColor()` (identity and character pages), `economicsHeroModel`, `RatioTrend`, `PlayerConcentration`, the page-local map on `/ip/[key]`. Delete the four old maps.
- **`VenueMark`** (`src/components/VenueMark.tsx`): a square tile with the two-letter `railCode` in ink (text never wears the venue colour) and a 2 px left edge in the venue colour; an optional `logo` field on `PlatformSource` renders an image in the same box when set (D2). It replaces the `short` boxes in `PlatformTable`, `PlatformOverviewHeader` and `GachaPackMatrix`'s avatar, so Courtyard and Beezie stop showing one letter.

### 3. Overview, `/market` (PR 1)
- **Hero:** "Turnover by venue": resale + gacha + direct per venue, complete days, the stack in `VENUE_ORDER`. Beside it, two numbers: "Turnover" (Σ over 30 complete days, Δ vs the prior 30) and "Gacha share of turnover" (30 complete days, Δ in percentage points).
- **Ranking:** "Venues by turnover": Turnover · Gacha spend · Resale · Holders.
- **Grid:** "Turnover by lane" (resale, gacha and direct in the lane colours; default 100%, W, All) ‖ "Holders by venue" (stock; Line, D, 90D; the "All" row is the market union).
- **Redirects** in the same PR: `/stats` → `/market` and `/platforms` → `/market` (301, query kept; add both to the proxy matcher). The rail's "All platforms" points at `/market`. The embed ids `market-volume`, `resale-vs-gacha` and `holders` render the cards answering the same questions ("Turnover by venue", "Turnover by lane", "Holders by venue").

### 4. Packs, `/market/packs` (PR 2)
- **Hero:** "Gacha spend by venue". Beside it: "Gacha spend" (30 complete days, Δ) and, once backend B2 lands, "Pulls" (30 complete days, Δ). Until then, a link card "Compare every pack: odds, value back, what is inside → /gacha".
- **Ranking:** "Venues by gacha spend": Gacha spend · Pulls and Average pull once B2 lands.
- **Grid:** "Gacha spend by pack price": a venue × price-tier heat map over 30 days. Rows are venues in `VENUE_ORDER`. Columns are fixed tiers: ≤ $10, $10–25, $25–50, $50–100, $100–250, $250–1,000, > $1,000. Cells use one sequential hue with the dollar figure printed in each. It reads the sources that carry a 30-day price split: `gacha.platforms[k].byPrice` (Collector Crypt, Beezie, Phygitals; `src/lib/data/gachaDuneCache.ts`) and the Renaiss machine board (`readVenueMachineBoard`, `src/lib/data/venueBoards.ts`). The receipt names the venues with no split. It sits beside "Pulls by venue" (W, All) once B2 lands; until then it spans both columns.

### 5. Economics, `/market/economics` (PR 2)
- `/economics` moves into ChartCards without changing a figure, a label's scope or a hold. The cards:
  - the four numbers (spend, outbound, payout ÷ spend, net with its held chips);
  - the hero "Gacha spend and payouts" (spend by venue with the payout ÷ spend overlay);
  - "Payout ÷ spend by venue" (`weeklyPayoutRatio`, 100% marked, held venues under "Not shown") ‖ "Who is spending" (top-1% share and tiers);
  - the ranking "Venues by gacha economics" (today's leaderboard columns and hold tooltips);
  - "Coverage by venue" as a full-width table card.
- **This tab is a 30-day board, and it stays one.**
  - The hero keeps its 30 complete days with daily as the default and weekly offered.
  - The board carries only that window (`spendDaily`/`outboundDaily` in `buildOne`).
  - A longer window would mix the payout leg's pre-R3 and R3 days, so it is a separate decision, not part of this move.
- "Who is spending" gains Renaiss: `readVenuePlayers(key)` (`src/lib/data/venueBoards.ts`) already serves it to the platform page, but the board reads the `player-analytics` snapshot only (`build()` in `src/lib/data/economics.ts`).
- `/economics` → `/market/economics` (301). The `economics-*` embed ids render the new cards. `npm run test:economics` stays green.

### 6. Prices, `/market/prices` (PR 3)
- The Index Studio moves here from `/stats`, unchanged inside; its frame header takes the ChartCard header style only if that is a style change.
- Beside it: "V-MKT" (the last published close with Δ 1M) and "V-MKT, month to date" (the provisional reading with its n and the thin flag), read with `readIndexSeries` and `readIndexProvisional` as the homepage does.
- The method line and the receipts link stay as the studio renders them. `/ips` keeps its own studio in this round; deduplicating it is a follow-up.

### 7. Resale, `/market/resale` (PR 3, only after D1 and backend B1)
- **Hero:** "Resale by venue". Beside it: "Resale" (30 complete days, Δ) and "Average sale" (30 complete days).
- **Ranking:** "Venues by resale": Resale · Trades · Average sale.
- **Grid:** "Average sale by venue" (Line, W; Σ volume ÷ Σ trades per week, never a mean of daily averages) ‖ "Largest sales" (30 days, ten rows: card, grade, venue, price, day; each row → `/i/<slug>`, from the cleaned `sale-panel` rows, ≥ $1). Courtyard's rows carry no card identity and are left out of "Largest sales" with a receipt saying so.
- Phygitals is absent from every resale series, with "no resale source" in the ⓘ. Whatever D1 decides about Courtyard's arbitrage is shown the way D1 says (a separate series, a receipt line, or nothing), never silently.

### 8. Navigation and copy (PR 1, extended as tabs land)
- **Rail Market section:** Home `/`, then one row per shipped tab; `inMarket` = `/` or a path under `/market`.
- **BottomTabs:** Market → `/market`.
- **Palette:** the shipped tabs in `PAGES`, with "stats", "platforms" and "economics" as aliases that find them.
- **Legacy `NavBar`:** the same links.
- **Sitemap:** the hub URLs in place of the three old pages.
- **Homepage:** its "Volume by platform" card takes `VENUE_COLOR` and gains an "Open in Market →" link to `/market`. It stays as the landing page's picture of the market, not a second home for the question.
- **Share image:** one per tab (reuse `src/lib/og/ogCard.tsx`).
- **"Tokenized collectibles", never "trading cards":** eight strings were found on Oct 13. Five change in PR 1:
  - `src/app/layout.tsx` (the site description);
  - `src/app/page.tsx` (the homepage subline);
  - `src/components/SiteFooter.tsx` (two lines);
  - `src/lib/metrics/glossary.ts` (the price-index entry).

  The other three are on `/stats` and leave with the page. "TCG" as a category name (V-TCG, the rail's TCG branch) stays.
- **Titles say what the number is:** no explanatory paragraphs under them.
- No emojis; sans prose, mono numbers.

## Constraints
- **Caching:**
  - Zero request-time reads: no `headers()`, `cookies()` or `searchParams` in any hub page or layout.
  - Every read goes through `unstable_cache` (one builder per tab in `src/lib/data/marketHub.ts`, keys `market-hub:<tab>:v1`, 3,600 s, tag `platform-buckets`), reusing `getPlatformSeries` for the platform bulk reads.
  - On `next build` every tab is ● (ISR), never ƒ.
- **Payload:**
  - Weekly and monthly series cover the whole history; daily covers the last 365 days, so `D` with `All` shows the last year and its chip says so.
  - Each tab's HTML stays ≤ 450 KB uncompressed on `next start`, measured.
- **Complete periods only:**
  - Days come through `latestCompleteDay`/`dropIncompleteTail`, so a cross-venue sum ends on the last day every venue in it has complete.
  - Weeks and months come through `resampleToPeriod` (the running period dropped, a partial first bucket dropped per venue).
  - Untracked is "—", never 0. A held figure is "—" with its reason.
- **No typed numbers:** every figure, n, date and venue-start list in copy is computed, with its window and source.
- **Order and colour:** `VENUE_ORDER` everywhere a venue list renders, unless the user sorts a table. `VENUE_COLOR` and tokens only, no raw hex outside `globals.css`.
- **Styling:** the radius token (no bare `rounded` or `rounded-full`).
- **§7:** every pair aligns top and bottom, measured.
- **Embed ids:** existing ones keep working; every hub series card gets one (`market-turnover-lane`, `packs-spend`, `packs-price`, …) in `embeds.ts`.
- **Accessibility:**
  - A legend for every chart with two or more series.
  - Controls are buttons with `aria-pressed` and visible focus.
  - The ranking table is the table view of each tab.

## Verification
- **Build and cache:** `next build` clean, listing `/market` and every shipped tab as ●. On `next start`, each tab answers `s-maxage=1800` and a second hit `x-nextjs-cache: HIT`.
- **Redirects and embeds:**
  - `curl -I` on `/stats?x=1`, `/platforms` and `/economics` shows 301 with the right `Location`, query kept.
  - Every embed id answers 200 and renders its card.
- **Pure helpers, unit-tested (`npm run test:market`):**
  - weekly and monthly series end on the last complete period, and a venue's first bucket is complete;
  - a cross-venue Σ ends on the last day every member is complete;
  - the ranking table's Δ and share maths, and its totals row equal to the number card above it (the cross-surface rule the invariants gate applies to the homepage);
  - the receipt composer and its venue-start list from fixtures;
  - the fragment state codec round-trips;
  - `VENUE_COLOR` covers every key in `PLATFORM_SOURCES`, and no key maps to a lane or status token.
- **Existing tests:** `npm run test:economics` green.
- **Exports:** for each tab's hero, the CSV at W/All against the plotted values; paste the header comment and the last three rows.
- **Visual checks:**
  - Headless-Chrome screenshots at 1,440 and 375 px of every shipped tab, using the CDP driver `scripts/dev/cdp-eval.mjs`.
  - `scrollWidth === innerWidth` at 375 px.
  - The §7 pairs measured to 0 px.
  - One venue in the same colour across `/market`, `/`, `/platform/<key>` and an identity page, one strip screenshot.
- **Palette:** the validator command and its output, rerun if any hex changes.

## Report in the PR body
- **Moves:** a table of every section that moved (old page and title → tab and card) and every section removed as a duplicate.
- **Redirects:** the redirect table.
- **Payload:** HTML bytes per tab, and the payload's composition (series × grains × points).
- **Receipts:** each hero's receipt line and ⓘ as rendered, with its computed venue-start list.
- **Screenshots:** before and after at 1,440 and 375 px.
- **Copy:** what changed in copy that this brief did not name, and why.
- **Gaps:** every panel not built, and what it waits on.
