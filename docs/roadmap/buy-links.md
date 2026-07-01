# Buy-links (#3) + "CC traits failed" fix

_Pre-tester round. Build buy-links, fix the CC-traits label, then the orchestrator re-verifies and opens the PR → Vercel preview._

## Why "CC traits failed" shows (diagnosed 7/1)

The card page renders an inline **freshness chip for the card's trait data source** — `CardDetailView.tsx` maps `collector-crypt → "cc-traits"` (`FRESHNESS_SOURCE`), then displays that source's `source_freshness` state. It reads **"failed"** because the **`cc-traits` warmer is currently in a failed state** — the weekly ~122K-asset Helius trait crawl (a 120-min job) most likely timed out / was cancelled (the known heavy-job fragility). **The card itself renders fine** — its data comes from the `cards` table, not the trait warmer. So this is a status label leaking, not broken card data.

**Two-part fix:**
- **Frontend — remove the inline source-freshness chip from the card page.** It leaks a scary "failed" to end users and contradicts the established rule that **freshness lives on `/status`, not inline**. The card content is unaffected. _File: `CardDetailView.tsx` (the `freshnessSource` chip)._
- **Backend — fix why `cc-traits` fails.** The weekly 122K-asset Helius crawl is erroring/timing out. Confirm the `warm-cc-traits` Actions run + the `source_freshness` row; raise the timeout, batch the crawl, or lower cadence so trait data stays fresh. Not user-facing once the chip is gone, but worth keeping green. _Check `source_freshness` for `cc-traits` + the Actions log._

## Buy-links — B2 (backend) + F5 (frontend)

Contract (already in `mvp-overview.md`):
```ts
type BuyLink = { platform: string; label: string; url: string; isRarible: boolean };
buyLinks(card: { platform: string; chain: string; contract: string; tokenId: string }): BuyLink[];
```

### B2 — resolver (backend)
New `src/lib/links/buyLinks.ts`. Return an **ordered** list — **Rarible first when `isRarible`**, then the native platform. Inputs: per-card `{platform, chain, contract, tokenId}` from `cards.ts` + contract addresses in `sources.ts`.
- **URL templates — VERIFY each against the live site** (you have the platform integrations):
  - **Rarible:** `rarible.com/token/{contract}:{tokenId}` (EVM) / `rarible.com/token/solana/{mint}` (Solana).
  - **Beezie** (Base): item page on beezie.com.
  - **Collector Crypt** (Solana): marketplace item page on collectorcrypt.com for the mint.
  - **Courtyard** (Polygon): item page on courtyard.io.
  - **Phygitals** (Solana): item page on phygitals.com.
- **`isRarible`:** true for chains/collections Rarible indexes — Beezie/Base and Courtyard/Polygon are confirmed on Rarible; for CC/Phygitals (Solana) verify the collection is listed, else `isRarible:false` for v1. No per-card live Rarible lookup in v1 (by-chain heuristic).
- **Acceptance:** `buyLinks(card)` returns ≥1 link for any card across all 4 platforms; Rarible first when available.

### F5 — BuyLinks component (frontend)
New `src/components/BuyLinks.tsx`, consumed by `CardDetailView.tsx`. Render ordered pills: **Rarible first, in brand yellow**; native platform + others neutral. **Place it prominently — near the price/grade block, ABOVE the "Card analytics · SOON" section** (buy-links are the page's primary CTA, not a footnote). Open in a new tab.
- **Acceptance:** any card page shows working outbound buy links; Rarible yellow + first when present. (Replaces today's lone Solscan "View on-chain" as the primary action — keep Solscan as a secondary/utility link.)

## Sequencing
B2 and F5 can run in parallel (F5 hides the block until `buyLinks()` returns data). Fold the CC-traits chip removal into the same frontend pass. When all three land, ping the orchestrator to re-verify and open the PR → preview.
