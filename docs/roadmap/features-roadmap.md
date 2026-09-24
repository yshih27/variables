# Varible feature roadmap

*Maintained by the orchestrator. Features, not tickets. Dates are stages, not promises: everything ships when it passes audit against the world-class bar. Last revised Sep 24, 2026.*

## Shipped since Sep 9
- **Your vault, valued (bet 2)**: `/vault` and `/vault/<address>`; a Solana, Polygon or Base address in, every tracked slab priced by the identity page's own rule (`valueIdentities`, shared with the page, parity 25/25) with the basis and the n behind every total; ownership confirmed on chain (`ownerOf` via Multicall3; an index only proposes candidates, after Rarible's Base index measured 1/65 recall); partial reads say why; CSV; keyed `/api/v1/vault/<address>`. Paste only; wallet adapters later; Courtyard slabs listed unpriced until bet 5.
- **The methodology page's Sources**: what actually reads each venue, leg by leg, keyed on the platform registry so the copy cannot drift from the code silently; the pull ladder read from the registry; the render-date footer gone.
- **The reference price (bet 1)**: v4.2 identity re-key on canonical set and normalised number (fragments 1,174 → 23, 0 false merges in the 198 reviewed); receipts under every published index point at `/index/<entity>/<month>`; the method ledger on `/methodology`, rendered from data; `/api/v1/price/<slug>`, the key-free `/api/public/price/<slug>`, the badge and the chip at `/embed/price/<slug>` with "Get the chip" on every identity page.
- **A name is never a grade**: 587 grade-named identities recovered to real names (One Piece, sports), a key guard so it cannot recur, 563 alias URLs kept.
- **The Varible Index, monthly**: v4.1 (interpolated weighted median, thin months flagged, no step rests on one identity). September publishes Oct 1.
- **The shell, live**: rail with live sparks, tape, `⌘K` search, flyouts; nav r4 where rows are links and headings are headings; breadcrumbs everywhere.
- **Identity pages** (`/i/<slug>`): every card at every grade with its realized sales, monthly price, floor rule, grade ladder and slabs. 55K identities; the palette's Cards group; token pages hand up.
- **Character pages** (`/ip/<ip>/characters/<key>`): 1,144 characters across Pokémon and One Piece from a lexicon extractor; leaderboards, by-set, where it trades, slab art. The character index waits on depth: none clears the 20-identity floor yet, and the page says so.
- **Card art you can read**: one thumbnail component, trimmed slabs, a preview on hover and tap on every row; hero art on subject pages.
- **Categories page**: lime treemap and share-mode composition under one brush, controls pinned to the title line.
- **Machines table folds**; partner labels Solflare, ComicBook, One Arena.
- **Plumbing that keeps the honesty gates honest**: a scanned quiet day is written as zero, not a gap; the buyback query in two tiers (datapoints down 68%); Courtyard secondary on Rarible's activity index, measured identical to the Dune rows it replaced; no duplicate secondary executions; the Dune credit projection printed in every run.

