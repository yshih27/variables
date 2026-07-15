/**
 * GET /api/internal/chart/index — INTERNAL (same-origin, unauthed) twin of
 * /api/v1/index for the live chart. No API key (the chart is a client component
 * and must not burn the public per-key daily quota); throttled per-IP + the reads
 * are cached. Same params + `data` shape as /api/v1/index. NOT CORS-open, so it
 * can't be used cross-origin to dodge the keyed public tier.
 */
import { readIndexSeries, indexStats } from "@/lib/data/indices";
import { rateLimitByIp } from "@/lib/api/auth";
import { v1OkInternal, v1Error, pickParam } from "@/lib/api/v1";
import { cachedChart, CHART_RATE } from "@/lib/api/chartSeries";
import { tickerOf, indexDisplayName } from "@/lib/indices/naming";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const rl = await rateLimitByIp(req, CHART_RATE);
  if (!rl.ok) return v1Error(429, rl.error);

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

  const points = await cachedChart(["index", entity, key, kind, from, freq], () =>
    readIndexSeries(entity, key, { kind, from, freq }),
  );
  const stats =
    kind === "price"
      ? await cachedChart(["index-stats", entity, key, from], () => indexStats(entity, key, { from }))
      : null;

  return v1OkInternal({
    entity,
    key,
    ticker: tickerOf(entity, key),
    indexName: indexDisplayName(entity, key),
    kind,
    from,
    freq,
    rebasedTo: 100,
    points,
    stats,
  });
}
