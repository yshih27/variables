/**
 * GET /api/internal/search?q= — the command palette's grouped search.
 *
 * ⚠️ NO CDN CACHE, DELIBERATELY. Queries vary per keystroke, so an edge cache
 * would be almost all misses while pinning a copy of every prefix anyone has ever
 * typed. The work is cheap — a cached homepage payload, one indexed `ILIKE`, and
 * an in-memory scan of the studio seed's names — so it is cheaper to just do it.
 *
 * A too-short or empty query is `{ groups: [] }` with a 200, never a 4xx: someone
 * mid-word is the palette's most common state, and erroring there turns typing
 * into an error message.
 */
import { buildGroupedSearch } from "@/lib/data/groupedSearch";
import { v1OkInternal, v1Error } from "@/lib/api/v1";
import { guardChartRequest } from "@/lib/api/chartSeries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const rl = await guardChartRequest(req);
  if (!rl.ok) return v1Error(429, rl.error);

  const q = new URL(req.url).searchParams.get("q") ?? "";
  return v1OkInternal(await buildGroupedSearch(q), {
    "cache-control": "no-store",
  });
}
