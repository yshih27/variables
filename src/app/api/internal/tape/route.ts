/**
 * GET /api/internal/tape — the realized-events feed.
 *
 * INTERNAL (same-origin, unauthed), like the chart routes: it serves the same
 * public market data the page already server-renders, and the server render is
 * the PRIMARY consumer. This route is the refresh path — what the tape polls to
 * pick up new events without a navigation.
 *
 * 60-second CDN cache: the tape's whole point is recency, so a 30-minute edge
 * cache (what the chart JSON takes) would make it a stale ticker. 60s is short
 * enough to feel live and long enough that a busy page does not re-derive the
 * feed per viewer; `stale-while-revalidate` means the visitor after expiry still
 * gets an instant answer.
 */
import { getTape } from "@/lib/data/tape";
import { v1OkInternal, v1Error } from "@/lib/api/v1";
import { guardChartRequest } from "@/lib/api/chartSeries";

export const dynamic = "force-dynamic";

const TAPE_CDN_HEADERS = {
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
  vary: "Accept-Encoding",
} as const;

export async function GET(req: Request) {
  const rl = await guardChartRequest(req);
  if (!rl.ok) return v1Error(429, rl.error);

  const url = new URL(req.url);
  const raw = Number(url.searchParams.get("limit"));
  // Clamped, not validated-and-rejected: a bad `limit` on a feed is not worth a
  // 400, and an unbounded one is worth refusing.
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 100) : 40;

  const items = await getTape(limit);
  return v1OkInternal(items, { ...TAPE_CDN_HEADERS });
}
