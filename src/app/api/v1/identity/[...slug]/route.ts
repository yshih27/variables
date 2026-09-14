/**
 * GET /api/v1/identity/<ip>/<set>/<number>/<name>/<grade>[/<edition>][/<lang>]
 *
 * One card identity across every venue and every token — the identity page's
 * own reader (`getIdentityDetail`), under the keyed, attributed v1 envelope.
 * The path IS the identity slug (src/lib/card/identity.ts is the one SSOT for
 * its form); a malformed or unknown slug is a 404, never a 500.
 *
 * `monthly` is the index's own per-identity median (monthlyIdentityPrices):
 * months with fewer than MIN_SALES_PER_IDENTITY sales are absent, never
 * interpolated. `floor.coverage` says which venues' listings are complete.
 * `fragments` lists other raw identity keys that resolve to this slug (the same
 * card keyed twice by set-string variants); their tokens are in `tokens`, their
 * sales are not in `sales`/`monthly`.
 *
 * Auth: Authorization: Bearer <key> (or ?api_key=). Attribution required — see meta.terms.
 */
import { getIdentityDetail } from "@/lib/data/identityDetail";
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

  const detail = await getIdentityDetail(path);
  if (!detail) return v1Error(404, "no identity at this slug");

  return v1Ok(detail, auth);
}
