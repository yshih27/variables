# Variable — Platform Briefing for Legal Review

_Prepared for the legal team drafting Terms of Use, disclaimers, and privacy language. Factual description of how the platform works as of July 2026. Items needing counsel's judgment are marked ⚖️; items needing product confirmation are marked [CONFIRM]._

## 1. What Variable is

Variable (currently `variable-rarible.vercel.app`, intended `variable.rarible.com`) is a **read-only market-data website** ("terminal") for tokenized physical collectibles — real graded trading cards held in professional vaults and traded as blockchain tokens. It is **a Rarible project** (stated in the site footer).

Variable is **not** a marketplace, exchange, broker, wallet, or custodian. Users cannot buy, sell, list, bid, deposit, or connect a wallet on Variable. It displays market statistics and links out to third-party marketplaces.

Core features: market-wide statistics (market cap, volume, holders); **price indices** (the "Variable Index" family, tickers V-MKT, V-PKM, etc.); comparisons against financial benchmarks (BTC, ETH, S&P 500, NASDAQ, gold); trending/recently-sold cards; per-marketplace and per-franchise analytics; gacha (pack-opening) statistics including observed odds and expected value; outbound "Buy on X" links; a weekly market report page; a read-only JSON API for partners.

## 2. Where the data comes from

| Source type | Specifics | Nature |
|---|---|---|
| **Public blockchain data** | Solana, Base, Polygon transaction data, primarily indexed via **Dune Analytics** (paid API) and **Helius** (Solana RPC/DAS, paid API) | Public on-chain records |
| **Marketplace platform APIs** | Collector Crypt (gacha + marketplace endpoints), Beezie (activity/listings endpoints), Phygitals (marketplace endpoints) | ⚖️ **Publicly reachable but largely undocumented endpoints observed from the platforms' own web apps.** We have no signed API agreements; requests are read-only, low-volume (a few times daily), and identify normally. Counsel should assess ToS/CFAA-style exposure per platform and whether to paper these with partner agreements (partnership outreach is underway independently for business reasons). |
| **Financial benchmarks** | BTC/ETH/gold prices via **CoinGecko** (free API); S&P 500 & NASDAQ via **FRED** (St. Louis Fed API, keyed); Stooq/Yahoo as fallback | ⚖️ Each has attribution/redistribution terms — FRED requires no endorsement implication; CoinGecko free tier has attribution terms; confirm our benchmark display + API redistribution complies. |
| **Card images** | Serve from the platforms'/chains' own CDNs and Arweave, **via our image proxy** (`/api/img`, host-allowlisted) | ⚖️ We re-serve third-party imagery of trademarked/copyrighted cards (see §6). |

**Not sourced from Rarible:** despite the affiliation, market data does not come from Rarible's APIs.

## 3. How numbers are computed (accuracy characteristics)

- **Methodology is published** on-site (`/methodology`) and every metric has an in-UI definition tooltip. A public **data-status page** (`/status`) shows per-feed freshness and errors in real time.
- **Indices** ("the V"): computed only from **secondary sales** (collector-to-collector resales). Weekly stratified medians within franchise × set × grade cells, trade-weighted, **wash-trade filtered**, outlier-winsorized, and **liquidity-gated** (too few clean trades → we display "insufficient data" rather than a number). Indices are **rebased values (start = 100), not prices**, and are calculated by us — they are original works, not licensed from any index provider.
- **Market cap** is an *estimate*: Collector Crypt items use the platform's own insured/appraisal values; other platforms use floor-listing × supply. Explicitly disclosed as methodology.
- **Gacha statistics**: "stated odds" are the platforms' published numbers; "observed odds"/expected value are **our statistical estimates from on-chain samples**, labeled with sample sizes. ⚖️ Gacha content is gambling-adjacent — see §7.
- **Known coverage gaps (disclosed on-site):** some platforms' secondary trading occurs on external marketplaces we don't yet index (e.g., Phygitals resales on Magic Eden/Tensor — badged "primary only"); Collector Crypt marketplace figures cover trades through its own on-chain program, not peer-to-peer sales elsewhere. Volumes are **floors, not ceilings**.
- **Freshness:** market data ~6-hourly; holders/indices/benchmarks daily; metadata weekly. Automated integrity checks (duplicate/wash/consistency invariants) gate the data pipeline.
- Despite all controls, figures can be wrong, delayed, or incomplete — disclaimer should say so plainly (current footer already carries a short version).

## 4. User data & privacy (current state)

