# Audit round 8 (7/6) — data refresh + frontend health

_Trigger: /ips 24h Δ column showing +0.0% everywhere. Verified first: **data IS refreshing daily** (spine has 7/4-6 points, values moving; Helius burn ~431 cr/cycle post-fix). Overall verdict: app is healthy — no broken handlers, no N+1 queries, no console noise. Findings are presentation/config, mostly quick wins._

## Frontend

- **F8-1 (MED) — 24h Δ column measures the wrong metric.** `fetchHomepage.ts:376` `pct1d` derives from `mcap_usd`, which moves ~0.006%/day (insured values are static day-to-day) → whole column reads "+0.0%" and looks broken. **Fix: drop the 24h Δ column from IPTable (keep 7d/30d mcap deltas)** — or switch it to a volume-based Δ if a 24h signal is wanted. Homepage teaser already dropped it (only Δ7d) — /ips is the offender.
- **F8-2 (LOW) — missing glossary entry**: the 24h column header has no `info=` / `METRICS.pct1d` entry — ⓘ affordance dead-ends. Add entry or remove ⓘ (moot if F8-1 drops the column).
- **F8-3 (LOW-MED) — `/gacha` still `force-dynamic`** (`gacha/page.tsx:9`): data updates on ~6h warmers; use `revalidate = 3600`.
- **F8-4 (LOW) — `/methodology` has no `revalidate`** (static content re-renders per request): add `revalidate = 3600`.
- **F8-5 (LOW) — `CardImage.tsx:127` fallback images hardcode `loading="eager"`** — switch to lazy except above-fold.
- **F8-6 (hygiene) — cache-key bumps undocumented** (`homepage:v42`, `ips-fulllist:v6`): add a one-line comment at each bump noting what changed, so a schema change never ships without a bump.

## Backend

- **B8-1 (MED, 2 lines) — false "stale" alarms**: `benchmarks` + `price-index` missing from `SOURCE_INTERVALS_MS` in `src/lib/db/freshness.ts` → default threshold flags them at 13-17h though they're daily jobs. Add `benchmarks: DAY_MS, "price-index": DAY_MS` (stale = 2× interval = 48h). Also delete/deregister the reverted `phygitals-catalog` job that still errors in /status.

## Verified clean

Daily spine refresh ✓ · Helius burn at new normal (~431 cr/cycle) ✓ · no dead handlers/aria-pressed stubs ✓ · no empty hrefs ✓ · console.error usage legitimate ✓ · `readMetricSeriesBulk` used correctly (no per-row queries) ✓ · rolling-24h vs calendar-day windowing correctly separated and labeled ✓
