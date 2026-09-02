# rip.fun Phase 1 — findings, and why the marketplace lane stops here

Executor report against `docs/roadmap/brief-backend-ripfun.md`. Verified 2026-09-02
against the live docs (`https://api-docs.rip.fun`, whose "Try it" panels render
real server-side responses) and Base mainnet RPC. No CardOS credits were spent —
there is no `RIP_API_KEY` yet.

## TL;DR

The brief's Phase 1 rests on one premise: that `/{game}/cards/{id}/prices`
returns **sold-listing history** we can turn into `NormalizedSale[]`. It does
not, and the docs say so in as many words. Everything downstream of that — the
marketplace lane, `volume_usd`/`trades` dailies, floor, market cap, holders —
has no source on this API. The brief's own instruction for this case is to stop
and report rather than reach for Dune, so that is what this branch does.

**Shipped:** the CardOS client (metered, paced, typed) + a bounded preflight.
**Not shipped, and why:** everything that would have put a `rip-fun` row on the
platform table. See "What is honestly absent" below.

## What CardOS actually is

`api.getcardos.com/api/v1` is rip.fun's **card-data product**, not rip.fun's
marketplace. It indexes every printing of every Pokémon / One Piece / Azuki card
it can get — 37,198 Pokémon and 5,757 One Piece cards in English, live counts —
and prices them from third-party comps (`tcgplayer_id` rides along on the row).

Searchable card fields, per `/docs/search`: `name`, `id`, `code`, `subtypes`,
`number`, `rarity`, `artist`, `raw_price`, `is_variant`/`is_holo`/`is_reverse`/
`is_first_edition`, `abilities.*`, `attacks.*`, `weaknesses.type`, `expansion.*`,
`language`, plus per-game `supertype`/`types`/`hp` and `type`/`cost`/`power`.

There is **no** ownership field, no inventory or vault flag, no token id, no
listing state, and no route anywhere on the Card Data API that returns one. A
card row is identical whether rip.fun has ten of it in the vault or has never
touched it.

## The blocker, quoted

`/docs/pricing`, under "What we don't expose":

> Pricing returns our computed numbers and aggregate bands (counts, medians,
> ranges). It does **not** return individual sold listings, marketplace-by-
> marketplace breakdowns, or per-source provenance. Those stay internal.

What `/prices` *does* return per company+grade: `value`, `low`, `high`,
`confidence`, `value_kind` (`sold` | `blended` | `feed`), `sold_count`,
`last_sold_at`, and `band {median, recent_median, p10, p90, count}`.

That is an **aggregate valuation**, and three properties make it unusable as a
volume feed even as an estimate:

1. **No per-sale rows.** No timestamps, no prices, no counterparties — so no
   `NormalizedSale[]`, and nothing for `cleanSecondarySales` to wash-filter. The
   hygiene pass every other feed goes through has no input.
2. **Not rip.fun's sales.** The comps are market-wide, sourced from third-party
   feeds. Publishing them as rip.fun platform volume would attribute the entire
   TCG secondary market to one platform — a far worse mislabeling than the
   Courtyard tokenization-as-gacha regression the lane classifier exists to
   prevent.
3. **A rolling ≤90d window, not a daily series.** `sold_count` is "recent
   (≤90d)" and `band.count` is the same window. There is no day dimension, so no
   daily spine metric can be derived — and the "Price history (coming soon)"
   endpoint (5 credits, daily time series per card) returns 404 today.

Checked and ruled out as substitutes, all on the same key:

| Surface | Why it isn't the lane |
|---|---|
| `include=prices` on card endpoints | Strictly less than `/prices` — no `band`, no `last_sold_at` |
| Vaulting API (`/vaulting-docs`) | Tenant-scoped: **our own** cards in their vault, not the market |
| Instant Pack API | Commerce — prepare/submit a purchase |
| Gacha API `/mystery/stats` | "Per-**partner** pull + buyback volume" — our volume as a seller |
| Webhooks | Price moves + new cards/sets. Change notifications, not a sale feed |

