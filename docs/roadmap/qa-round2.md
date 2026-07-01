# QA round 2 — preview feedback (7/1)

_From testing the live preview. Most of this is chart polish (frontend); one real perf workstream (backend)._

## Diagnoses (so the fixes are aimed right)
- **Benchmarks "dark" is NOT the API keys.** Queried the DB: BTC 366 pts, ETH 366, GOLD 365, SP500 274, NASDAQ 274 — all populated. `CategoryTrendChart.tsx` **defaults the benchmark overlay OFF** (opt-in, by design). Fix = flip the default on. No backend/key work.
- **Slowness is real:** pages are `ƒ Dynamic` and do ~1.3–2.0s of Supabase reads + aggregation **per request** (measured on warm dev SSR). On the preview (cold serverless + cold cache) every hit pays it.

---

## Frontend

**R2-F1 — Smooth the index lines (comments #1, #5).** The price-index lines in `CategoryTrendChart.tsx` (both "Performance by IP" and "X vs market") render as straight segments between weekly points → jagged. Switch the path generation to a **monotone-cubic** curve (smooth, and no overshoot — honest for financial series). Weekly data means limited points; monotone avoids inventing false peaks.

**R2-F2 — Default the benchmark overlay ON (comments #1, #5).** In `CategoryTrendChart.tsx` the benchmark lines (BTC/ETH/S&P 500/NASDAQ — and **add GOLD**, it's in the data) default off; change the default `active` set to include them so they show without a click. **Also verify the toggle actually draws a line when active** — a click-test drew nothing, so confirm there's no render bug once they're on. Keep them clickable to hide. Data is confirmed present — this is purely display.

**R2-F3 — Fix the "Marketplace | Market cap" toggle (comment #2).** On the `/platforms` chart, the basis toggle mixes a volume-type ("Marketplace") with a stock metric ("Market cap") — conceptually wrong. Restructure to: **primary toggle = Volume | Market cap**; when Volume, a secondary split = **Marketplace (secondary) / Gacha (primary)**. The series exist (`volume_usd`, `gacha_volume_usd`, `mcap_usd`).

**R2-F4 — Activity chart axes (comment #4).** `IPActivityChart` overlays Volume ($44K), Market Cap ($38.6M), Trades (146)… on **one shared y-axis** — different units and ~1000× scale gaps, so only one metric fits and the rest are mis-scaled. Fixes: (a) **end-of-line current-value labels** on each series (asked for); (b) give each active metric its **own auto-scaled axis** (or normalize each series to its own range so overlays compare *shape*, not absolute) — or restrict to one metric at a time; (c) consider **bars** for volume-type metrics vs a line for the index/mcap. Don't put mcap and volume on the same linear axis.

---

## Backend

**R2-B1 — Page load performance (comment #3).** Pages re-aggregate from Supabase on every request (~1.5s measured). Levers, roughly in impact order:
- **Fix the >2MB `getPlatformDetail` cache payload** (known bug: the `unstable_cache` set fails, so that page *never* caches → always slow). Trim/gzip the payload.
- **Precompute derived page payloads** (homepage / `/ips` / platform) into single snapshot blobs so a page reads **one row** instead of aggregating many.
- **Confirm `unstable_cache` is hitting** (tags/keys) and consider **ISR** — since data changes every 6h, these pages can `revalidate` on the order of 30–60 min and serve cached HTML instantly. (Frontend can add the `revalidate` export; backend makes the reads cacheable.)
- Profile first to confirm which of these dominates.

**R2-B2 — (supports F3):** confirm per-platform/per-IP `gacha_volume_usd` + `volume_usd` daily series are exposed for the stacked Volume view (should already be in the spine).

**No backend work for benchmarks** — data is present (incl. GOLD). R2-F2 is display-only.
