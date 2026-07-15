/**
 * Shared helpers for the raw-metric series endpoints — the public /api/v1/series
 * (keyed) and the internal /api/internal/chart/series (unauthed, same-origin,
 * cached). Both shape the same spine metrics identically; this is the one copy of
 * that logic (metric allowlist + units + window/freq/rebase shaping).
 */
import { unstable_cache } from "next/cache";
import { rebaseSeries, resampleWeekly } from "@/lib/data/indices";
import type { MetricEntityType, SeriesPoint } from "@/lib/data/metricSnapshots";

/** Every entity_type in the spine — keep in sync with MetricEntityType (the
 *  `readonly MetricEntityType[]` type rejects an INVALID member, not a missing one). */
export const ENTITIES: readonly MetricEntityType[] = [
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
export const METRIC_UNIT: Record<string, "usd" | "count"> = {
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
export const METRICS = Object.keys(METRIC_UNIT);

// FLOW = additive per day (sum over a week); the rest are STOCK (last-in-week).
export const FLOW_METRICS = new Set([
  "volume_usd",
  "gacha_volume_usd",
  "trades",
  "active_wallets",
  "cards_traded",
  "cards",
]);

/**
 * window (`fromMs`) → freq resample → optional rebase. Pure; the caller resolves
 * `fromMs`/`fromIso` from its own params (public has a `window` allowlist, internal
 * takes `from` directly).
 */
export function shapeSeries(
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

// ── Internal-endpoint plumbing (unauthed chart) ────────────────────────────────

/** Per-IP throttle for the internal chart endpoints (generous — the live chart
 *  fires several reads per interaction; the cache absorbs the rest). */
export const CHART_RATE = { bucket: "chart", limit: 240, windowSec: 60 } as const;

/** Cache a reader call (public market data, changes ~daily). The rate limiter runs
 *  UNCACHED per request; only the DB reads are memoised. Keep `keyParts` param-complete. */
const CHART_CACHE_S = 900; // 15 min
export function cachedChart<T>(keyParts: string[], fn: () => Promise<T>): Promise<T> {
  return unstable_cache(fn, ["chart", ...keyParts], { revalidate: CHART_CACHE_S, tags: ["chart-data"] })();
}
