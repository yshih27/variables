import type { ReferencePrice } from "@/lib/data/referencePrice";

/**
 * A watched identity as the watchlist prints it — the vault's line: name, grade,
 * the reference price with its month and n, the floor only when the page's
 * rule would headline it, and the last sale. Nothing here is computed; it is
 * `getReferencePrice`'s payload (`priceFieldsOf`, the function behind every
 * vault line and `/api/public/price/<slug>`) cut to what a row shows.
 */
export type WatchedIdentityLine = {
  /** The slug as starred. */
  slug: string;
  /** The card's one URL — what the row links to. */
  canonicalSlug: string;
  name: string;
  grade: string;
  setName: string | null;
  number: string | null;
  price: ReferencePrice["price"];
  /** Present only when plausible under the page's rule; an unverified ask is kept as its own field. */
  floor: { priceUsd: number; venue: string } | null;
  unverifiedAsk: { priceUsd: number; venue: string } | null;
  lastSale: { ts: string; priceUsd: number; venue: string } | null;
};

export function toWatchedLine(slug: string, p: ReferencePrice): WatchedIdentityLine {
  return {
    slug,
    canonicalSlug: p.canonicalSlug,
    name: p.name,
    grade: p.grade,
    setName: p.setName,
    number: p.number,
    price: p.price,
    floor: p.floor?.plausible ? { priceUsd: p.floor.priceUsd, venue: p.floor.venue } : null,
    unverifiedAsk: p.floor && !p.floor.plausible ? { priceUsd: p.floor.priceUsd, venue: p.floor.venue } : null,
    lastSale: p.lastSale ? { ts: p.lastSale.ts, priceUsd: p.lastSale.priceUsd, venue: p.lastSale.venue } : null,
  };
}

/** How many starred identities one request prices. A watchlist is a person's, not a crawl. */
export const WATCHLIST_IDENTITY_MAX = 60;
