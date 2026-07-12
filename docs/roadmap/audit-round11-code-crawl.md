# Round 11 — full code crawl (bugs · dead code · failure paths)

_Audit-only round: find and DOCUMENT, do not fix. Each worker writes findings to their section file (below), severity-ranked, with `file:line`, evidence/repro, and a one-line proposed fix. I triage into a fix round after both land._

**Ground rules (both workers):**
- Read-only — no code changes, no DB writes. Do NOT run warmers (shared nano DB; CPU incident 7/8). Local `build`/`lint`/`tsc` only.
- Evidence over vibes: a "bug" needs a concrete failing input/path; "dead code" needs proof nothing imports/renders it (check `scripts/`, `warm.yml`, and dynamic imports before declaring death).
- Output files: `docs/roadmap/audit-r11-backend.md` / `docs/roadmap/audit-r11-frontend.md`. Format: `SEV (P0-P3) | file:line | finding | evidence | proposed fix`.

## Backend brief — data layer, warmers, API (`src/lib/**`, `scripts/**`, `src/app/api/**`)

1. **Failure paths:** every `catch` that swallows silently (grep `catch` without log/rethrow/fallback-comment); readers that can THROW instead of degrading (the outage contract: readers never throw); unhandled promise rejections in warmers (`Promise.all` without per-item guards); missing `--max-old-space` risks on big feeds.
2. **Dead code sweep:** exports never imported (`tsc`-assisted or grep per export); known suspects to confirm/kill: **`src/lib/rarible/*`** (deprecated 6/30 — is anything but Beezie-holders still importing it?), **`warm-primary-revenue.ts` EVM legs** (flagged near-retirable), legacy `.cache/` disk-reader paths post-Postgres migration, `courtyardPrimaryCache` vs the Dune path, unused Dune query IDs, `gachaLiveCache`/Ably listener (still running? still consumed?), any snapshot KEYS written but never read (list writers vs readers).
3. **Consistency traps:** `as any` / `@ts-expect-error` inventory; unstable_cache calls whose KEY doesn't include all inputs; cache tags never revalidated; duplicated constants (chain maps, platform lists) that drifted from `sources.ts`.
4. **Scripts hygiene:** package.json scripts vs `warm.yml` vs reality — anything registered nowhere, or in warm.yml but deleted; `check-freshness` sources list vs actual writers (untracked-forever entries).
5. **API routes:** the dormant `/api/v1` — confirm 401 path leaks nothing (timing/error detail), quota code has no unbounded memory map; `/api/img` proxy allowlist actually enforced (SSRF check); cron routes' CRON_SECRET compare is constant-time-ish and never logged.
6. **Env handling:** every `process.env.*` — behavior when missing (throw vs silent), and `.env.example` completeness.

## Frontend brief — components + pages (`src/components/**`, `src/app/**` minus /api)

1. **Dead components/props:** never-rendered components (known suspects: **`MarketStatCards.tsx`** — declared dead 6/25; check `IPTables.tsx` vs `IPTable.tsx` and `PlatformTables.tsx` vs `PlatformTable.tsx` duplicate-file pairs); exported-but-unused props; unused glossary entries; orphaned CSS classes in globals.css (`.ght-*` if the ticker was rebuilt).
2. **Render bugs:** unguarded `NaN`/`undefined` reaching JSX (grep `.toFixed(`, division, `formatCompactUsd` call sites without finite-guards); `Date.now()`/`new Date()` in render bodies (hydration mismatch risk — one was module-scoped deliberately, find stragglers); missing `key` on mapped lists; conditional hooks.
3. **Known tolerated debt to formalize:** `IPActivityChart`'s two set-state-in-effect lint errors (on HEAD, tolerated) — document the fix path; any other eslint-disable inventory.
4. **State/interaction:** watchlist localStorage guards (SSR access, JSON parse failure, quota-full); search debounce/race (fast typing → stale results overwrite); chart crosshair listeners cleaned up on unmount; Metrics-popover focus trap/escape.
5. **Failure states:** every page under EMPTY data (the outage proved most degrade — sweep for the stragglers that render `$0.00`/`NaN` instead of "—"); image error → fallback loops (onError setting same src); `/api/img` 4xx path in CardImage.
6. **Perf smells:** client components that could be server (grep `"use client"` and justify each); heavy recomputation in render (sorts/reduces without memo on big tables); bundle: any accidental full-lib imports.
7. **A11y quick pass:** icon-only buttons without labels, chart `role="img"` coverage, focus visibility on the yellow CTAs.

## After both land
I merge the two findings files, dedupe, rank (P0 = user-visible wrongness or crash-able path; P1 = silent failure/debt with teeth; P2 = dead code; P3 = polish), and cut the fix round with the usual verify-then-push loop.
