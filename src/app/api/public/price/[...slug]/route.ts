/**
 * GET /api/public/price/<slug>            — the reference price, no key needed
 * GET /api/public/price/<slug>/badge.svg  — the same figure as an embeddable SVG
 *
 * THE KEY-FREE DOOR. `/api/v1/price` is the same payload for partners who can
 * carry a key; this one exists because the surfaces that most need the price
 * cannot: a chip on someone else's listing page, an `<img>` badge in a venue's
 * card view. So it is open, CDN-cached for 30 minutes, CORS-open, and
 * IP-rate-limited exactly like the internal chart endpoints — narrow by design
 * (one identity per request, no enumeration, no bulk; anything wider needs a
 * key), with the attribution riding in the payload.
 *
 * ⚠️ BOTH LIVE IN ONE ROUTE FILE BECAUSE NEXT WILL NOT ROUTE A STATIC SEGMENT
 * AFTER A CATCH-ALL. `[...slug]` must be the last segment, so `badge.svg` cannot
 * be its own folder underneath; it arrives as the last slug segment and is
 * split off here. One resolution path for both, which is also why the badge can
 * never disagree with the JSON.
 *
 * ⚠️ AN UNKNOWN SLUG 404s — ESPECIALLY THE BADGE. An embed that rendered a blank
 * or zero badge for a slug we do not know would be a number a venue could show
 * on a card we have never priced. A 404 leaves the venue's broken-image state,
 * which is the honest one.
 */
import { getReferencePrice } from "@/lib/data/referencePrice";
import { v1Error, publicOk, guardPublicRequest, PUBLIC_CDN_HEADERS } from "@/lib/api/v1";
import { renderPriceBadge, BADGE_SIZES, type BadgeSize } from "@/lib/api/badge";

export const dynamic = "force-dynamic";

const BADGE_SEGMENT = "badge.svg";

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  const rl = await guardPublicRequest(req);
  if (!rl.ok) return v1Error(429, rl.error);

  const { slug } = await ctx.params;
  const segs = slug ?? [];
  const wantsBadge = segs[segs.length - 1] === BADGE_SEGMENT;
  const path = (wantsBadge ? segs.slice(0, -1) : segs).join("/");
  if (!path) return v1Error(400, "slug required: <ip>/<set>/<number>/<name>/<grade>");

  const price = await getReferencePrice(path);

  if (!wantsBadge) {
    if (!price) return v1Error(404, "no identity at this slug");
    return publicOk(price);
  }

  const raw = new URL(req.url).searchParams.get("size") ?? "md";
  const size = (BADGE_SIZES as readonly string[]).includes(raw) ? (raw as BadgeSize) : null;
  if (!size) return v1Error(400, `size must be ${BADGE_SIZES.join(" | ")}`);
  if (!price) return new Response("no identity at this slug", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" } });

  return new Response(renderPriceBadge(price, size), {
    headers: {
      ...PUBLIC_CDN_HEADERS,
      "content-type": "image/svg+xml; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
