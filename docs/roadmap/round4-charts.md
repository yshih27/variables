# Round 4 — chart intelligence (7/2)

_Five user-reported issues, verified in code. R4-1..4 are targeted fixes; R4-5 is the flagship activity-chart rebuild._

## R4-1 — Relative strength: correct math, misleading presentation  [Frontend]
`page.tsx` computes relStrength = index return − benchmark return **since inception (Jan 12)**. +168.7% vs BTC is real (134.5 − (−34.2)) but reads broken because the window is unlabeled and 6-month pp-spreads are huge.
- Label the VS BENCHMARKS column with its window ("since Jan 12").
- Lead with **30d** relative strength (relatable), since-inception as the secondary row or a tooltip.
- Keep "price index" wording next to the index value (already flagged).

## R4-2 — Trending: platform coverage + sealed/slab split + float-0 fix  [Backend + Frontend]
- **Backend:** build cached **≥14d row-level feeds for Beezie + Phygitals** (Beezie `/activity` reaches months back; Phygitals sales feed has history). That lights up the 7d window + momentum for both — the panel stops being CC-only. Add `kind: "slab" | "sealed"` classification to the cards/type grouping (heuristics: grade ≡ Ungraded AND name matches Booster|Bundle|Box|ETB|Pack|Case|Lot → sealed; graded → slab).
- **Frontend:** **All | Slabs | Sealed** tabs on the trending panel. For `float = 0` rows, stop showing `trades ÷ 1` as "N.0×" — show a "no listings" chip and rank those by trades/volume instead. Note in the legend that sealed products rarely have marketplace float.

## R4-3 — Chart legends: every chip toggles + index explainer  [Frontend]
`CategoryTrendChart` benchmark chips toggle; IP chips don't. Make **all** legend entries click-to-toggle (pressed styling, keep ≥1 visible). Add a hover/ⓘ explainer on the price-index subtitle: "weekly stratified-median of actual sale prices within set×grade cells, trade-weighted — not market cap" + link to /methodology.

## R4-4 — Treemap tooltip  [Frontend]
`CategoryTreemap.tsx`: per-tile tooltips render inside `overflow-hidden` tiles → One Piece clipped, Pokémon/Other show nothing. Replace with **one container-level tooltip**: absolutely positioned from cursor, clamped to container bounds, `z-50`, `pointer-events-none`; hover handlers on every tile.

## R4-5 — Activity chart v2: the flagship module  [Frontend, big]
The deep-dive Activity chart today: 5 metrics, all smoothed lines, one y-axis. Rebuild as the app's flagship (`IPActivityChart` → keep bespoke SVG — no chart lib; matches brand + keeps bundle small):

**Encoding by metric type (the core fix — no more counts-as-lines):**
- **Counts** (Trades, Cards Traded, Active Wallets) → **bars** (daily buckets).
- **Flow $** (Volume, Avg Trade) → **line + soft area** (current treatment).
- **Stock $** (Market Cap) → **step-line, right axis**, never shares the flow axis.

**Axis rules (kills the everything-on-one-axis problem):**
- Axes are per **unit**: `$ flow` (left), `count` (right) or `$ stock` (right). Max 2 units active at once; picking a metric from a 3rd unit auto-switches the chart to **normalized mode** (each series rebased to its own window range, axis hidden, tooltip shows real values). Axis labels state their unit.

**Modes:**
- **Daily | Cumulative** toggle (∑ running total within the window — flow/count metrics only; mcap is excluded from cumulative).
- Range pills stay (24H hourly / 7D / 30D / ALL daily).

**Interaction (the "every nook" list):**
- **Unified crosshair**: hover → vertical guide + dot on every active series + one tooltip listing date + each active metric (color chip, name, value, Δ vs prior period). Snap to nearest bucket; tooltip clamped to bounds.
- Legend chips = toggles (pressed state, ≥1 always on), consistent with R4-3.
- **End-of-line/last-bar value labels** (exists — keep) + per-metric Δ% chip in the legend.
- Bars: hover highlight; rounded 1px caps; min-height 2px for nonzero values so tiny days stay visible.
- **Empty/insufficient states**: no data → "no activity in this window" (not a flat $0 line — regression guard from QA-2); partial windows labeled.
- Loading skeleton (shimmer axes + ghost bars).
- **Mobile**: chart fills width, tooltip becomes a fixed summary row under the chart on touch; legend wraps; range pills stay reachable.
- **A11y**: `role="img"` + aria-label summary ("Pokémon volume, 7 days, latest $79.6K"); legend chips keyboard-focusable.
- Keep monotone-cubic smoothing for lines; **no smoothing on bars** (bars are honest counts).

**Acceptance:** Volume(line) + Cards Traded(bars) render together with two labeled axes; adding Market Cap flips to normalized mode; cumulative works; crosshair tooltip shows all active series; no metric ever renders on a wrong-unit axis.

## Sequencing
R4-1/3/4 are small frontend fixes — one pass. R4-2 backend (feeds + classifier) can run parallel. R4-5 is the big frontend item — start after the small ones land. Slice engine stays queued next (R4-5's chart lands inside SliceView, so it benefits every slice).
