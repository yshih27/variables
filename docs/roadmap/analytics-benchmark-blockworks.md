# Analytics benchmark: Blockworks' TCG dashboard against ours

Read on Oct 7 2026 by the orchestrator, at the owner's request ("their site is so much more well put together and so much easier to analyse, read, understand and navigate"). Source: https://app.blockworks.com/analytics/tcg, its seven tabs captured full-page at 1440 px, and our `/`, `/stats`, `/platforms`, `/economics`, `/ips` and `/report` captured the same way. Every figure below was read on Oct 7. Blockworks' figures are theirs, quoted to compare, never to publish.

## 1. What they built

**One sector, seven tabs, each tab one question.** Each tab is its own URL (`/analytics/tcg/tcg-sector-<tab>`).

| Tab | Panels | The question it answers |
|---|---|---|
| Overview | 10 | How big is the sector, and who leads it? |
| Financials | 16 | Who makes money, and how much is kept after buybacks? |
| Gachapon | 14 | Where does pack money go, by venue, price and payment rail? |
| Marketplace | 15 | How much trades hands after the pull, where, and at what fees? |
| Blockchain | 15 | Which chains and stablecoins carry it? |
| User Behavior | 8 | Who are the spenders, and how concentrated? |
| Adoption | 16 | Is on-chain winning against the physical market (Card Ladder, PSA, Google Trends)? |

That's 94 panels, and no section is repeated across tabs. A reader always knows where a question lives.

**One card anatomy, everywhere.**
- **Title:** "TCG: <metric> by <dimension> (<window>)", e.g. "TCG: Gacha Spend by Protocol", "TCG: Total GMV (30D)". The title alone says what the number is.
- **Definition:** one ⓘ beside the title. No subtitle, no caption.
- **Controls:** one row with three chart modes (stacked, bars, 100% share) and one granularity menu (Weekly by default).
- **Legend:** on the right, the same order in every chart, with "All" first.
- **Time:** a range brush under every time series, showing the whole history (2024/2025 to now).
- **Colours:** one colour per protocol, the same in every chart on every tab.

**Three card types, no more.**
- Time series with its legend.
- Big number: one figure, one label, the window.
- Ranking table: protocol logo and chain icons; for each measure the value, its Δ and its share; every column sortable; a window menu (30D); search.

**The page grid.** Each tab opens with a two-thirds hero chart beside one or two big numbers, then a full-width ranking table, then a two-column grid of time series. The same rhythm on all seven tabs.

**Restraint.** One sans typeface. Colour only in series. No paragraphs. No export rows. A watermark instead of a citation.

## 2. Where we stand (measured on our pages, Oct 7)

**The same sections on several pages, and no single home.**
- The analytics live on six pages: Overview (`/`), Stats, Economics, Categories (`/ips`), Platforms and Report. /gacha joins when its flag flips.
- "Volume by venue" appears on three of them (`/`, `/platforms`, `/stats`), and the Index Studio on two (`/ips`, `/stats`).
- A reader cannot tell which page answers which question.

**No single card anatomy.**
- On `/stats` alone, three chart cards have three layouts:
  - the venue chart puts its legend above the chart;
  - the index chart has its own control set and up to five lines of small text under it (provisional receipt, sample, receipts link, method line, legend key, interaction hints);
  - the holders card is a mini chart.
- Every card carries a CSV · PNG · Share · Embed row, plus a CITE line under it.
- Subtitles stack on top: "daily turnover per venue — marketplace resale plus gacha — band thickness is one platform's daily take", then "Last 90 days · complete days only · through 2026-10-06".

The honesty is right; the presentation makes it noise.

**Daily-only series in 90-day windows.** Daily gacha volume swings 2–3× day to day, so our charts read as noise where Blockworks' weekly bars read as a trend. Our default window shows 90 days; theirs shows the sector's whole history.

**Two-letter codes, not logos.** The ranking tables say CC / C / PH / B / DY / RN. The owner's standing quality bar already rules out one-letter codes and ragged icons.

**Copy that breaks a standing rule.**
- `/stats` says "The tokenized trading-card market in numbers".
- The homepage says "across 6 tokenized trading-card platforms".

Varible covers all tokenized collectibles. Collector Crypt's machines alone sell watches, sports and comics (a Rolex Explorer II topped a hits band on Oct 7).

**Surfaces that disagree.** `/platforms` printed "—" for Renaiss's 24h gacha volume while `/platform/renaiss` printed a figure, on the same morning.

## 3. What we have that they do not (keep it, and lead with it)

- **A price index built from realized resale, by identity, with receipts.** Every published month links to the sales behind it, plus a method ledger and a provisional reading for the running month. Blockworks' price panels borrow Card Ladder's physical index.
- **Card-level pages:** identity pages with a reference price, an embeddable price chip, grade ladders and "where it trades".
- **Your vault:** paste a wallet and every slab is priced by the same rule.
- **The pack comparison** (`/gacha` when the flag flips): stated against measured odds, value back with its n, what's in each pool, and the prize finder. Blockworks ranks spend; we compare what a pull is worth.
- **Coverage they lack:** DYLI and Renaiss (BNB Chain). They have Monster and Bonkuji instead.
- **Honesty they don't show.** Every figure carries its window and source, and a withheld figure says why. Blockworks prints a net revenue for every protocol without saying how a buyback is counted.

The goal is their legibility with our receipts, not their layout with our numbers removed.

