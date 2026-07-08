# Round 9 — next-builds readiness + briefs (7/8)

_Live walk: /status fully green (19 ok · 0 stale · 0 error — threshold fix + phygitals-catalog dereg confirmed); no broken images/dead links; warm pages ~2s. **One perf finding:** homepage cold (uncached) render = **14–22s** (measured twice) vs /ips 2.3s — the fetchHomepage aggregation is the outlier; ISR hides it except on cold starts/redeploys._

## Readiness verdicts (full detail from the code audit)

| Feature | Verdict | Size | Core gap |
|---|---|---|---|
| Slice engine | PARTIAL | **L** | Spine (set/grade/platform_ip) + SliceView shell ready; missing descriptor codec, unified `getSlice()` (IPDetail ≠ PlatformDetail), `childSlices()`, `/explore` route; ~8 pages + 6 components to retrofit; ⚠️ `SliceDescriptor` name already used by the UI shell — rename one |
| Card price history (G) | PARTIAL | **M** | Per-token history ALREADY EXISTS in `buildSalePanel` (CC 30d, Beezie ~all, Courtyard full) — just not queryable by tokenId; card page has the "Soon" slot waiting; Phygitals excluded |
| Public read API | PARTIAL | **M** | `readIndexSeries`/`readBenchmarkSeries`/`getTrendingCards` outputs are clean JSON; only cron+img routes exist; zero auth/rate-limit primitives |
| Weekly report | PARTIAL | **M** | WoW math, `indexStats` (returns/beta/corr), `pctChange`, bulk reads all exist; missing: top-movers ranker, report composer, weekly schedule |
| Per-entity OG images | PARTIAL | **M** | Root OG static; `/ip`,`/card`,`/platform` inherit it; data available via existing readers; needs 3 `ImageResponse` routes (pin Node runtime — readers hit the DB) |

## Recommended sequencing — GTM-aligned round first

The proposal's Phase 1 (credibility) needs the **weekly report + OG images**; Phase 2 needs the **API**. All three are M-sized and independent. The slice engine is the L-sized product-depth build — do it next round with full focus, not squeezed alongside GTM items.

### Round 9A (now) — GTM enablers + perf
- **B9-1 [Backend] Homepage payload precompute** — fix the 14–22s cold render: warmers write a single derived homepage snapshot blob; `fetchHomepage` reads one row (the old R2-B1 "precompute" lever, never done).
- **B9-2 [Backend] Weekly report engine** — movers ranker (`readMetricSeriesBulk` + `pctChange` across IPs/platforms/sets) + report payload composer (index WoW, vs benchmarks, top movers, biggest sales, notable pulls); write as a `weekly-report` snapshot on a Monday cron.
- **B9-3 [Backend] API v1** — `/api/v1/index`, `/api/v1/benchmarks`, `/api/v1/trending` as thin wrappers; shared bearer/API-key helper (extract the inline cron pattern); simple per-key daily quota (attribution-required free tier).
- **F9-1 [Frontend] Per-entity OG images** — one shared `ImageResponse` template → `/ip/[key]`, `/platform/[key]`, `/card/[id]` OG routes (name + headline stat + spark + brand); Node runtime.
- **F9-2 [Frontend] /report page** — renders the weekly-report snapshot as a shareable page (the artifact Phase 1 distributes); OG image included.
- **F9-3 [Frontend] Card price history v1** — consume B9-4's per-token reader in the card page's waiting "Price history" slot (sparse-honest: dots + step line, "N sales" label).
- **B9-4 [Backend] `getCardSales(tokenId)`** — reader over the already-cached CC/Beezie sale feeds (no new crawling); powers F9-3.

### Round 10 (next) — the slice engine (L)
Per `slice-engine.md` + audit notes: resolve the `SliceDescriptor` naming collision, define unified `SliceData`, build codec + `getSlice()` + `childSlices()` + `/explore/[...path]`, retrofit the 8 pages/6 components as wrappers. Card/set/grade drill-downs + per-slice trending come free after.

## Leftovers verified done
`phygitals-catalog` deregistered (code-clean) · `recordWarmerFailure` fully deleted · freshness thresholds correct.
