import { NextResponse, type NextRequest } from "next/server";
import {
  isValidIpKey,
  isValidPlatformKey,
  isValidCardId,
  isValidIdentityPath,
  isValidCharacterPath,
  isValidReceiptPath,
} from "@/lib/data/validKeys";
import { isEmbedChartId } from "@/lib/chart/embeds";
import { canonicalIdentitySlug, IDENTITY_PATH_PREFIX } from "@/lib/card/identity";

/** `/embed/price/<slug>` — the chip's own prefix under the embed route. */
const PRICE_CHIP_SEGMENT = "price";
export const PRICE_CHIP_PREFIX = `/embed/${PRICE_CHIP_SEGMENT}`;

/**
 * Why this file exists — fixing soft 404s.
 *
 * The dynamic detail pages (`/ip/[key]`, `/platform/[key]`, `/card/[id]`,
 * `/i/[...slug]`) call
 * `notFound()` for unknown keys, but they only do so AFTER awaiting their data.
 * Because the app has a global `app/loading.tsx`, that data fetch suspends under
 * a Suspense boundary, which commits a streamed `200 OK` before `notFound()`
 * ever runs. Per Next's "The HTTP contract" (streaming docs), the status can't
 * be changed once streaming starts — so the page renders the not-found UI but
 * with a (wrong) 200 status: a soft 404, bad for SEO/crawlers.
 *
 * `proxy` runs BEFORE rendering, so it can still set a real status. For keys we
 * can cheaply prove are invalid, we rewrite to an unmatched path. Next then
 * serves its genuine 404 (the root `app/not-found.tsx`, which is synchronous and
 * therefore non-streamed → a real `404`). The user keeps the original URL and
 * sees the same on-brand not-found UI — now with the correct status.
 *
 * This leaves `loading.tsx` untouched, so valid pages keep their skeleton.
 */

// Any path with no matching route → Next renders not-found.tsx with a 404.
const NOT_FOUND_PATH = "/_not-found-fallback";

function isInvalidDetailPath(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  const [root, key] = parts;
  if (!key) return false; // bare /ip, /platform, /card — let routing decide
  switch (root) {
    case "card":
      return !isValidCardId(key);
    case "ip":
      // The key, then the character sub-tree's shape (an IP without a
      // character extractor has no /characters; a character is one segment).
      return !isValidIpKey(key) || !isValidCharacterPath(parts);
    case "platform":
      return !isValidPlatformKey(key);
    case "embed":
      // `/embed/price/<slug>` is the price chip — an identity path, not a chart
      // id, and it validates as one (five to seven well-formed segments).
      if (key === PRICE_CHIP_SEGMENT) return !isValidIdentityPath(parts.slice(2).join("/"));
      return !isEmbedChartId(key);
    case "i":
      // The whole path: an identity is five to seven segments, not one key.
      return !isValidIdentityPath(pathname);
    case "index":
      // `/index/<entity>/<month>` — the receipts page. Shape and month only;
      // whether that entity published that month needs the blob.
      return !isValidReceiptPath(parts);
    default:
      return false;
  }
}

/**
 * ONE URL PER CARD (v4.2). The re-key moved some identity URLs — a number that
 * normalises ("/025~102/" → "/25/"), and edition/language written in the other
 * order. Those old forms are still valid paths, so nothing 404s them; they are
 * simply not the card's URL any more, and a second URL for one card is what an
 * index (and bet 4's search) must never see. `canonicalIdentitySlug` is total and
 * idempotent over anything `parseIdentitySlug` accepts, so this cannot loop.
 *
 * ⚠️ 301, NOT 307/308. A permanent redirect is the one a crawler folds into the
 * target; the METHOD-preserving 308 is for form posts, and an identity page is a
 * GET. The query string is carried over so an `?utm_…` or `?ref=` on a shared
 * link survives the hop.
 *
 * ⚠️ NOT EVERY OLD FORM IS RECOVERABLE HERE. A v4.1 slug whose set segment is
 * `-` (the normaliser judged the set string junk) cannot be canonicalised from
 * the path alone — the path does not say which junk set it was. Those keep
 * working through the slug index's aliases (src/lib/card/identity.ts
 * `legacyIdentitySlug`), and the API answers them with `canonical: false`.
 */
function canonicalIdentityRedirect(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;
  // Both surfaces that carry an identity slug in their path: the page, and the
  // price chip a venue iframes. One rule, so a chip cannot sit on a URL the
  // page has already left behind.
  const prefix = pathname.startsWith(`${IDENTITY_PATH_PREFIX}/`)
    ? IDENTITY_PATH_PREFIX
    : pathname.startsWith(`${PRICE_CHIP_PREFIX}/`)
      ? PRICE_CHIP_PREFIX
      : null;
  if (!prefix) return null;
  const canonical = canonicalIdentitySlug(pathname.slice(prefix.length));
  if (!canonical) return null;
  const target = `${prefix}/${canonical}`;
  if (target === pathname) return null;
  const url = new URL(target, request.url);
  url.search = request.nextUrl.search;
  return NextResponse.redirect(url, 301);
}

export function proxy(request: NextRequest): NextResponse {
  if (isInvalidDetailPath(request.nextUrl.pathname)) {
    return NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url));
  }
  return canonicalIdentityRedirect(request) ?? NextResponse.next();
}

export const config = {
  // Only the dynamic detail routes (and their sub-pages). Note `/ip/:path+`
  // does NOT match the list pages `/ips` or `/platforms`.
  matcher: ["/ip/:path+", "/platform/:path+", "/card/:path+", "/embed/:path+", "/i/:path+", "/index/:path+"],
};
