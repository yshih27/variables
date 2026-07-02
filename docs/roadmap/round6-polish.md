# Round 6 — visual polish + chart panes (7/2)

_Six user-reported issues from the round-4/5 verification, diagnosed. R6-1..4 are surgical; R6-5 is the activity-chart layout rebuild; R6-6 is copy/glossary._

## R6-1 — Sealed-product images in card art  [Frontend]
White-bg product shots (booster boxes, "×6/×12" baked in) render raw over the slab-glyph placeholder inside a slab-shaped frame (`TopSalesPanel`/`CardArt`). Fix in the shared `CardArt` path:
- Never render the placeholder glyph behind a successfully loaded image.
- CORS-blocked / untrimmable images: `object-contain` on a flat `bg-2` surface with generous padding — no white box.
- Sealed items (kind or name-heuristic): relax the slab aspect frame (square-ish container) so boxes aren't letterboxed into a slab shape.
- Applies to Top Sales, gacha hits ticker, trending rows, card page.

## R6-2 — ONE tooltip system, instant, branded  [Frontend]
`MetricInfo.tsx:41` sets native `title=` on the same element as the brand popover → grey native tooltip (slow, unstyled) stacks with ours. Also `CategoryTrendChart.tsx:307/322/350` and `IPActivityChart.tsx:333` use native titles.
- Strip `title=` everywhere a brand tooltip exists (keep aria-label for a11y).
- MetricInfo: open on hover/focus with no delay (~0ms in, ~100ms grace out), portal + clamped like the treemap fix.
- Route the price-index "how it's built" ⓘ through MetricInfo (kill the native-title version).
- Sweep: `grep -rn 'title=' src/components` — native titles allowed ONLY where no custom tooltip exists and the text is trivial.

## R6-3 — Cumulative end-label bug  [Frontend]
`IPActivityChart` endLabels read the last finite value of the RAW series (`s.vals`) — in Cumulative mode the label shows the last hourly increment ($282) instead of the rendered running total ($58.3K). Labels (and legend Δ chips) must read from the series **as rendered** (post-cumulative transform).

## R6-4 — Legend Δ% in cumulative mode  [Frontend]
Legend shows "Volume $58.3K −29.6%" while cumulative — the Δ mixes modes. In Cumulative, either hide the Δ chip or show window-total vs prior-window-total. Keep chips consistent with the rendered mode.

## R6-5 — Activity chart: main pane + sub-panes (the world-class pattern)  [Frontend, big]
Interleaved multi-series bars are unreadable (see 30D + 5 metrics). Adopt the TradingView/Dexscreener architecture:
- **Main pane:** $ metrics only — Volume (line+area), Avg Trade (line), Market Cap (step, right axis). Existing 2-unit axis rule applies within the pane.
- **Sub-panes:** each active COUNT metric (Trades, Cards Traded, Active Wallets) = a compact ~64px bar strip stacked below, sharing the x-axis. Per-pane: left = metric name chip, right = last value; own micro y-scale (no axis ticks, just a max gridline).
- **One crosshair** through all panes; ONE unified tooltip listing every active series (already per R4-5).
- **Delete normalized mode** — sub-panes make it unnecessary. Delete "axes hidden" state.
- Legend chips unchanged (toggle series; count metrics add/remove their sub-pane).
- Cumulative applies per-pane (flows + counts; mcap exempt).
- Mobile: sub-panes stack naturally; cap visible sub-panes at 2 with the rest collapsed behind "+N more".
- Empty/loading states per pane; a11y labels per pane.
**Acceptance:** Volume + Mcap + all 3 counts active = readable (1 main pane + 3 strips, one crosshair), no interleaved bars, no hidden axes anywhere.

## R6-6 — Primary/secondary copy + glossary entries  [Frontend + copy]
Builder-jargon leaks: "Other primary", "PRIMARY ONLY".
- Glossary entries (MetricInfo on the volume-bar legend chips + platform table columns + badges):
  - **Marketplace (secondary):** collector↔collector resale; platform takes a fee. The exit-liquidity signal.
  - **Gacha (primary):** pack rips — platform→collector first sales.
  - **Other primary → rename "Direct sales":** non-gacha first sales (Courtyard drops/mints). After the Courtyard kind→gacha reclassify (round-5 backend), verify what remains and relabel.
  - **PRIMARY ONLY badge (Phygitals):** coverage disclosure — "we track this platform's gacha; its secondary trading (Tensor/Magic Eden) isn't ingested yet," links /methodology.
- Homepage volume bar: each segment label gets ⓘ.

## Sequencing
R6-2/3/4 quick pass first (tooltips + labels), R6-1 with it. R6-5 is the big item. R6-6 copy rides with any pass. Backend round-5 items (Courtyard reclassify, Phygitals/Beezie feeds, gacha runWarmer) unchanged — this round is frontend-only.
