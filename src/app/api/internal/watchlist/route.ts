/**
 * GET /api/internal/watchlist?s=<slug>&s=<slug>… — the starred identities,
 * priced as lines.
 *
 * INTERNAL (same-origin, unauthed), like the chart and tape routes. The stars
 * live in the reader's localStorage, so the /watchlist page can only ask for
 * their prices from the browser; this answers with one line per slug from
 * `getReferencePrice` — the vault's read (`priceFieldsOf`), the figure
 * `/api/public/price/<slug>` prints — in ONE request, because the public door
 * is one identity per request by design and a watchlist of thirty would spend
 * its rate limit in a page view.
 *
 * Bounded: at most WATCHLIST_IDENTITY_MAX distinct slugs; an unknown slug comes
 * back in `missing` (the row says so) rather than failing the batch.
 */
import { getReferencePrice } from "@/lib/data/referencePrice";
import { v1OkInternal, v1Error } from "@/lib/api/v1";
import { guardChartRequest } from "@/lib/api/chartSeries";
import { toWatchedLine, WATCHLIST_IDENTITY_MAX, type WatchedIdentityLine } from "@/lib/watch/identityLine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const rl = await guardChartRequest(req);
  if (!rl.ok) return v1Error(429, rl.error);

  const slugs = [...new Set(new URL(req.url).searchParams.getAll("s").map((s) => s.trim()).filter(Boolean))];
  if (slugs.length > WATCHLIST_IDENTITY_MAX) return v1Error(400, `at most ${WATCHLIST_IDENTITY_MAX} identities per request`);

  const priced = await Promise.all(slugs.map(async (slug) => [slug, await getReferencePrice(slug).catch(() => null)] as const));
  const lines: WatchedIdentityLine[] = [];
  const missing: string[] = [];
  for (const [slug, p] of priced) {
    if (p) lines.push(toWatchedLine(slug, p));
    else missing.push(slug);
  }
  // Private: the set of slugs is one person's watchlist, so no shared cache.
  return v1OkInternal({ lines, missing }, { "cache-control": "private, max-age=300" });
}