- **No accounts, no login, no wallet connection.** Nothing to sign up for.
- **Watchlist** is stored in the browser's localStorage only — **never transmitted to or stored by us**.
- **Analytics: Vercel Web Analytics is enabled** (as of launch) — a cookieless, aggregate measurement service (page views, referrers, countries, device class, performance metrics). No cross-site tracking, no user-level profiles, no advertising identifiers. ⚖️ Privacy policy should name it in one line.
- **No other tracking SDKs** (no Google Analytics, no Meta pixel, no Sentry). **No cookies set by our code.**
- **Server logs:** standard hosting logs (Vercel) — IP addresses in transient infrastructure logs; we do not build user profiles.
- **API (not in service):** a keyed read-only JSON API exists in the codebase but is **not activated at launch** — no keys have been issued to anyone, and without a key every request is rejected. If/when partner access begins, keys will be issued under written terms and this brief updated; no consumer data is involved either way.
- **Email signup (live at launch):** users may submit an email to receive the weekly market report. We store: email address, consent timestamp, signup source, and an unsubscribe token. Used **solely** to send the weekly report; one-click unsubscribe; never sold or shared. Sending itself starts post-launch (collection first). ⚖️ Privacy policy must cover this at launch: lawful basis/consent wording, unsubscribe mechanics, retention period [product to confirm retention — proposal: delete on unsubscribe].

## 5. Charges & commercial model

- **The site is entirely free.** No payments, subscriptions, paywalls, or in-app purchases. We hold no user funds.
- **Buy-links** ("Buy on Rarible / Collector Crypt / …") are plain outbound hyperlinks to third-party marketplaces. **No affiliate/referral fees are collected — confirmed; pure redirection.** (If affiliate terms are ever introduced, the Terms will be amended with a compensation disclosure first.)
- **API:** built but **dormant at launch** (no keys issued, all requests rejected). Planned model when activated: free tier with mandatory attribution, per-key quotas; commercial licensing contemplated. Terms for it can wait until activation.
- ⚖️ Rarible-first ordering of buy-links (Rarible listed first/highlighted when the item is available there) is a design choice by a Rarible project — counsel may want a brief affiliation disclosure.

## 6. Third-party IP displayed

- **Franchise names & trademarks**: Pokémon, One Piece, Yu-Gi-Oh!, Disney Lorcana, NBA/NFL/MLB players & brands, etc. — used **nominatively** to identify the physical cards being tracked (as price guides and marketplaces do). No sponsorship or endorsement exists or is implied. ⚖️ Standard nominative-use + no-affiliation disclaimer needed.
- **Card images**: photographs/scans of trademarked, copyrighted cards, sourced from the listing platforms/chain storage and re-served through our proxy. ⚖️ Counsel to assess: display + proxy-caching posture, and a DMCA/notice-and-takedown contact.
- **Platform names/logos** (Collector Crypt, Courtyard, Beezie, Phygitals, Magic Eden, etc.): identification only; no partnership implied except where one exists.
- **Benchmark marks**: "S&P 500", "NASDAQ" are referenced as comparison data. ⚖️ Index names are trademarked (S&P Dow Jones, Nasdaq Inc.) — confirm descriptive use language.

## 7. Content areas needing specific disclaimers

1. **Not financial advice / informational only** — exists in footer; should be formalized. Indices, EV figures, and "hunt pressure"-style metrics could be read as investment signals.
2. **Not a marketplace** — all transactions occur on third-party platforms under their terms; we're not party to any transaction and don't guarantee listings, prices, or availability behind buy-links.
3. **Data accuracy** — best-efforts, estimates flagged, methodology published, corrections channel (currently routed via the methodology page), **no liability for decisions made on the data**.
4. ⚖️ **Gacha/EV content** — we display odds and expected-value math for randomized paid products. We don't operate them, but counsel should review framing (currently analytical: "find your best gacha crack" hero + EV tables) for gambling-promotion sensitivities by jurisdiction, and whether an age/jurisdiction note is warranted.
5. **Forward-looking/derived metrics** (momentum, trends) — statistical derivations, not predictions.
6. **Third-party links** — we don't control destination sites.

## 8. Where legal text would live (proposal)

- `/terms` and `/privacy` pages, linked from the site footer (footer component already exists; trivial to add).
- Whether these are **standalone Variable terms** or **Rarible's existing ToS + a Variable supplement** is the legal team's call — see questions below.
- The API's terms line (attribution requirement) already ships inside every API response; formal API terms could live at `/terms#api` or in `docs/api-v1.md`.

## Questions for the legal team / product owner

1. **Entity & governing terms**: which entity operates Variable, and do we extend **Rarible's existing Terms/Privacy Policy** with a Variable schedule, or draft standalone documents? (Site currently says "A Rarible project.")
2. **Jurisdictions of concern** for the gacha/odds content (§7.4) — any markets where displaying EV for randomized products needs gating or removal?
3. **DMCA/takedown agent**: use Rarible's existing agent/process for card-image complaints, or a Variable-specific contact?
4. **Platform-API posture** (§2): comfortable operating read-only on observed endpoints while partnerships are negotiated, or should any source be paused pending agreements?
5. **Email capture** (§4) — RESOLVED: ships at launch; privacy policy must cover it from day one. Open sub-question: retention period (proposal: delete on unsubscribe).
6. **Analytics** — RESOLVED: Vercel Web Analytics enabled (cookieless, aggregate); one privacy-policy line needed.
7. **Benchmark redistribution** (§2): the API re-serves rebased benchmark *series* (derived values, not raw quotes) — confirm this derivation posture satisfies CoinGecko/FRED terms.
