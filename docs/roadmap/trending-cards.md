# Trending cards (#1) — build brief

_The user's original #1 priority, finally building. A card-level discovery surface ranking what's HOT by **trade velocity**, with the "trades < hunters" scarcity signal. Reuses the buy-links resolver + card page (both shipped)._

Contract (already in `mvp-overview.md`):
```ts
type TrendingCard = {
  cardId; href; name; ip; set; grade; platform;
  trades; tradesPrev; momentum;      // momentum = trades − tradesPrev
  activeListings; huntPressure;      // huntPressure = trades / max(activeListings, 1)
  topPriceUsd; buyLinks;
};
getTrendingCards(opts: { window: "24h" | "7d"; limit: number }): Promise<TrendingCard[]>;
```

## B3 — `getTrendingCards` (backend)
**File:** `src/lib/data/fetchTrending.ts`.
- Read `entity_type:"card"` `trades` + `volume_usd` + `active_wallets` from the spine for the window.
- Join the `cards` table (name / ip / set / grade / platform / image) and the `listings` snapshot for **`activeListings`** (float).
- Compute `momentum = trades − tradesPrev` (window vs prior window) and **`huntPressure = trades / max(activeListings, 1)`** — the scarcity signal (lots of trades, thin float = hard to get, hot).
- Attach `buyLinks(card)` (B2, done).
- Return top-N sorted by `huntPressure` by default; also allow sort by `momentum`.
- **Acceptance:** ranked list, each row carries an `/card/[id]` href; sortable.

## F6 — Trending panel (frontend)
**File:** `src/components/TrendingCards.tsx`, mounted on the homepage near `TopSalesPanel` (a real slot — it's the discovery hook the homepage is missing).
- Columns: **Card · Trades (24h/7d) · Δ momentum · Float · Hunt pressure · Top price**. Rows link to the card page.
- Default sort = **hunt pressure** (the "everyone wants it, few for sale" cards — the literal "trades < hunters" idea).
- Homepage panel first; a `/trending` see-all page can follow.
- **Acceptance:** homepage shows a live trending-cards panel; a row click → card page.

## Design note — build it slice-aware
Trending is really "rank cards by velocity **within a slice**." Build the global version now, but shape `getTrendingCards` to optionally accept a slice filter later — so once the slice engine lands, "trending in THIS slice" (Pokémon trending, Solana trending, PSA-10 trending) becomes a free panel on every slice.
