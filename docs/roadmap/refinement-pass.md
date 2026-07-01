# Refinement pass — layout & credibility

_Reviewed live 7/1 (all five pages + the new modules). The dashboard reads "spread out" for three reasons: **redundant market-summary bands**, the **same tables duplicated across pages**, and a **flat hierarchy** where nothing is "the" number. The deep-dive pages (`SliceView`) are the model; the work is on the homepage and `/ips`._

## Principles (apply on every page)

1. **One hero number per page** — bigger, yellow; everything else is supporting and smaller. Today every module is an equal-weight dark card, so the eye never lands.
2. **Each ranked table has ONE canonical home.** The homepage *teases* (top 3–5 + "see all →"); `/ips` and `/platforms` own the full tables. Right now the homepage ≈ `/ips` + `/platforms` concatenated.
3. **Hide empty/placeholder modules until data lands** — no rows of `—` on a hero module (see the Relative-strength block).
4. **Landing pages borrow the deep-dive's discipline** — one clear summary + one scannable stack, not a pile of cards.

---

## F-R1 — Homepage (priority) — collapse 4 stat bands into 1

**Now:** ticker → hero → `MarketScorecard` → two KPI cards (mcap / volume) → four-stat row → `HotIPsPanel` + `TopSalesPanel` → full `IPTable` → full `PlatformTable`. The market numbers appear ~4× before any content.

**Target:** hero → **one MarketHeader** → `TopSalesPanel` → IP teaser → Platform teaser.

- **Merge** `MarketScorecard` + the two KPI cards + the four-stat row (`MarketKpiGrid`) into a single **MarketHeader**: one hero number (index *or* mcap — pick one), the change row, the volume/gacha breakdown bar, and a slim mcap / holders / trades strip. **Kill the top ticker** (it's the 4th copy) or slim it to non-duplicated live items only.
- **Resolve the `+9.2%` vs `−8.0%` adjacency.** The index (`+9.2% since May 14`) sits next to mcap (`−8.0%`) — a green and a red headline for "the market," touching. Put them in one consistent frame with explicit window labels, or it reads as a bug.
- **Cut `HotIPsPanel`** — it's the top-3 of the `IPTable` right beneath it.
- **Demote `IPTable` + `PlatformTable` to teasers** — top 5 / top 4 + "see all →". Add a `limit`/`teaser` prop; the full tables live on `/ips` and `/platforms`.
- **Hide the Relative-strength block** (all `—`) until benchmarks populate (Backend **B-fix-1**). When live it belongs *inside* the MarketHeader, not as a separate empty column.

**Files:** `src/app/page.tsx`, `src/components/MarketScorecard.tsx` (→ MarketHeader), `MarketKpiGrid` (fold in / retire), `HotIPsPanel` (remove from homepage), `IPTable` / `PlatformTable` (add teaser mode + "see all" link).

---

## F-R2 — Category landing `/ips` (priority) — three market-cap charts → one

**Now:** statbar → category stacked-area trend → breakdown table → rebased-by-IP index → treemap → full `IPTable`. Five modules for two ideas (composition + performance), plus the same table as the homepage.

**Target:** statbar → **rebased performance index (hero)** → treemap (composition) → `IPTable` (detail).

- **Promote** the rebased "Market cap (rebased) by IP" chart to directly under the statbar — it's the page's differentiator and the closest thing to the thesis, but today it's buried in the middle. _(It's correctly labeled "market size, not price · benchmarks soon" — keep that.)_
- **Cut two of the three composition views:** drop the stacked-area `CategoryTrendChart` and the standalone `CategoryBreakdown` table; keep `CategoryTreemap` (snapshot) + `IPTable` (detail).
- **Remove the duplicate `IPTable` from the homepage** (per F-R1) — canonical home is here.

**Files:** `src/app/ips/page.tsx`, `CategoryTrendChart` (remove/repurpose), `CategoryBreakdown` (remove), `CategoryTreemap` (keep), the rebased-index component (promote).

---

## F-R3 — Platforms landing `/platforms` (light) — already close

Structure is good (`statbar → "Marketplace by platform" trend → PlatformTable`).
- This is the **canonical home** for the platform table (homepage only teases).
- The **chain facet (F4)** lands here as tabs on the table when B4 ships.
- Plain-language the `HHI 0.50 / Concentration High` label for a beginner audience.

---

## F-R4 — IP deep-dive `/ip/[key]` (minor) — the model page, leave it

`SliceView` is done-quality: sticky rail + one scannable stack. Only:
- **Guard the rebased-chart inception dip** on the frontend (clamp / drop the leading point) so the line doesn't crater to ~0 at the start — the real fix is Backend **B-fix-2**.
- Keep the "market size, not price" label.

---

## F-R5 — Platform deep-dive `/platform/[key]` (minor)

- **Hide `Holders 0`** — render `—` when the count is 0/unknown (real fix Backend **B-fix-3**).
- **Add a primary-vs-secondary label** in the rail so `Primary 24h $4.01M` towering over `24h Volume $42.0K` doesn't read as an inconsistency.

---

## Sequencing

The deep dives are done — leave them. ~80% of the "spread out" feeling collapses with **F-R1 (homepage → one MarketHeader + teasers)** and **F-R2 (`/ips` → promote the index, cut two composition views)**. Do those two first; F-R3/4/5 are quick cleanups.

---

## Backend — data fixes this pass depends on (relay to the backend agent)

- **B-fix-1 (gating):** confirm the post-merge cron populated benchmarks — FRED `SP500` + `NASDAQCOM` and BTC/ETH. The homepage Relative-strength block stays hidden until this lands. **This is the highest-value item — it's the payoff of the whole index feature** (right now every "vs BTC / S&P" reads `—`).
- **B-fix-2:** the rebased index **dips to ~0 at inception (~May 14)** on every rebased chart (IP-vs-market, OP-vs-Pokémon). Investigate a bad/zero `mcap_usd` point at series start; trim the index to the first clean observation (or winsorize/drop leading bad points), and **re-validate the "+9.2% since May 14" figure** — confirm May 14 is real history, not a default/seed artifact.
- **B-fix-3:** Collector Crypt shows **`Holders 0`** in the rail — the holder warmer isn't populating CC (check Helius DAS / freshness).

_Frontend can mask the symptoms of B-fix-2/3 (clamp the chart, render `—`), but the root fixes are backend._
