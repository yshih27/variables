# Executor WP — why our gacha and resale figures sit at 0.5–0.6× Blockworks': measure, explain, propose

Backend executor, Varible. ONE PR off `origin/main` (`feat/coverage-reconciliation`), pushed, opened against main, NO merging.

**This is a measurement PR.** It ships a report and the probe scripts behind it, and changes no published figure. Every proposed fix is a separate decision for the owner.

Ground rules:
- Own worktree with the three symlinks.
- Never write to production. Reads only; local `--out` for any blob.
- Dune: count first, and state every read's datapoints from the credit meter. The period resets Oct 10. Until then, any execution over 5,000 datapoints waits for the owner's word.
- tsc and eslint clean. A truthful trailer.

Context: `docs/roadmap/analytics-benchmark-blockworks.md` §4.

## The gap, as read on Oct 7
| Measure | Ours | Blockworks (`app.blockworks.com/analytics/tcg`) |
|---|---|---|
| Gacha spend, all venues | $194M over 30 complete days to Oct 6 | $268.9M, 30D |
| Marketplace resale, all venues | $3.19M, 30 complete days | $12.66M, 30D |
| Gacha spend, CC | $2.91M / 24h | $146M / 30D, 801K packs |
| Gacha spend, Courtyard | $1.27M / 24h | $79M / 30D, 938K packs |
| Gacha spend, Phygitals | $634K / 24h | $31.3M / 30D, 864K packs |
| Gacha spend, Beezie (the Claw) | $143K / 24h | $8.57M / 30D |
| Resale, Courtyard | Rarible activity index only | $6.4M / 30D |
| Resale, CC | — | $4.6M / 30D |
| Resale, Beezie | — | $1.18M / 30D |

Blockworks' own definitions, from its info tooltips:
- **Gacha spend** "includes credit card spending".
- **Marketplace volume** "includes secondary marketplace repurchases by team": team wallets buying off the secondary market to give sellers liquidity, not gacha buybacks.
- **Net revenue** = gross revenue − gacha buybacks, "not including COGS".
- **DAU** = unique wallets that spent on the protocol that day.

## Measure each, per venue, over the same 30 complete days
1. **Our figure, re-derived from source:** the spine's `gacha_volume_usd` and `volume_usd` sums. Confirm they match `/stats`.
2. **Collector Crypt on Robinhood.** Blockworks' DAU legend lists "Collector Crypt (Robinhood)" beside Solana. Find the deployment from public sources (CC's docs, site and announcements; the chain's explorer): contracts, gacha wallets, its start date. Measure its 30-day pack spend and pulls. Say whether Dune or a public RPC can read it, and at what cost.
3. **The credit-card rail.** For Courtyard (Blockworks: 34.3% of its spend by card), Phygitals (17.0%) and CC (1.6%), establish how a card purchase settles on-chain:
   - a processor wallet paying the venue;
   - a direct mint to the user;
   - or nothing on-chain at all.

   Measure on a sample whether our spend leg counts it. Name the processor wallets you find, with evidence.
4. **Gross against filtered.** Per venue: 30-day gross inflow into the gacha wallets our queries read, our published spend, and the difference. Break the difference down by our exclusion rules: canonical price ladder, house and rarity-bucket senders, dust. Collector Crypt's allowlist captured 96.8% of its gross inflow in August; re-measure.
5. **Resale.**
   - **Team repurchases:** for Collector Crypt and Beezie, how much 30-day secondary volume our hygiene removes, by rule (`secondaryHygiene.ts`: dupes, self-trades, ring washes, sweeps), and how much of it is team wallets buying listings. A team repurchase is a real trade with a real buyer of last resort: say whether it belongs in volume, with a separate line, rather than removing it silently.
   - **Courtyard's in-app marketplace:** whether its trades settle on Polygon in a form we can read, and if not, what reading it would need.
6. **The surface disagreement.** On Oct 7, `/platforms` printed "—" for Renaiss's 24h gacha while `/platform/renaiss` printed $43.2K. Find why, and fix it in this PR: that one is a defect, not a definition.

## Report in the PR body
- **One table per venue:** our figure, gross inflow, Blockworks' figure, and the gap explained line by line in dollars, every line with its source and its query.
- **What is unexplained,** stated as such.
- **For each cause, a proposal:**
  - read it (cost: requests or Dune datapoints per day);
  - disclose it (a receipt line saying what we don't count);
  - or leave it, with the reason.

  The owner decides which.
- Every Dune read's datapoints, and the account meter before and after.

## Constraints
- No published number changes in this PR, except the `/platforms` defect.
- No copy beyond the report.
- "Tokenized collectibles", never "trading cards". The Claw for Beezie.
- Blockworks' figures are a reference to reconcile against. Never copy them into the site.
