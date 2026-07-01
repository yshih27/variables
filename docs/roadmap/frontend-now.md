# Frontend — now (MVP track)

_Worker brief. Read [mvp-overview.md](./mvp-overview.md) first — especially "Shared contracts." Per [AGENTS.md](../../AGENTS.md): read the relevant guide in `node_modules/next/dist/docs/` before writing Next code._

**You are not blocked by backend.** Build chart UIs against _internal_ rebased series now; drop in the external benchmark overlay when B1 lands. Reuse existing components and respect the sans-prose / mono-numbers (`.tabular`) system.

**Context files:** [IPActivityChart.tsx](../../src/components/IPActivityChart.tsx), [CategoryTrendChart.tsx](../../src/components/CategoryTrendChart.tsx), [IPTable.tsx](../../src/components/IPTable.tsx) (faceting precedent), [PlatformTable.tsx](../../src/components/PlatformTable.tsx), [IPDominance.tsx](../../src/components/IPDominance.tsx), [IPRail.tsx](../../src/components/IPRail.tsx), [CardDetailView.tsx](../../src/components/CardDetailView.tsx).

---

## F1 — Slice template  ← foundation, do first

Extract the shared layout of [ip/[key]/page.tsx](../../src/app/ip/[key]/page.tsx) and [platform/[key]/page.tsx](../../src/app/platform/[key]/page.tsx) (rail + activity chart + dominance + by-X + top cards + recent sales) into `<SliceView slice={descriptor}>`. IP and Platform pages become thin wrappers.

- **Acceptance:** both pages render identically to today, from the shared component. Unblocks by-chain (F4).

## F2 — Market scorecard hero (homepage)  ← your chosen add-on

One-glance module at the top of [page.tsx](../../src/app/page.tsx): the **price-return** index (`kind:"price"`) value + Δ 30/90d + relative strength vs BTC/S&P, with **market size** (`kind:"mcap"`) shown as a separate, smaller stat — don't conflate them. Use `indexStats` for beta + correlation vs BTC.

- **File:** new `src/components/MarketScorecard.tsx`.
- **Interim path:** scaffold against internal data (rebased mcap as a _labeled_ placeholder); swap the headline to the price index + benchmark overlay when B1 lands — no layout change.
- **Acceptance:** renders today; the price-vs-BTC headline + beta/correlation populate when B1 lands; the size stat stays visually distinct from the price line.

## F3 — Index mode on trend charts  (#5)

Extend [CategoryTrendChart.tsx](../../src/components/CategoryTrendChart.tsx) and [IPActivityChart.tsx](../../src/components/IPActivityChart.tsx) with (a) a **rebase-to-100** toggle, (b) a benchmark-overlay series, and (c) a **confidence band** + an "insufficient data" empty state (thin IPs gate out). Default to the **price** index (`kind:"price"`, weekly); keep **market size** (`kind:"mcap"`) as a separate toggle — never on the same axis as BTC.

- **Interim path:** ship **OP vs Pokémon** now (both internal IPs, rebased). Add BTC/S&P overlay when `readBenchmarkSeries` lands.
- **Consume:** `categoryOf(ipKey)` from the SSOT (B5) instead of the interim key-map.
- **Acceptance:** category page shows a multi-IP rebased price comparison with bands; IP page shows IP vs market; thin IPs show "insufficient data," not a fake line.

## F4 — Chain faceting (platform landing)  (#4)

Add chain tabs (All / Solana / Base / Polygon) to [PlatformTable.tsx](../../src/components/PlatformTable.tsx) — mirror the All/TCG/Sports/Other faceting already shipped on [IPTable.tsx](../../src/components/IPTable.tsx). Optional `/chain/[key]` via `<SliceView>` + `getChainDetail` (B4).

- **Acceptance:** table facets by chain with rollup totals.

## F5 — Lean card page  (#3 lives here)

Build the `/card/[id]` body: image, facts (set / year / grade / chain), and `<BuyLinks>` — **Rarible rendered first and in yellow**, others neutral. Defer the "Coming Soon" charts.

- **Files:** [CardDetailView.tsx](../../src/components/CardDetailView.tsx) + new `src/components/BuyLinks.tsx` (consumes `buyLinks()` from B2).
- **Coverage:** all 4 platforms (confirm `getCardDetail` returns for each).
- **Acceptance:** any card cell → card page → working outbound links, Rarible-first.

## F6 — Trending panel (homepage)  (#1)

`TrendingCards` panel beside [HotIPsPanel.tsx](../../src/components/HotIPsPanel.tsx). Columns: card · trades (24h/7d) · Δ momentum · float · **hunt pressure**. Default sort = hunt pressure. Rows link to the lean card page (F5).

- **Wire when** `getTrendingCards` (B3) lands.

## F7 — avg-trade derive  (no backend)

In [IPDominance.tsx](../../src/components/IPDominance.tsx), compute historical `avg_trade = volume_usd ÷ trades` from the two series you already pull (guard divide-by-zero). No backend item needed.

---

## Deferred (NOT MVP)

Movers strip · Watchlist · full card-page charts / price history. Revisit post-MVP.
