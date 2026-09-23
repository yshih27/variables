/**
 * GET /api/v1/price/<ip>/<set>/<number>/<name>/<grade>[/<edition>][/<lang>]
 *
 * THE REFERENCE PRICE for one card, under the keyed, attributed v1 envelope —
 * the same payload the key-free `/api/public/price/<slug>` serves, from the same
 * reader (`getIdentityDetail` → `getReferencePrice`). One price, one method,
 * two doors.
 *
 * `price` is the index's own monthly median for the latest COMPLETE month
 * (`monthlyIdentityPrices`, n ≥ MIN_SALES_PER_IDENTITY): null when no month
 * clears that floor, never interpolated and never the running month. `floor` is
 * the identity page's rule, with `plausible` saying whether the ask may be
 * headlined. `receipts` are the realised sales the price rests on.
 *
 * An unknown slug is a 404 in the envelope. A v4.1 slug resolves and comes back
 * with `canonical: false` and `canonicalSlug` naming the card's one URL.
 *
 * Auth: Authorization: Bearer <key> (or ?api_key=). Attribution required — see meta.terms.
 */
import { getReferencePrice } from "@/lib/data/referencePrice";
import { requireApiKey } from "@/lib/api/auth";
import { v1Ok, v1Error, v1Options } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

export const OPTIONS = v1Options;

export async function GET(req: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return v1Error(auth.status, auth.error);

  const { slug } = await ctx.params;
  const path = (slug ?? []).join("/");
  if (!path) return v1Error(400, "slug required: <ip>/<set>/<number>/<name>/<grade>");

  const price = await getReferencePrice(path);
  if (!price) return v1Error(404, "no identity at this slug");

  return v1Ok(price, auth);
}
