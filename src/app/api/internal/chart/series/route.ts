/**
 * GET /api/internal/chart/series — INTERNAL (same-origin, unauthed) twin of
 * /api/v1/series for the live chart. IP-rate-limited + cached; not CORS-open.
 *
 * Params: entity (MetricEntityType), key?, metric (allowlist), from, freq, rebase.
 * With `key` → { …, points }. Omit `key` → the whole leaderboard: readMetricSeriesBulk
 * returns only POPULATED keys (and we further drop any that are empty after
 * windowing) — this is how the chart's metric/entity picker filters to non-empty
 * series at runtime. `data.series` = { "<entity_key>": [{ ts, value }] }.
 *
 * Composite keys: set="{ip}:{set}", grade="{ip}:{grade}", platform_ip="{platform}:{ip}".
 */
import {
  readMetricSeries,
  readMetricSeriesBulk,
  type MetricEntityType,
  type SeriesPoint,
} from "@/lib/data/metricSnapshots";
import { rateLimitByIp } from "@/lib/api/auth";
import { v1OkInternal, v1Error, pickParam } from "@/lib/api/v1";
import { ENTITIES, METRIC_UNIT, METRICS, shapeSeries, cachedChart, CHART_RATE } from "@/lib/api/chartSeries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const rl = await rateLimitByIp(req, CHART_RATE);
  if (!rl.ok) return v1Error(429, rl.error);

  const url = new URL(req.url);
  const entity = pickParam(url, "entity", ENTITIES, "market" as MetricEntityType);
  const freq = pickParam(url, "freq", ["daily", "weekly"] as const, "daily");
  if (!entity) return v1Error(400, `entity must be one of: ${ENTITIES.join(" | ")}`);
  if (!freq) return v1Error(400, "freq must be daily | weekly");

  const metric = url.searchParams.get("metric") ?? "volume_usd";
  if (!METRICS.includes(metric)) return v1Error(400, `metric must be one of: ${METRICS.join(", ")}`);
  const unit = METRIC_UNIT[metric];

  const from = url.searchParams.get("from") ?? "2000-01-01";
  if (!Number.isFinite(Date.parse(from))) return v1Error(400, "from must be an ISO date");
  const fromMs = Date.parse(from);
  const rebase = ["1", "true", "yes"].includes((url.searchParams.get("rebase") ?? "").toLowerCase());

  const shape = (raw: SeriesPoint[]) => shapeSeries(raw, { fromMs, fromIso: from, freq, rebase, metric });
  const common = { entity, metric, unit, from, freq, ...(rebase ? { rebasedTo: 100 } : {}) };

  const key = url.searchParams.get("key");
  if (key) {
    const raw = await cachedChart(["series", entity, key, metric], () => readMetricSeries(entity, key, metric));
    return v1OkInternal({ ...common, key, points: shape(raw) });
  }

  // No key → the whole leaderboard. Cache the raw bulk as a plain object (a Map
  // doesn't JSON-serialize through unstable_cache), then shape + drop empties.
  const bulkObj = await cachedChart(["series-bulk", entity, metric], async () =>
    Object.fromEntries(await readMetricSeriesBulk(entity, metric)),
  );
  const series: Record<string, SeriesPoint[]> = {};
  for (const [k, raw] of Object.entries(bulkObj as Record<string, SeriesPoint[]>)) {
    const shaped = shape(raw);
    if (shaped.length) series[k] = shaped; // populated-in-window keys only
  }
  return v1OkInternal({ ...common, series });
}