## Now (in flight)
| Feature | What the reader gets | Status |
|---|---|---|
| Beezie partner API | Complete listings and floors, true holders, claw odds | agreed on the Sep 10 call; feeds pending |
| Renaiss venue and Renaiss Index | A sixth platform and the first tokenized-versus-physical spread chart | partner key and feeds |
| Courtyard primary revenue | The Etherscan leg back | an API key in Actions secrets (theirs) |
| Alerts and email | The weekly report in inboxes, double opt-in; watches that write | bet 3 built and audited Sep 24 (#160, #161, #162); merge waits on the Resend sending domain and key in Vercel, because without them the double opt-in confirmation is logged, not sent |

## Next: the five bets that beat the incumbents
The giants of collectibles data (price guides, ladders, portfolio apps) scrape auction listings and ask collectors to type in what they own. Varible reads the chain. Each bet turns that into something they cannot copy quickly.

| Bet | What the reader gets | Why it wins | Depends on |
|---|---|---|---|
| 1 · The reference price | A "Varible price" per identity (monthly median, n, receipts) and the monthly index close, published with receipts; a price chip and API venues can embed on their own card pages | Realized, on-chain, cross-venue, receipted; a price guide cannot say where its number came from | **Shipped Sep 23** (#151, #152, #153); character and set depth and the partner API tier continue under bet 5 |
| 2 · Your vault, valued | Paste a wallet on Solana, Polygon or Base and see every slab priced by the same rule as its identity page: the reference price with its n, the last sale, the floor when plausible, the spread; totals by venue, IP and grade, every one with its n; CSV | Portfolio apps make people type their collection; we read it | **Shipped Sep 24** (#156, #157; briefs `brief-backend-vault.md`, `brief-frontend-vault.md`). Paste only; wallet adapters after. Courtyard slabs list unpriced until bet 5's mints-to-cards |
| 3 · Alerts that bring people back | Watchlist alerts for floor, volume, a large clear and a new listing, by email and Telegram; the weekly report in inboxes | Retention the incumbents buy with apps; ours rides the data we already have | **Built and audited Sep 24** (#160 email unparked, #161 alerts backend, #162 frontend; briefs `brief-backend-alerts.md`, `brief-frontend-alerts.md`): four signals on warmed data with baselines, one digest per reader per run, email now and Telegram behind a bot token, the star that writes, `/alerts` by tokenized link. **Merge waits on the Resend sending domain and key** (Vercel and Actions); then the migrations, one test send, and the Monday job sends itself. `API_V1_KEYS` and a Telegram token sit with the owner |
| 4 · The long tail | Sitemaps, titles that are the questions people search, structured data on 55K identity, 1,144 character, set and grade pages; the physical index beside ours where Renaiss lands | Search is where the price guides live; our answer is a realized sale with a receipt, theirs is a listing | Nothing for the SEO pass; Renaiss for the spread |
| 5 · The whole on-chain market | Beezie's true book, Courtyard's in-app marketplace through partnership, Phygitals secondary, Courtyard mints enriched to cards (per-IP), sports and comics extractors, the One Piece grade-as-name backfill; **DYLI's new reads** (`/holdings/{wallet}` for the vault, `/metadata/advanced` in batches of 50 so DYLI cards get identities, `/p2p-trades`, `/redemptions`, `/transactions` as a GMV cross-check, its named buyback wallet for the economics page); **set-name aliases for venue labels the normaliser does not know** (Beezie's "Game" is the 1999 Base Set: today its Charizard is a different identity from Collector Crypt's `base-set/4/charizard`, and files under "no set on the card"); **the sale panel at the core cadence** (identity and character pages read a once-a-day panel, so a Beezie sale takes up to a day to reach them while the tape shows it within six hours); Monster, Deadstock, rip.fun | Coverage is the moat; a venue's own dashboard shows one venue | Partner feeds, two Dune queries, extractor briefs. DYLI's API measured Sep 24: v1.1, 46 routes, the channels we classify unchanged, webhooks planned not live |

## Later (this quarter)
| Feature | What the reader gets | Depends on |
|---|---|---|
| Provenance chips | Every figure carries its source; hover any number for its receipt | design-system pass |
| Mobile density | A one-hand terminal: rail to bottom tabs, tape to marquee, installable | after bet 3 |
| Index products | A V-100 basket, grade premium indices, an embeddable ticker; weekly grain as coverage grows | bets 1 and 5 |
| Public API v2 docs | Keyed access to every series the site shows, with attribution and a free tier | after the price chip |
| The weekly thread, resumed | Monthly close, movers and receipts every Monday | the Oct 1 publish |

## Hygiene (table stakes for looking like a company)
The daily batch drifts four hours past its cron; the spender scan takes eighteen minutes; Dune credits run about $74 over this period (Sep 10 to Oct 10) even after the fixes, with four fresh executions a day left to question; the Etherscan key is missing. None is a feature; all of them show.

## How features get here
Every feature is a brief in `docs/roadmap/` (`brief-<lane>-<feature>.md`; the briefs for shipped bets stay beside the roadmap as the record of what was asked), built by an executor on a fresh branch, audited against the live preview and, for layout, a headless render, then merged on the product owner's word. Nothing skips the audit. Numbers are never typed into copy; they come from the data layer with their window and source.