## 4. Our numbers are lower than theirs: check that before polishing

| Measure | Ours | Blockworks | Ratio |
|---|---|---|---|
| Gacha spend, all venues | $194M, 30 complete days to Oct 6 (`/stats`) | $268.9M, 30D | 0.72 |
| Marketplace resale, all venues | $3.19M, 30 complete days | $12.66M, 30D | 0.25 |
| CC gacha | $2.91M / 24h (`/platforms`) | $146M / 30D ≈ $4.87M a day, 801K packs | ≈ 0.60 |
| Courtyard gacha | $1.27M / 24h | $79M / 30D ≈ $2.63M a day, 938K packs | ≈ 0.48 |
| Phygitals gacha | $634K / 24h | $31.3M / 30D ≈ $1.04M a day, 864K packs | ≈ 0.61 |
| Beezie gacha (the Claw) | $143K / 24h | $8.57M / 30D ≈ $286K a day | ≈ 0.50 |
| Courtyard resale | $15 / 24h (Rarible activity index) | $6.4M / 30D (its in-app marketplace) | — |

The 24h-against-30D-average comparisons are rough, because a single day is noisy. But every venue sits at 0.5–0.6, which points to definitions or rails we don't read, not to one broken feed.

Hypotheses, each checkable:
1. **Collector Crypt on Robinhood.** Blockworks' DAU legend splits "Collector Crypt (Solana)" and "Collector Crypt (Robinhood)". We read Solana only.
2. **Credit-card spend.** Blockworks shows a "payment rail" split, with credit cards at 34.3% of Courtyard's gacha spend, 17.0% of Phygitals' and 1.6% of CC's. If card purchases settle off the wallets we read, we never see them.
3. **Gross against filtered.** Our spend leg counts canonical pull prices into known wallets (`gacha-buyback-scope-mismatch`); theirs may be gross inflow. In August our allowlist captured 96.8% of CC's gross inflow, so this explains little for CC.
4. **Courtyard's in-app marketplace** ($6.4M a month, by their count) is invisible to us. It's already bet 5 ("Courtyard in-app through partnership").

None of this changes what we publish until it is measured. A backend investigation brief comes first. A world-class surface over numbers a reader can check against Blockworks and find 40% short would hurt the site more than the clutter does.

## 5. Proposal: an analytics hub with their legibility and our receipts

1. **One home, tabs by question.** `/market` with tabs, each its own URL, linked from the rail:

   | Tab | Its question | What moves there |
   |---|---|---|
   | Overview | How big is it, and who leads? | `/stats`' KPIs; one venue ranking table |
   | Packs | Where does pull money go? | `/stats` resale-vs-gacha; the volume mix; a venue × price heat map from the pack catalog. Links to `/gacha` for the comparison. |
   | Resale | What trades after the pull? | marketplace volume by venue; top single sales; average sale; buyer tiers |
   | Venues | Who makes money? | `/economics` (spend vs payouts, R3 net where it's earned) and the `/platforms` ranking |
   | Players | Who spends? | the players and concentration panels now buried on platform pages |
   | Prices | What is a card worth? | the Index Studio, the V with its provisional, categories |

   - `/stats`, `/platforms` and `/economics` redirect into their tabs (301 in proxy.ts, as the vault redirect does).
   - `/ips` stays as Categories, and the platform pages stay as each venue's own view.
2. **One `ChartCard`, three kinds** (series, big number, ranking table):
   - **Title:** "<Metric> by <dimension>", plus a window chip.
   - **ⓘ:** holds the definition and the method link.
   - **Controls:** one row: Stacked / Bars / 100% · Daily / Weekly / Monthly · 30D / 90D / 1Y / All.
   - **Legend:** on the right, "All" first.
   - **Receipt:** exactly one line under the plot, "source · window · as of". The CITE text moves into the ⓘ and the copy menu.
   - **Exports:** CSV / PNG / Share / Embed collapse into one "⋯" menu.
   - **Withheld figures:** "—" with the reason in the ⓘ and the receipt line, as now.
3. **Weekly by default for flows, the whole history in reach.** Daily stays one click away. The spine's depth per venue sets "All", and the receipt says where each venue starts.
4. **One colour per venue, everywhere.** Its logo goes in tables and legends, in place of two-letter codes; logos used as identification, the way every aggregator uses them. The owner decides on logos against monograms.
5. **Ranking tables like theirs.** For every measure: value, Δ and share. Sortable, with a window menu. Each venue row links to its platform page.
6. **Copy:** "tokenized collectibles" on `/stats` and the homepage; titles say what the number is; no explanatory paragraphs.
7. **Panels to add where we hold the data:**
   - packs opened by venue (pull counts);
   - spend by pack price (the pack catalog);
   - top single sales;
   - buyer concentration by spend tier, already built for CC and Phygitals;
   - unique buyers by venue.

   Not until sourced: credit-card share (no source), chain stablecoin share (not our question).

## 6. Order of work
1. **Backend, first:** a coverage investigation brief: CC on Robinhood, the card-payment rail, gross vs filtered, Courtyard in-app. Every hypothesis gets a measurement and a decision. Plus the `/platforms` vs platform-page disagreement for Renaiss.
2. **Frontend:** `ChartCard` and the `/market` hub, built against today's data. Each tab is migrated one at a time, its old page redirected in the same PR.
3. **Copy and venue identity:** with the hub.
