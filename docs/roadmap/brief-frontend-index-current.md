# Executor WP — the Varible Index, fixed, frontend: a number that is current, and says what it rests on

Frontend executor, Varible. One PR off `origin/main` (`feat/index-current`), stacked on the backend's `fix/index-current` with `--base` if it has not merged (say so), pushed, NO merging. Own worktree with the three symlinks; `next build` + `next start` for anything cached (dev never exercises `revalidate`); NEXT_PUBLIC_SHELL_V2=true; tsc/eslint/build clean; truthful trailer. Builds against the contract in `brief-backend-index-every-venue.md` PR A: `readIndexProvisional(entity, key)` → `{ month, asOf, value, stepPct, n, lo, hi, thin, venues }` or `{ month, asOf, n, floor, reason: "below-floor" }`, and `venues` on every published point. Nothing here computes a number.

## Why
The index speaks once a month. From Sep 1 to Oct 1 the homepage showed "latest month ended Aug 31", July's step printed exactly 0.00%, and nothing on the page said the whole history rests on one venue. A terminal's flagship number must be current, and must say what it rests on.

## The surfaces
1. **The hero** (homepage V block, `/ips`, the IP and category pages that show a V): when a provisional clears the floor, it leads — `V-MKT 152.1`, a chip `October so far · provisional`, its step against the last close, and one receipt line `63 identities · closes Nov 1 · as of Oct 14 09:12 UTC`, every value from the object, the close date derived from `month`. The last close sits one line below with its month (`September close 151.2`). Below the floor, the close leads and the receipt line says why (`October so far: 12 identities, under the 20 the market needs; the close publishes Nov 1`).
2. **The strip** (`V-MKT` ticker): the same rule; the delta's window label reads `MTD` for a provisional and `1m` for a close; the tooltip carries the other.
3. **The chart** (Index Studio and every chart drawing a V): closes stay the solid line; the provisional is a dashed segment from the last close to a hollow marker, its band shaded lighter; the tooltip says provisional with `n`, `asOf` and the close date. CSV and PNG exports carry the provisional row flagged `provisional`.
4. **The sample, as a receipt line** under every V block and on each receipts page: `sample: Beezie 31 · Collector Crypt 22 identities` from `venues` (an identity on two venues is counted on both; print the backend's note when that happens). On `/methodology`, a table of venues by month rendered from the blob, so the one-venue history is stated rather than discovered.
5. **Methodology copy:** the provisional rule (a running-month step, shown when it clears the floor, never chained, replaced at the close) with the floors and the rule read from the backend's constants, never typed.

## Constraints
No typed number: every value, month, count and date from the provisional object, the blob or the constants. A receipt line, never a banner. No new colours: the dashed segment and the lighter band use the chart's existing tokens. Zero new reads beyond `readIndexProvisional` and the `venues` field. The last close is never hidden: a reader can always find the published number. Mobile: the chip and the receipt line wrap under the figure at 375; `scrollWidth === innerWidth`.

## Verification
On `next start` with `SNAPSHOT_LOCAL_DIR` pointing at an `--out` build from the backend branch: headless-Chrome screenshots at 1440 and 375 of the homepage hero (provisional above the floor, and a build forced below it), the strip, the Index Studio with the dashed segment, `/methodology`'s venue table, a receipts page with its sample line; the CDP driver reads the hero's figure, chip and receipt line and the strip's tooltip; the CSV carries the flagged row; §7 alignment of any pair you touch, measured 0 px.
