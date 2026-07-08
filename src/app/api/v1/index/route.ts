/**
 * GET /api/v1/index — the rebased market/category/IP index series (B9-3).
 * Thin wrapper over readIndexSeries (+ indexStats for price indices).
 *
 * Query params:
 *   entity  market | category | ip        (default market)
 *   key     entity key                    (default total)
 *   kind    price | mcap                  (default price — constant-quality index)
 *   from    ISO date the series rebases to 100 at (default 2000-01-01 = inception)
 *   freq    daily | weekly                (mcap only; price is natively weekly)
 *
 * Auth: Authorization: Bearer <key> (or ?api_key=). Attribution required — see meta.terms.
 */
import { readIndexSeries, indexStats } from "@/lib/data/indices";
import { requireApiKey } from "@/lib/api/auth";
import { v1Ok, v1Error, v1Options, pickParam } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

export const OPTIONS = v1Options;

export async function GET(req: Request) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return v1Error(auth.status, auth.error);

  const url = new URL(req.url);
  const entity = pickParam(url, "entity", ["market", "category", "ip"] as const, "market");
  const kind = pickParam(url, "kind", ["price", "mcap"] as const, "price");
  const freq = pickParam(url, "freq", ["daily", "weekly"] as const, "daily");
  if (!entity) return v1Error(400, "entity must be market | category | ip");
  if (!kind) return v1Error(400, "kind must be price | mcap");
  if (!freq) return v1Error(400, "freq must be daily | weekly");
  const key = url.searchParams.get("key") ?? "total";
  const from = url.searchParams.get("from") ?? "2000-01-01";
  if (!Number.isFinite(Date.parse(from))) return v1Error(400, "from must be an ISO date");

  const points = await readIndexSeries(entity, key, { kind, from, freq });
  // Scorecard stats only exist for the constant-quality price index.
  const stats = kind === "price" ? await indexStats(entity, key, { from }) : null;

  return v1Ok({ entity, key, kind, from, freq, rebasedTo: 100, points, stats }, auth);
}
