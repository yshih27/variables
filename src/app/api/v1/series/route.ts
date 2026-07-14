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
 *   rebase   true → rebase to 100 at the window start via rebaseSeries (daily,
 *            forward-filled, drops non-positive — intended for stock/positive
 *            metrics + index-style overlays). Default false = raw values.
 *
 * Returns { entity, key?, metric, unit, from, freq, rebasedTo?, points | series }.
 * Auth: Authorization: Bearer <key> (or ?api_key=). Attribution required — see meta.terms.
 */
import {
  readMetricSeries,
  readMetricSeriesBulk,
  type MetricEntityType,
  type SeriesPoint,
} from "@/lib/data/metricSnapshots";
import { rebaseSeries } from "@/lib/data/indices";
import { weekStartUtc } from "@/lib/data/priceIndex";
import { requireApiKey } from "@/lib/api/auth";
import { v1Ok, v1Error, v1Options, pickParam } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

export const OPTIONS = v1Options;

const DAY = 86_400_000;

// Keep in sync with MetricEntityType (the `readonly MetricEntityType[]` annotation
// makes tsc reject an INVALID member, though not a MISSING one).
const ENTITIES: readonly MetricEntityType[] = [
  "market",
  "platform",
  "ip",
  "card",
  "set",
  "grade",
  "platform_ip",
  "benchmark",
];

/** Allowlisted spine metrics → display unit. */
const METRIC_UNIT: Record<string, "usd" | "count"> = {
  volume_usd: "usd",
  gacha_volume_usd: "usd",
  trades: "count",
  active_wallets: "count",
  cards_traded: "count",
  cards: "count",
  mcap_usd: "usd",
  floor_usd: "usd",
  holders: "count",
};
const METRICS = Object.keys(METRIC_UNIT);
// FLOW = additive per day (sum over a week); the rest are STOCK (last-in-week).
const FLOW_METRICS = new Set([
  "volume_usd",
  "gacha_volume_usd",
  "trades",
  "active_wallets",
  "cards_traded",
  "cards",
]);

/** window → lookback days (null = all history). */
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

/** Resample a daily series to ISO-weekly (Monday-keyed). */
function resampleWeekly(points: SeriesPoint[], agg: "sum" | "last"): SeriesPoint[] {
  const byWeek = new Map<string, { sum: number; last: number; lastTs: string }>();
  for (const p of points) {
    const t = Date.parse(p.ts);
    if (!Number.isFinite(t) || !Number.isFinite(p.value)) continue;
    const wk = weekStartUtc(t);
    const cur = byWeek.get(wk);
    if (!cur) byWeek.set(wk, { sum: p.value, last: p.value, lastTs: p.ts });
    else {
      cur.sum += p.value;
      if (p.ts >= cur.lastTs) {
        cur.last = p.value;
        cur.lastTs = p.ts;
      }
    }
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([wk, v]) => ({ ts: wk, value: agg === "sum" ? v.sum : v.last }));
}

/** window → freq → optional rebase. Pure; `fromMs`/`fromIso` already resolved. */
function shapeSeries(
  raw: SeriesPoint[],
  opts: { fromMs: number; fromIso: string; freq: "daily" | "weekly"; rebase: boolean; metric: string },
): SeriesPoint[] {
  if (opts.rebase) {
    // rebaseSeries windows to `from` itself, forward-fills daily, drops ≤0, =100 at start.
    let pts: SeriesPoint[] = rebaseSeries(raw, opts.fromIso, 100).map((p) => ({ ts: p.ts, value: p.value }));
    // Rebased values are index levels (stock-like) → LAST-in-week when weekly.
    if (opts.freq === "weekly") pts = resampleWeekly(pts, "last");
    return pts;
  }
  const windowed = raw.filter((p) => {
    const t = Date.parse(p.ts);
    return Number.isFinite(t) && t >= opts.fromMs;
  });
  if (opts.freq === "weekly") {
    return resampleWeekly(windowed, FLOW_METRICS.has(opts.metric) ? "sum" : "last");
  }
  return windowed;
}

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
  const common = {
    entity,
    metric,
    unit,
    from: fromIso,
    freq,
    ...(rebase ? { rebasedTo: 100 } : {}),
  };

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
