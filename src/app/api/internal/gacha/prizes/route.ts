/**
 * GET /api/internal/gacha/prizes[?venue=<key>] — the /gacha finder's prizes,
 * loaded on demand instead of riding in the page's payload.
 *
 * INTERNAL (same-origin, unauthed), like the chart and tape routes: it serves
 * the public prize index the warmers already publish. The prizes left the
 * payload because they were most of it (1.70 MB of 2.18 MB on Oct 7) and put
 * the cached payload over Next's 2 MB `unstable_cache` limit; they are cached
 * per venue (`getGachaPrizes`), and the CDN holds each answer for an hour, the
 * cadence of the warmers behind it.
 *
 * `venue` is optional: one venue's prizes, or every venue's, value-desc. An
 * unknown venue is an empty list, not an error.
 */
import { getGachaPrizes } from "@/lib/data/fetchGacha";
import { v1OkInternal, v1Error } from "@/lib/api/v1";
import { guardChartRequest } from "@/lib/api/chartSeries";

export const dynamic = "force-dynamic";

const PRIZES_CDN_HEADERS = {
  "cache-control": "public, s-maxage=3600, stale-while-revalidate=21600",
  vary: "Accept-Encoding",
} as const;

export async function GET(req: Request) {
  const rl = await guardChartRequest(req);
  if (!rl.ok) return v1Error(429, rl.error);
  const raw = new URL(req.url).searchParams.get("venue");
  const venue = raw && /^[a-z-]{1,32}$/.test(raw) ? raw : null;
  if (raw && !venue) return v1Error(400, "venue must be a venue key");
  const prizes = await getGachaPrizes(venue);
  return v1OkInternal({ venue, count: prizes.length, prizes }, { ...PRIZES_CDN_HEADERS });
}
