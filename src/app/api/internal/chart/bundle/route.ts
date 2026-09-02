/**
 * GET /api/internal/chart/bundle — the WHOLE studio catalog in one response.
 *
 * ⚠️ THIS ENDPOINT EXISTS TO DELETE A FAN-OUT. The studio used to build its
 * catalog from ~30 same-origin requests at mount — one index probe per registry
 * entry (~27), the benchmark call, and eleven spine-family bulk reads, eight in
 * flight. Each paid per-request rate-limit bookkeeping and, on a cold deploy, a
 * fresh resample, for a measured ~30s to first paint. The catalog those requests
 * assemble is one deterministic object, so it is assembled once, here.
 *
 * The critical path no longer touches this at all: pages embed a precomputed seed
 * (src/lib/studio/seed.ts) and paint from it. This is the AFTER-paint upgrade that
 * fills in every series the picker can offer — and the fallback for a page served
 * without a seed.
 *
 * Built through the same `buildStudioCatalog` the warmer uses, over the same
 * readers the per-endpoint routes wrap, so it cannot disagree with either.
 */
import { buildStudioCatalog } from "@/lib/studio/catalog";
import { serverChartLoader } from "@/lib/studio/serverLoader";
import { v1OkInternal, v1Error } from "@/lib/api/v1";
import { cachedChart, guardChartRequest, CHART_CDN_HEADERS } from "@/lib/api/chartSeries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const rl = await guardChartRequest(req);
  if (!rl.ok) return v1Error(429, rl.error);

  // One cache entry, no params — the catalog is the same object for everyone. A
  // Map does not survive unstable_cache's JSON round trip, so `data` is cached as
  // a plain object and the client rebuilds the Map.
  const bundle = await cachedChart(["studio-bundle"], async () => {
    const { items, data } = await buildStudioCatalog(serverChartLoader());
    return { items, data: Object.fromEntries(data) };
  });

  return v1OkInternal(bundle, CHART_CDN_HEADERS);
}
