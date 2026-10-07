# Executor WP — every venue's gacha compared, and Renaiss as complete as Collector Crypt: frontend

Frontend executor, Varible. TWO PRs, each pushed and opened against main, NO merging:
- **PR A `feat/gacha-relaunch`:** fresh off `origin/main`.
- **PR B `feat/platform-every-venue`:** stacked with `--base feat/renaiss-platform` until the backend's PR A merges; say so in the body.

Ground rules: own worktree with the three symlinks; `--webpack`; `NEXT_PUBLIC_SHELL_V2=true`; tsc, eslint and build clean; a truthful trailer. Both PRs build against `brief-backend-gacha-renaiss.md` (the payload fields named there). Render a field that isn't there yet as its honest empty state, never a mock.

Why: the owner wants these two surfaces to be the best on the site.
- `/gacha` is the comparison nobody else publishes: every venue's packs, machines, claws and boxes, side by side, and what is inside each.
- `/platform/renaiss` should read like `/platform/collector-crypt`.

The bar is the site's: every figure with its basis and its n. Disclosures are receipt lines, never banners. Nothing typed into copy. "Tokenized collectibles", never "trading cards".

## What exists (measured by the orchestrator Oct 7 on a local `next dev` of origin/main with the flag on)
- **The page.**
  - `src/app/gacha/page.tsx` (81 lines) runs: the NavBar ticker → h1 → `GachaHitsTicker` → `GachaPackMatrix` → a "How we measure" link.
  - `GachaPackMatrix.tsx` (2,137 lines, one client file) holds the matrix (game tab × price), the compare tray and overlay, the pack drawer, the prize finder and the prize modal.
  - Flag off, `/gacha` shows "Gacha analytics — coming soon". The flag (`src/lib/flags.ts`) also gates NavBar, RailNav, BottomTabs, CommandPalette, the homepage "Gacha rips" link, CC machine names, `not-found`, the sitemap and the tape's pull lines.
- **Defects to fix in PR A:**
  - **Sideways scroll.** At 1440 px the page scrolls sideways: `document.documentElement.scrollWidth` is 1,760. The game tabs sit at x 1369–1702, so Pokémon is half visible and One Piece, Sports and Mixed are off-screen.
  - **The h1** reads "Find your best gacha crack." It's slang, and it calls Beezie's machine gacha.
  - **The matrix knows three venues** (`GachaPackMatrix.tsx:47`, label ternaries near `:547`, `:604`, `:1188`).
  - **Beezie is called a pack:** "Compare packs across platforms" (`:262`), "Pack price" (`:894`), "Pack's top hit" (`:964`).
  - **Lint:** `page.tsx:46` has the `react-hooks/purity` `Date.now()` error.
  - **Frozen ages:** "Xm ago" labels freeze under the 1-hour page cache.
  - **Mislabelled ticker:** "Biggest Hit 7d" mixes hits up to two weeks old. The backend fixes the data; render what it sends.
  - **Wrong headline:** "Best Typical Return 2.01×" is a sampling artifact (backend PR B, item 1). Never show a figure the payload withholds.
