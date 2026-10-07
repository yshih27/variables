import type { PlatformSource } from "@/lib/data/sources";
import { PULLS_REREAD_DAYS, RENAISS_MACHINE_WINDOW_DAYS, STATED_MCAP_MIN_COVERAGE } from "@/lib/renaiss/constants";

/** The four legs every venue is read by, in the order the methodology cards print them. */
export type VenueLegs = { resale: string; listings: string; holders: string; primary: string };

/**
 * How each venue is read, leg by leg — the prose for the Sources section.
 *
 * ⚠️ KEYED ON THE REGISTRY, DELIBERATELY. Names, chains and order come from
 * PLATFORM_SOURCES; a venue added there without an entry here fails to compile,
 * so this copy cannot drift from the code silently. It did: the section kept
 * saying Courtyard was read from its own contract after #149 moved it to
 * Rarible's activity index. When a reader changes (core.ts, warm-listings,
 * warm-holders, the Dune SQL), change the leg here in the same PR.
 */
export const VENUE_LEGS: Record<PlatformSource["key"], VenueLegs> = {
  courtyard: {
    resale:
      "Rarible's activity index for the Courtyard collection, which is where the collection's on-chain trades on Polygon are indexed; read live over a rolling window and passed through the same hygiene as every feed. Courtyard's own in-app marketplace settles off-chain and is visible to no source. The Dune query this leg replaced decoded the same trades a day late; it is retired and kept for the provenance of older points.",
    listings:
      "Rarible's active sell orders for the collection, cheapest ask per token, dust excluded; capped per run, since Courtyard's book is by far the largest we read.",
    holders:
      "Not indexed. Courtyard's per-card data is not yet in our card table, so it has no holder count, no per-card identity and no market cap; each reads as withheld, never as zero.",
    primary:
      "Pack spend: USDC paid into Courtyard's receiving wallets on Polygon, read daily through Dune and published as gacha volume, with an Etherscan read of the same transfers as the fallback. Tokenization fees are paid off-chain and are not counted.",
  },
  beezie: {
    resale:
      "Beezie's own order feed, read directly from its API: each fulfilled order is a sale, and the feed reaches back months, so every window is read in full. Not read through an aggregator.",
    listings:
      "Rarible's active sell orders for the collection, cheapest ask per token. An aggregator ask can be a placeholder, so an identity page prints a Beezie ask as the floor only when it sits within a set band of that card's monthly price; otherwise it is a receipt line marked unverified, never a headline.",
    holders:
      "Ownership from Rarible's ownership index for the collection; card metadata from each token's URI on Base, persisted the first time a token is seen.",
    primary:
      "The Claw: USDC paid into the Claw contract on Base, read daily through Dune, with an Etherscan read of the same transfers as the fallback. The Claw's catalog, stated odds and prize pool come from Beezie's own endpoint and are labelled as stated by the venue, never as realized.",
  },
  "collector-crypt": {
    resale:
      "A Dune query over the Collector Crypt marketplace program: one sale per transaction that moves both an NFT and USDC, priced at the largest USDC transfer in it, over a rolling window. Bids that never settle are excluded by construction.",
    listings: "Collector Crypt's own marketplace API, cheapest ask per card.",
    holders:
      "Helius DAS over the collection: owner, traits and the Insured Value appraisal that prices its market cap.",
    primary:
      "Pack pulls: USDC paid into the gacha wallets at a price on the published pull ladder, house and rarity-bucket wallets excluded as senders, read daily through Dune. Each pull's prize comes from the gacha app's own winners feed, captured continuously. Buyback is USDC returned from those wallets to players who had spent in, under rule R3 below.",
  },
  phygitals: {
    resale:
      "No source. Its sales API carries pack pulls only, and its resale trades settle on Tensor and Magic Eden, which need a query of their own; resale figures are withheld until one exists.",
    listings:
      "Phygitals' own marketplace API, which already aggregates Tensor, Magic Eden and native asks; cheapest per card.",
    holders:
      "Helius DAS over its two compressed-NFT collections. No per-card valuation exists, so its market cap is floor times supply, at venue level only, and stays out of the cross-venue total.",
    primary:
      "Pack pulls: USDC paid into its gacha wallets, treasury excluded as a sender and dust excluded, read daily through Dune; realized pulls from its own pull feed. Buyback under rule R3, as for Collector Crypt.",
  },
  dyli: {
    resale:
      "DYLI's own public sales API, read directly. Each sale is classified by its channel, and only user-to-user resale is marketplace volume.",
    listings: "Its public listings endpoint: the floor, and a market cap of cheapest ask times units available.",
    holders: "Not counted; no ownership read is wired for its inventory contract.",
    primary:
      "From the same sales feed: mystery boxes are gacha, inventory purchases and fair-drop entries are direct sales. eBay-venue rows and zero-price box claims are excluded.",
  },
  renaiss: {
    resale:
      "Renaiss's own index API, read directly: every sale on its marketplace on BNB Chain since its first sale, with the slab's cert and the card once its index has linked them, passed through the same hygiene as every feed. A sale counts at the price the buyer paid in USDT, taken as dollars; the seller's fee is not in the feed, so volume is buyer-paid. When a day holds fewer sales than the tables need, the platform page's sales tables read the trailing seven days and say so.",
    listings:
      "No source. Renaiss's asks are signed off-chain and its API does not publish them, so the floor and listings read as withheld, never as zero.",
    holders:
      `Counted on-chain on BNB Chain: every live token of its card contract and its owner, read through Multicall3 over public endpoints. Wallets the contract itself names as Renaiss's (its owner, its treasury, and the holders of its admin, minter and burner roles) and the zero and burn addresses are not holders. A token that came through a pack or a sale and no longer exists has been burned, which most likely means redeemed for the card, and is counted as burned, not as redeemed. The market cap is the prize value Renaiss stated for each held token at its pull: the venue's own appraisal, like Collector Crypt's insured value, not a price. A held token with no stated value is a gap, never a zero, and the market cap is withheld unless stated values cover ${Math.round(STATED_MCAP_MIN_COVERAGE * 100)}% of held tokens. A card's metadata (set, number, grade, cert, language) is kept the first time the card sells, so a card seen only as a pack prize has no card page.`,
    primary:
      `Pack pulls from the same API: each checkout with its buyer, price and transaction, the machine's name, and the prize once Renaiss names it, which for its V3 packs happens when the set sells out, so the last ${PULLS_REREAD_DAYS} days are re-read on every run and a pull is written again only when it is new or has changed: its prize named, or its checkout matched. The prize value is the one Renaiss states. A draw seen on its public list but not yet matched to a checkout is kept and never counted as spend. Its pulls are kept apart from the other venues' pull records and aggregated per wallet in the database, so its player analysis is covered without adding it to the other venues' scan; its machines are read over the last ${RENAISS_MACHINE_WINDOW_DAYS} complete days, with value back and hit share measured in Renaiss's stated prize value. No payout wallet is known, so net revenue is withheld with that reason.`,
  },
};

/**
 * A leg the venue has no source for, as the registry states it ("No source. …"),
 * or null when the leg is read. The platform page prints it as its receipt line,
 * so the page and the methodology can never give two reasons for one absence.
 */
export function unsourcedLeg(key: PlatformSource["key"], leg: keyof VenueLegs): string | null {
  const text = VENUE_LEGS[key]?.[leg];
  return text && text.startsWith("No source.") ? text : null;
}