One loose thread worth a partner question: `/docs/best-practices`' cache table
lists a **"Listings — continuously for active asks; sold history is
append-only"** row, but no route in the reference exposes either. The docs' own
"Need something this endpoint doesn't return? Ask and we'll add it" is the path
to it, and a listings/sold-history route is exactly the ask that would unblock
Phase 1 as written.

## On-chain footprint — verified

Base RPC `eth_chainId` → `0x2105` (**8453, Base mainnet**), confirming the
brief's expectation. All four contracts are live ERC-1967 proxies with distinct
implementations:

| Role | Address | `name()` / `symbol()` | ERC-721 | impl |
|---|---|---|---|---|
| Pack | `0x143f4c37247F561ecEC9247602cba074230f9FA2` | `RIP.FUN Packs` / `RIPP` | yes | `0x4c3a63f3…` |
| Card | `0xF4710eE68f151B6CB0c377400738c0De9B39284f` | `RIP.FUN Cards` / `RIPC` | yes | `0xdc16b99c…` |
| Graded | `0x69F9EAB8D662b5773Bd86C0f4fD4c5f9f426C6C5` | — (no response) | — | `0x8146f1eb…` |
| Sealed | `0x60E0e44715d421E88308aF8eff014e942DC2Fd0C` | — (no response) | — | `0x2f132dbd…` |

None answers `totalSupply()`, so there is no enumerable extension: counting
tokens or holders means a `Transfer`-log scan, i.e. an indexer decision. That is
the brief's own reason for holding holders at "—" in Phase 1, and it applies to
market cap for the same reason.

## Credit budget — the arithmetic

CardOS meters **1 credit per call, flat, regardless of page size**, on a **500
credits/month** free tier; 300 req/min is the throughput ceiling but never the
binding one. Live totals (English, 2026-09-02) at the 100-row page cap:

| Game | Expansions | calls | Cards | calls |
|---|---|---|---|---|
| pokemon | 203 | 3 | 37,198 | 372 |
| onepiece | 62 | 1 | 5,757 | 58 |
| **Total** | | **4** | | **430** |

Plus sealed (3,676 + 273 → 40 calls) = **474 credits for one full English pass —
94.8% of the monthly allowance, in a single run.** `language=all` multiplies it.
And a flat walk cannot finish regardless: `page × page_size` is capped at 10,000
server-side, so any full sync must go per-expansion or cursor on the last id,
which adds a partial page per set.

This is the number that makes "catalog warmer on a 6h cadence" impossible on the
free tier under any design. Steady state is cheap (webhooks cost nothing, and an
incremental pass is a handful of calls); the **first** pass is not.

## What is honestly absent, and why nothing was wired

The brief's wiring step (PLATFORM_SOURCES → buckets → fetchPlatform →
check-freshness → warm.yml → INV-9) was **not** done. A `rip-fun` row added
today would publish:

- volume 24h/7d/30d — **absent** (no sale feed)
- trades, unique buyers/sellers — **absent** (same)
- floor, market cap — **absent** (no listings route; no enumerable supply)
- holders — **absent** (no indexer)
- gacha volume — **absent** (partner key, Phase 2)
- cards — the only number available, and it would be **wrong**: 37,198 generic
  catalog printings, not rip.fun inventory. Fed through `cards.insured_value_usd`
  it would also mint a "market cap" equal to the summed market price of every
  Pokémon card in existence.

`hasSecondarySource: false` + `unknownStats` renders the first five honestly as
"—". The sixth is the problem: the `cards` table's meaning on every other
platform is *tokens that exist on that platform* (`cc-<mint>`, `bz-<tokenId>`,
each with a holder), and CardOS card ids (`sv3pt5-6`) are catalog printings with
no on-chain identity at all. Loading them under `platform: "rip-fun"` would put
a fabricated inventory count into `cards_tracked`, IP dominance, card search and
`/card/[id]` — the exact class of fabrication the data-honesty matrix exists to
stop. So the catalog warmer was not pointed at the `cards` table, and the
platform was not registered.