- **The Renaiss page** (`src/app/platform/[key]/page.tsx`) renders 3 of CC's 11 sections. The backend's PR A fills Recent Sales, Top Cards and By IP through the existing components. Two things need you:
  - `PlatformMachines` renders only for `collector-crypt` (`page.tsx:465`, and the component's own guard).
  - There is no biggest-pulls section for any venue.
  - Also, the KPI rail printed "$0.00 · −47.7%" and "0 · +40.0%" (a live 24 h level beside a complete-day delta).

## PR A — `feat/gacha-relaunch`
1. **Layout.**
   - No horizontal page scroll at any width from 360 to 1920. Measure `scrollWidth` at 360, 768, 1280, 1440 and 1920, and paste the five numbers.
   - The game tabs sit inside the matrix frame. The matrix scrolls inside its own frame with the right-edge fade the June build had.
   - Mobile: one hand. The matrix becomes a list grouped by game then price, each row a pack, with the drawer as a sheet.
2. **The page in today's system.**
   - Bring it onto the current shell and tokens: radius through the token (no bare `rounded`, `rounded-full` or `rounded-[Npx]`), prose sans with numbers mono via `.tabular`, `ReadMe` lines, `StatCard`, `ChartTooltip` (portalled) for any readout.
   - Any paired containers align top and bottom, measured to 0 px.
   - No emojis on chrome.
3. **The h1 and metadata** say what the page answers, in plain words, naming the four kinds: packs, machines, claws and boxes. Beezie's is "the Claw". No slang.
4. **Venues from data.**
   - Rows and labels come from the payload's `venues` list, never a hard-coded three.
   - Every venue row is labelled with its kind: a Beezie cell says "Claw" and a CC cell "Machine".
   - Column headers say "Price" and "Top prize", not "Pack price" and "Pack's top hit".
   - A venue with `covered: false` is listed in one coverage line under the matrix, with its reason from data ("Courtyard publishes no pack catalog" is the shape; the words come from the payload).
5. **Every number with its basis.**
   - Stated (the venue's claim), realized (measured, with n) and the venue's own value marks ("Renaiss's stated prize value", "Collector Crypt's insured value") keep the June basis dots.
   - Each dot's meaning is a tooltip plus one receipt line under the matrix.
   - A withheld figure prints "—" with its reason in the tooltip.
   - Thin realized figures (n below the floor) are grey with their n.
   - Never print a per-card pull probability. None exists.
6. **What is inside.** The prize finder stays, and every prize says which of these it is:
   - **in the pool:** advertised by the venue (Phygitals chase, Beezie grails, DYLI box contents if the backend finds a source);
   - **pulled:** a recent realized prize (CC, Renaiss, DYLI), with its pull date.

   The prize modal keeps the side-by-side of every pack that pays a card. The finder's empty state for a venue that publishes no pool says so from data.
7. **Recent hits.** The band reads `hitsAsOf` and `hitsSource`. It says "live" only when the source is the live feed, and otherwise "as of <time>". Ages are computed on the client from timestamps.
8. **The ticker.** Each figure links to what it summarises, and nothing headlines a withheld figure. If the best typical return is withheld, the ticker shows the next figure, not a dash.
9. **Fix** `page.tsx:46` (purity) without a disable comment.
10. **The flag stays as it is.** PR A ships behind `NEXT_PUBLIC_GACHA_ENABLED`. The orchestrator audits it with the flag on locally, and the owner decides the flip.

## PR B — `feat/platform-every-venue`
1. **Machines for every venue with a board.** Gate on the board existing, not on `key === "collector-crypt"`, in both places (the page and the component). Keep the RSC-payload guard: a venue without a board sends no board.
   - Partner columns render only when the board carries partner data.
   - The value-back column is labelled with the board's `valueBasis`.
   - Collector Crypt's section must render byte-identical (diff the HTML before and after).
2. **Players for Renaiss** through `PlatformPlayers`, from the `players:renaiss` snapshot. Coverage lines come from data.
3. **Biggest pulls** (new, every venue whose reader returns rows): 12 prizes by value over 30 days.
   - Each shows the card art (`CardThumb` with hover and tap preview), the card name, `GradeChip`, value, machine and pull time.
   - One receipt line names the value basis.
   - It links to `/gacha` only when the flag is on.
   - Place it after Machines. If it pairs with another section, §7 alignment applies.
4. **Tables honour their window.** Top Cards and Recent Sales read `salesWindow` and label "24h" or "7 days". The "See all" count matches the window.
5. **The KPI rail.**
   - A delta never prints beside a level of 0 or "—". A 0 level with a non-zero delta is the case that read as a contradiction.
   - The holders empty state reads its reason from `holdersReason`.
   - Market cap prints `MCAP_BASIS_LABEL` for the new `stated` basis ("platform's stated prize value") with its coverage in the foot.
6. **Listings and floor for Renaiss** show "—" with the reason from the registry leg, as one receipt line. No banner.

## Verification (both PRs, in the body)
- `next build` route table: `/gacha` stays ISR (`revalidate` 3600, not ƒ) and `/platform/[key]` keeps ● with `generateStaticParams`. Check `next start`: `s-maxage`, and a second hit is a HIT.
- Headless Chrome screenshots, plus the CDP driver (`scripts/dev/cdp-eval.mjs`): `/gacha` at 1440 and 375, the drawer open, the compare tray with three venues, the finder filtered to one venue, the prize modal with two packs, and `/platform/renaiss` and `/platform/collector-crypt` at 1440.
- Real clicks through `CLICK_SEL`, not synthetic events, for the tabs, drawer, tray and modal. MOBILE=1 for the sheet.
- The five `scrollWidth` numbers.
- Grep the rendered HTML for `gacha` in any Beezie-facing string, and for a dropped space after an inline closing tag (the SWC trap).

## Constraints
- Copy: the page's own words only (h1, metadata, empty states, receipt lines). Every figure comes from the payload with its window.
- Wording: "the Claw" for Beezie. Packs for Renaiss and Phygitals, machines for CC, boxes for DYLI.
- Data: no new data fetching in components. Everything comes through `getGachaPayload` and `fetchPlatform`.
- Production: you ship code. The orchestrator runs the live checks, and the owner flips the flag.
