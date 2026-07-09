/**
 * GET /api/v1/trending — trending cards by hunt pressure / momentum (B9-3).
 * Thin wrapper over getTrendingCards (already cached 30m server-side).
 *
 * Query params:
 *   window    24h | 7d                    (default 24h)
 *   limit     1..50                       (default 12)
 *   sort      huntPressure | momentum     (default huntPressure)
 *   ip        filter to one IP key        (optional, e.g. pokemon)
 *   platform  filter to one platform key  (optional, e.g. collector-crypt)
 *   grade     filter to one grade label   (optional, e.g. "PSA 10")
 *
 * Auth: Authorization: Bearer <key> (or ?api_key=). Attribution required — see meta.terms.
 */
import { getTrendingCards } from "@/lib/data/fetchTrending";
import { requireApiKey } from "@/lib/api/auth";
import { v1Ok, v1Error, v1Options, pickParam } from "@/lib/api/v1";
import { tickerOf, indexDisplayName } from "@/lib/indices/naming";

export const dynamic = "force-dynamic";

export const OPTIONS = v1Options;

export async function GET(req: Request) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return v1Error(auth.status, auth.error);

  const url = new URL(req.url);
  const window = pickParam(url, "window", ["24h", "7d"] as const, "24h");
  const sort = pickParam(url, "sort", ["huntPressure", "momentum"] as const, "huntPressure");
  if (!window) return v1Error(400, "window must be 24h | 7d");
  if (!sort) return v1Error(400, "sort must be huntPressure | momentum");
  const rawLimit = Number(url.searchParams.get("limit") ?? 12);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
    return v1Error(400, "limit must be an integer 1..50");
  }

  const ip = url.searchParams.get("ip") ?? undefined;
  const platform = url.searchParams.get("platform") ?? undefined;
  const grade = url.searchParams.get("grade") ?? undefined;
  const slice = ip || platform || grade ? { ip, platform, grade } : undefined;

  const { rows, floatAsOf } = await getTrendingCards({ window, limit: rawLimit, sort, slice });

  // When trending is scoped to an IP, name the index it sits under (V-PKM …). A
  // platform/grade-only slice references no index → null.
  const index = ip ? { ticker: tickerOf("ip", ip), indexName: indexDisplayName("ip", ip) } : null;

  return v1Ok({ window, sort, slice: slice ?? null, index, floatAsOf, cards: rows }, auth);
}
