/**
 * GET /api/v1/character/<ip>/<key> — one character across every set, grade
 * and venue: `/ip/<ip>/characters/<key>`'s own reader (`getCharacterDetail`)
 * under the keyed, attributed v1 envelope.
 *
 * `index` is the identity-comparables index (the v4 estimator) on the panel
 * filtered to the character's identities, monthly grain, published only when
 * ≥ `indexGate.needed` identities are priced in the latest complete month —
 * otherwise null with `indexGate` saying why. `top` is EVERY identity under
 * the character with its monthly price (`monthlyIdentityPrices`, latest
 * complete month, null below MIN_SALES_PER_IDENTITY). `byVenue[].coverage`
 * says whose listings are complete. An unknown character is a 404, never a 500.
 *
 * Auth: Authorization: Bearer <key> (or ?api_key=). Attribution required — see meta.terms.
 */
import { getCharacterDetail } from "@/lib/data/characterRollups";
import { hasCharacterExtractor, CHARACTER_IPS } from "@/lib/card/character";
import { requireApiKey } from "@/lib/api/auth";
import { v1Ok, v1Error, v1Options } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

export const OPTIONS = v1Options;

export async function GET(req: Request, ctx: { params: Promise<{ ip: string; key: string }> }) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return v1Error(auth.status, auth.error);

  const { ip, key } = await ctx.params;
  if (!hasCharacterExtractor(ip)) return v1Error(404, `no characters for this ip (extractors: ${CHARACTER_IPS.join(", ")})`);
  if (!key) return v1Error(400, "key required: /api/v1/character/<ip>/<key>");

  const detail = await getCharacterDetail(ip, key);
  if (!detail) return v1Error(404, "no character at this key");

  return v1Ok(detail, auth);
}
