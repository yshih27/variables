/**
 * THE REFERENCE PRICE — one card, one price, one receipt, in one payload.
 *
 * This is the shape behind `/api/v1/price/<slug>` (keyed) and
 * `/api/public/price/<slug>` (key-free, CDN-cached, CORS-open), and behind the
 * badge. All three read `getIdentityDetail` and NOTHING ELSE — no new query, no
 * second estimator, no second floor rule — so a venue embedding the badge, a
 * partner calling the API and the identity page itself can only ever print the
 * same number.
 *
 * ⚠️ THE PRICE IS THE INDEX'S OWN MONTHLY MEDIAN, LATEST COMPLETE MONTH. Not an
 * average of recent sales, not the last sale, not a listing. `monthlyIdentityPrices`
 * is the function; a month with fewer than MIN_SALES_PER_IDENTITY sales is
 * ABSENT, never interpolated — so `price: null` on a real card is the normal,
 * honest answer and every consumer has to handle it. The running month is never
 * the price (it is not finished).
 *
 * ⚠️ AN ASK IS NOT A FLOOR UNLESS IT IS PLAUSIBLE. `floor` carries the identity
 * page's own rule (identityView.ts `readFloor`): an ask headlines only when it
 * sits within 0.5x–3x of a reference (the monthly price, else the last sale).
 * The unplausible ask is still returned — it is a real live listing and hiding
 * it would be its own dishonesty — but `plausible: false` says so, and NOTHING
 * that renders a price (the badge here, the chip on the frontend) may headline
 * one. Measured: a $1.84 aggregator placeholder against a $53 card.
 *
 * ⚠️ `canonical` IS ABOUT THE URL, NOT THE DATA. A v4.1 slug still resolves (the
 * slug index keeps the old forms it cannot 301), and it gets the SAME payload
 * with `canonical: false` and `canonicalSlug` naming the card's one URL.
 */
import { getIdentityDetail, type IdentityMonthly, type IdentitySale, type IdentityFloor } from "./identityDetail";
import { parseIdentityKey } from "./traits";
import { identitySlug, identityHref } from "@/lib/card/identity";
import { identityName, readFloor, latestCompleteMonthly } from "@/lib/card/identityView";
import { MIN_SALES_PER_IDENTITY } from "./identityIndex";
import { cardHref } from "@/lib/card/ids";
import { SITE_ORIGIN } from "@/lib/site";

/** The identity keying these prices were built under. */
export const PRICE_METHOD = "v4.2" as const;

/** How many realised sales ride along as the receipt. */
export const RECEIPT_SALES = 10;

export type PriceSaleRef = {
  ts: string;
  priceUsd: number;
  /** Platform key — "collector-crypt", "beezie", "courtyard". */
  venue: string;
  /** `/card/<cardId>` — the token that sold. */
  cardId: string;
};

export type ReferencePrice = {
  /** The slug as asked for (may be a v4.1 form). */
  slug: string;
  /** True when `slug` IS the card's canonical URL. */
  canonical: boolean;
  canonicalSlug: string;
  name: string;
  ip: string;
  ipName: string;
  /** Canonical set key, or null when the card carries no placeable set. */
  set: string | null;
  setName: string | null;
  number: string | null;
  grade: string;
  edition: string | null;
  language: string | null;
  /** The latest COMPLETE month's identity price. Null when no month clears the
   *  two-sale floor — the honest answer, not a zero. */
  price: { month: string; priceUsd: number; n: number; thin: boolean } | null;
  lastSale: PriceSaleRef | null;
  /** The lowest live ask, with whether the page's rule would headline it. */
  floor: { priceUsd: number; venue: string; plausible: boolean; reference: "monthly" | "last sale" | null } | null;
  /** The last realised sales, newest first — what the price is built from. */
  receipts: PriceSaleRef[];
  /** Slabs of this identity across every venue — what the badge falls back to
   *  when the card has no sale at all ("no sale yet · 14 slabs"). */
  slabs: number;
  method: typeof PRICE_METHOD;
  asOf: string;
  attribution: { text: string; url: string };
};

const saleRef = (s: { ts: string; priceUsd: number; platform: string; tokenId: string }): PriceSaleRef => ({
  ts: s.ts,
  priceUsd: s.priceUsd,
  venue: s.platform,
  cardId: cardHref(s.platform as Parameters<typeof cardHref>[0], s.tokenId).replace(/^\/card\//, ""),
});

/**
 * The three priced fields — `price`, `lastSale`, `floor` — from an identity's
 * monthly series, sales and floor. ONE function behind the reference price
 * and every vault line, so a holding is valued at exactly what
 * `/api/public/price/<slug>` prints, to the cent.
 */
export function priceFieldsOf(v: {
  monthly: IdentityMonthly[];
  sales: IdentitySale[];
  floor: IdentityFloor;
}): Pick<ReferencePrice, "price" | "lastSale" | "floor"> & { sorted: IdentitySale[] } {
  const monthly = latestCompleteMonthly(v.monthly);
  const sorted = [...v.sales].sort((a, b) => b.ts.localeCompare(a.ts));
  const last = sorted[0] ?? null;
  const floorRead = readFloor(v.floor, last?.priceUsd ?? null);
  return {
    price: monthly
      ? {
          month: monthly.ts.slice(0, 7),
          priceUsd: monthly.value,
          n: monthly.n,
          // A price built from exactly the minimum number of sales is a price,
          // and it is the thinnest one we publish. Saying so is the difference
          // between a figure and a figure with its own error bar.
          thin: monthly.n <= MIN_SALES_PER_IDENTITY,
        }
      : null,
    lastSale: last ? saleRef(last) : null,
    floor:
      v.floor && floorRead
        ? {
            priceUsd: v.floor.priceUsd,
            venue: v.floor.platform,
            plausible: floorRead.headline,
            reference: floorRead.reference,
          }
        : null,
    sorted,
  };
}

/**
 * The payload for one identity slug, or null when the slug names no identity.
 *
 * Adds no read of its own: `getIdentityDetail` is the cached reader every
 * identity surface already goes through (30-minute `unstable_cache`, over the
 * snapshot-backed panel), so a price call costs what a page view costs.
 */
export async function getReferencePrice(rawSlug: string): Promise<ReferencePrice | null> {
  const detail = await getIdentityDetail(rawSlug);
  if (!detail) return null;

  // The card's own URL, from the key the page was built on — one builder, so
  // this cannot disagree with the URL the palette and the index emit.
  const pk = parseIdentityKey(detail.key);
  const canonicalSlug = (pk ? identitySlug(pk.ip, pk.parts) : null) ?? detail.slug;

  const { price, lastSale, floor, sorted: sales } = priceFieldsOf(detail);

  return {
    slug: detail.slug,
    canonical: detail.slug === canonicalSlug,
    canonicalSlug,
    name: identityName(detail.parts),
    ip: detail.parts.ip,
    ipName: detail.parts.ipName,
    set: detail.parts.setKey,
    setName: detail.parts.setName,
    number: detail.parts.number,
    grade: detail.parts.grade,
    edition: detail.parts.edition,
    language: detail.parts.language,
    price,
    lastSale,
    floor,
    receipts: sales.slice(0, RECEIPT_SALES).map(saleRef),
    slabs: detail.tokens.length,
    method: PRICE_METHOD,
    asOf: detail.generatedAt,
    attribution: { text: "Varible price", url: `${SITE_ORIGIN}${identityHref(canonicalSlug)}` },
  };
}