That is a scope call the brief could not have anticipated, and it is flagged for
decision rather than taken unilaterally. Three coherent options:

1. **Hold.** Land the client, wire nothing, revisit when the partner key lands.
   (What this branch does.)
2. **Reference catalog, not a platform.** Store CardOS cards+prices in their own
   table as a cross-platform *price oracle* — an independent comp source for the
   cards Collector Crypt / Beezie / Phygitals / Courtyard actually tokenize.
   Genuinely valuable, and honest, but it is a different product than "6th
   platform" and needs the first-pass credit spend budgeted.
3. **Wait for the on-chain lane.** rip.fun's real market is the Base contracts
   above; an indexed `Transfer` + settlement scan is what would produce a true
   volume/holders/mcap row. That is an indexer decision, not a CardOS one.

## Phase 2 seam — and one correction to the brief

The brief states "There is no public all-pulls feed in the docs." The Gacha
OpenAPI spec (`https://api-docs.rip.fun/gacha-openapi.yaml`) shows otherwise:

- `GET /api/v1/mystery/feed/recent` — "Recent pulls (add `scope=mine` to filter
  to **this partner**)". Omitting `scope` is therefore the all-partner feed.
  Rows are unique on `(token_id, revealed_at)` and carry `tier_id` + `game`.
- `GET /api/v1/mystery/feed/winners` — top recent pulls by item value.
- `GET /api/v1/mystery/catalog` — active tiers, "price/EV/odds read live
  on-chain"; `GET /api/v1/mystery/catalog/{tier_id}/odds` — authoritative
  per-rarity-group odds + EV from on-chain weights.

That is a realized-pull feed plus *stated* odds/EV — the same pair the Phygitals
and CC gacha models are built on, and it maps onto the existing `gacha_pulls`
spine directly. It is gated on a **mystery-partner key** (403 "Insufficient
scope, or not a partner-scoped key"), which is the partner conversation the
brief already scopes to Phase 2 — but the feed exists, so that conversation is
worth more than the brief assumed. Gacha stays behind `GACHA_ENABLED` regardless.

Wire conventions to respect when it lands: money is a **string**, never a JSON
number (`_micros` = integer USDC micros as a string; `_usdc` = the decimal
string; reveal `value_usd` = a USD decimal string). Never parse any of them into
a float that gets arithmetic done on it.

## What this branch ships

- `src/lib/ripfun/client.ts` — paced (250ms; 300 req/min ceiling) node-fetch
  client with an `X-API-Key` header, and a **credit meter** that charges before
  the request goes out and throws past `RIP_CREDIT_BUDGET` (default 50). Retries
  429 (never billed upstream) and 5xx honouring `Retry-After`; treats 402
  (balance empty) and other 4xx as terminal. Surfaces the account's own
  `X-Credits-Remaining` so a log states spend instead of implying it.
- `src/lib/ripfun/catalog.ts` — typed cards / expansions / pricing, and a
  `walkCards` that asserts the 10,000-offset wall up front and returns
  `truncated` rather than letting a partial page set pass as complete. Grades
  route through `src/lib/card/grade.ts` (`parseGradeLabel`), not a new parser.
- `scripts/check-ripfun.ts` — preflight. `--plan` prints the budget arithmetic
  with **zero** calls; the live probe is 5 calls (1% of the monthly allowance),
  writes nothing, re-reads the catalog totals and flags drift against the
  baseline this budget was computed from.

## Operator actions

1. Create a CardOS key — self-serve at `https://api-docs.rip.fun/account` with
   the rip.fun login. It is shown exactly once. Put it in `.env.local` as
   `RIP_API_KEY=rip_v1_…`.
2. Run `npm run check-ripfun` and read the log into the scope decision above.
3. Only once something is actually warmed: add `RIP_API_KEY` to GitHub Actions
   secrets and Vercel env. Nothing in this branch reads it at request time, so
   it is not needed in Vercel today.
4. For Phase 2, ask rip.fun for a **mystery-partner** key (feed scope), and ask
   whether the "Listings / sold history" row in their own best-practices cache
   table can become a route.
