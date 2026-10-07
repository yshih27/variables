# Renaiss: what we need from them, what we build with it, what we offer

*Sep 9, 2026. Prepared for the Renaiss conversation. Sources: index.renaissos.com (methodology, api-docs, partners), api.renaissos.com/v1 reference, press on the YZi Labs round. renaiss.xyz itself is firewalled from this machine; verify anything marketplace-specific on the call.*

## Who they are, in our terms
One company, two products. **Renaiss** (renaiss.xyz) is a tokenized-card venue on BNB Chain with vaulted physical cards, on-chain provenance and provably random pulls; that makes it a sixth platform for our board, and the first on BNB. **Renaiss Index** (index.renaissos.com) is a separate price product: Pokémon, One Piece and Sports indices built from **physical PSA 10 sales** (TCGplayer, partner shops, Renaiss-owned trades), top 50 most-traded cards over 30 days, dollar-volume weighted capped at 10%, base 10,000 on 1 July 2023, monthly banded rebalancing with a divisor, refreshed daily over a rolling 7-day window. It is an index of physical comps, not of tokenized resales. That difference is the product opportunity, not a conflict.

## Lane A: Renaiss the venue (so it appears on the platforms board with the same honesty as the other five)
Everything we show for a venue comes from five legs. For each, what we need and the exact form:
1. **Marketplace resales.** Either a sales endpoint (token id, price in a stated currency, buyer, seller, timestamp, transaction hash, marketplace fee) with full history from launch and a webhook or cursor for new sales, or the on-chain details so we index it ourselves: card NFT contract addresses, marketplace contract address, payment token, event signatures, and a note on any off-chain settlement. Without one of these the venue shows "—" for resale, as Phygitals does today.
2. **Pulls.** A pulls feed (pull id, pack or machine id, price paid, prize token id, prize value if they state one, buyer, timestamp) plus the stated odds per pack. Their pulls are provably random on-chain, so the odds source may be the chain itself; we need to know where. This is the gacha spine and the realized-versus-stated odds chart we run for Collector Crypt and Phygitals.
3. **Payout wallets.** The addresses their gacha pays out from. This is the single input that moves a venue from "no payout source" to counted on the economics page. It is also the ask that has stalled with every other venue, so it is worth stating plainly why: outbound is counted under a rule (R3) that only credits payouts to wallets that spent into the gacha, so sharing the wallet does not expose partner or vendor flows.
4. **Listings and floors.** An active-listings endpoint (token id, ask price, timestamp) or the marketplace contract's listing events. This is what market cap is built from.
5. **Card metadata per token.** Set, card number, name, grade, grader, cert number, year, language, image. Cert number matters twice: it resolves identity for our index and it keys their own `/graded/{cert}` endpoint.

Plus, for any of the above: a partner API key (the public tier is 10 requests a day per IP, which cannot run a venue), documented rate limits, a status page or webhook for outages, and the terms under which we may display the data with attribution.

## Lane B: Renaiss Index on Varible
*The index API partnership is applied for separately by the product owner through their partner program; it is not part of the data ask to their team. What follows is what we build once the key exists, so the ask stays focused on the venue.*

What we would integrate, in order of value, and what it needs:
1. **Index series as a benchmark family.** `GET /v1/indices/{game}/series` for `pokemon`, `one-piece`, `sports`: daily value, turnover, count, rebalance markers. We add them beside BTC, ETH, S&P and NASDAQ in the Index Studio and on /stats, labelled "Renaiss Index (physical PSA 10)". Needs: partner key, the full series since the 2023 base, confirmation that daily refresh locks at 00:00 UTC, and their attribution format ("Renaiss Index" plus a link to the source page, per their docs).
2. **The spread chart.** Our monthly resale comparables index against their physical index for Pokémon: tokenized minus physical, month by month. Nobody publishes this. It answers whether tokenized cards trade at a premium or discount to the physical market, and it is the chart both companies would want cited. Needs nothing beyond item 1 and a shared understanding that the two series measure different things, which the caption states.
3. **Card-page comps.** `GET /v1/items/{game}/{set}/{item}/overview`, `/series`, `/fmv-series`, `/trades` give a physical fair-market value and sales history per card. We already show CardOS comps beside our realized figures; Renaiss becomes a second comp source, labelled as a modeled physical FMV, never as an offer (their own terms). Needs: partner key and the daily quota (10,000 a day covers our resale panel of about 1,000 cards a week with room to spare).
4. **Cert lookups.** `GET /v1/graded/{cert}` returns the card and grade for a slab. Our metadata carries cert numbers for many cards. This fixes identity for the cards our extractors cannot name and gives a per-slab comp. Needs: the same key and a batch endpoint if one exists (`/graded?certs=` takes up to 50).

## What we offer
- Their venue on the platforms board, the economics coverage matrix and the report, under the same rules as the other five, with the honesty notes that make the numbers citable.
- "Renaiss Index" attribution with a link on every surface that shows their series, and an embed of their index on /stats through our export layer.
- The spread chart co-branded, with both methodologies linked.
- Traffic to their card pages from our card pages (their partner program counts attribution clicks).
- A named contact for data issues on both sides and a shared status expectation.

## Questions for the call
1. Is the venue's marketplace settlement on-chain on BNB, or custodial like rip.fun's? This decides whether resale volume is derivable at all.
2. Which pulls data exists off-chain that the chain does not carry (price paid, pack id), and can we have it as a feed?
3. Will they share the gacha payout wallets under the R3 explanation above?
4. Partner key scope and quota for the venue data.
5. Does the index API include the constituent list and weights per rebalance, so we can show what the physical index holds?
6. Do they want their index shown against ours, given the two measure different markets? Our position: yes, labelled.

## Message draft (no dashes, one ask per paragraph)

> Thanks for the time. Varible tracks the tokenized card market across five venues today: prices, volume, holders and gacha economics, all from on-chain data and platform feeds, with every number carrying its window and source. We would like Renaiss to be the sixth venue and the first on BNB Chain.
>
> To show Renaiss the way we show the others we need five things: a resale feed or the contract addresses and events so we can index sales ourselves, a pulls feed with the stated odds per pack, the gacha payout wallets, an active-listings source, and per-token card metadata including cert numbers. A partner API key with documented limits covers all of it. Payout wallets only ever feed a rule that credits payouts to wallets that spent into the gacha, so partner and vendor flows stay out of it.
>
> If that sounds right, the next step on our side is a partner key and a short data check on a sample. We can have the venue live on the board within two weeks of the feeds arriving.
