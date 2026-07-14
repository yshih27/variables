/**
 * GET /api/v1/series — raw metric-spine series on demand (the interactive chart's
 * data source). /api/v1/index + /api/v1/benchmarks serve the rebased index +
 * benchmark series; this serves the underlying RAW spine metrics for any entity.
 *
 * Query params:
 *   entity   market | platform | ip | card | set | grade | platform_ip | benchmark
 *            (default market) — a MetricEntityType.
 *   key      entity key. Omit to get the WHOLE leaderboard for (entity, metric)
 *            via readMetricSeriesBulk → a `series` map keyed by entity_key.
 *            Composite-key entities:
 *              • set          → "{ip}:{setName}"   (e.g. "pokemon:Obsidian Flames")
 *              • grade        → "{ip}:{gradeLabel}" (e.g. "pokemon:PSA 10")
 *              • platform_ip  → "{platform}:{ip}"  (e.g. "collector-crypt:pokemon")
 *   metric   volume_usd | gacha_volume_usd | trades | active_wallets | cards_traded
 *            | cards | mcap_usd | floor_usd | holders   (default volume_usd)
 *   from     ISO date — lower-bound the series (inclusive). Takes precedence over `window`.
 *   window   7d | 14d | 30d | 90d | 180d | 6m | 365d | 1y | all   (default all)
 *   freq     daily | weekly (default daily). weekly resamples per ISO week (Mon):
 *            SUM for flow metrics, LAST for stock metrics (mcap/floor/holders).
 *   rebase   true → rebase to 100 at the window start.  Default false = raw values.
 *
 * Returns { entity, key?, metric, unit, from, freq, rebasedTo?, points | series }.
 * Auth: Authorization: Bearer <key> (or ?api_key=). Attribution required — see meta.terms.
 * The internal, unauthed, same-origin twin is /api/internal/chart/series.
 */
import {
  readMetricSeries,
  readMetricSeriesBulk,
  type MetricEntityType,
  type SeriesPoint,
} from "@/lib/data/metricSnapshots";
import { requireApiKey } from "@/lib/api/auth";
import { v1Ok, v1Error, v1Options, pickParam } from "@/lib/api/v1";
import { ENTITIES, METRIC_UNIT, METRICS, shapeSeries } from "@/lib/api/chartSeries";

export const dynamic = "force-dynamic";

export const OPTIONS = v1Options;

const DAY = 86_400_000;

/** window → lookback days (null = all history). Public-only convenience param. */
const WINDOW_DAYS: Record<string, number | null> = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "90d": 90,
  "180d": 180,
  "6m": 180,
  "365d": 365,
  "1y": 365,
  all: null,
};

export async function GET(req: Request) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return v1Error(auth.status, auth.error);

  const url = new URL(req.url);
  const entity = pickParam(url, "entity", ENTITIES, "market" as MetricEntityType);
  const freq = pickParam(url, "freq", ["daily", "weekly"] as const, "daily");
  const windowKey = pickParam(url, "window", Object.keys(WINDOW_DAYS) as string[], "all");
  if (!entity) return v1Error(400, `entity must be one of: ${ENTITIES.join(" | ")}`);
  if (!freq) return v1Error(400, "freq must be daily | weekly");
  if (!windowKey) return v1Error(400, `window must be one of: ${Object.keys(WINDOW_DAYS).join(" | ")}`);

  const metric = url.searchParams.get("metric") ?? "volume_usd";
  if (!METRICS.includes(metric)) {
    return v1Error(400, `metric must be one of: ${METRICS.join(", ")}`);
  }
  const unit = METRIC_UNIT[metric];

  // Resolve the window start: explicit `from` wins; else derive from `window`; else all.
  const fromParam = url.searchParams.get("from");
  let fromIso: string;
  if (fromParam) {
    if (!Number.isFinite(Date.parse(fromParam))) return v1Error(400, "from must be an ISO date");
    fromIso = fromParam;
  } else {
    const days = WINDOW_DAYS[windowKey];
    fromIso = days == null ? "2000-01-01" : new Date(Date.now() - days * DAY).toISOString();
  }
  const fromMs = Date.parse(fromIso);
  const rebase = ["1", "true", "yes"].includes((url.searchParams.get("rebase") ?? "").toLowerCase());

  const shape = (raw: SeriesPoint[]) => shapeSeries(raw, { fromMs, fromIso, freq, rebase, metric });
  const common = { entity, metric, unit, from: fromIso, freq, ...(rebase ? { rebasedTo: 100 } : {}) };

  const key = url.searchParams.get("key");
  if (key) {
    const points = shape(await readMetricSeries(entity, key, metric));
    return v1Ok({ ...common, key, points }, auth);
  }

  // No key → the whole leaderboard for (entity, metric).
  const bulk = await readMetricSeriesBulk(entity, metric);
  const series: Record<string, SeriesPoint[]> = {};
  for (const [k, raw] of bulk) series[k] = shape(raw);
  return v1Ok({ ...common, series }, auth);
}
