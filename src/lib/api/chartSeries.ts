/**
 * Shared helpers for the raw-metric series endpoints — the public /api/v1/series
 * (keyed) and the internal /api/internal/chart/series (unauthed, same-origin,
 * cached). Both shape the same spine metrics identically; this is the one copy of
 * that logic (metric allowlist + units + window/freq/rebase shaping).
 */
import { unstable_cache } from "next/cache";
import { isSameOrigin, rateLimitByIp, rateLimitInMemory, type RateLimitResult } from "./auth";
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

/**
 * The one guard every internal chart route runs.
 *
 * ⚠️ SAME-ORIGIN CALLS NO LONGER TOUCH POSTGRES. `rateLimitByIp` does a
 * read-modify-write of a `snapshots` KV row before any chart work — two PostgREST
 * round trips, on the same table, under the studio's own concurrency. Our page
 * fetching its own chart data was paying a public-API abuse control on every
 * call, and it was a measurable slice of the ~30s first paint. Same-origin traffic
 * now gets an in-memory per-instance bucket instead (no I/O); cross-origin and
 * unknown callers keep the durable DB limiter exactly as before.
 *
 * Side effect worth naming: this stops writing the `ratelimit:chart:*` rows that
 * have been accumulating in `snapshots` (they show up in check-freshness output).
 * Existing rows are untouched — they are keyed by window id and simply stop being
 * read or added to.
 */
export async function guardChartRequest(req: Request): Promise<RateLimitResult> {
  return isSameOrigin(req) ? rateLimitInMemory(req, CHART_RATE) : rateLimitByIp(req, CHART_RATE);
}

/**
 * CDN cache headers for chart JSON.
 *
 * Safe because the query params fully key the response and the underlying data
 * moves on the warmers' ~6h cadence — so a shared 30-minute edge cache serves a
 * figure no staler than the page around it, and `stale-while-revalidate` means the
 * first visitor after expiry gets the cached copy instantly while it refreshes
 * behind them. `private`/no-store would be wrong here: this is public market data,
 * identical for every visitor.
 *
 * `Vary: Accept-Encoding` only — deliberately NOT the same-origin headers. Varying
 * on `Sec-Fetch-Site` would shard the edge cache per navigation type for a body
 * that does not depend on it; the header changes who pays for rate limiting, not
 * what is returned.
 */
export const CHART_CDN_HEADERS: Record<string, string> = {
  "cache-control": "public, s-maxage=1800, stale-while-revalidate=3600",
  vary: "Accept-Encoding",
};

/** Cache a reader call (public market data, changes ~daily). The rate limiter runs
 *  UNCACHED per request; only the DB reads are memoised. Keep `keyParts` param-complete. */
const CHART_CACHE_S = 900; // 15 min
export function cachedChart<T>(keyParts: string[], fn: () => Promise<T>): Promise<T> {
  // Two tags: its own, and `platform-buckets` — the tag the warmers already sweep
  // when fresh platform data lands. Without the second one a warm could publish new
  // figures while the chart kept serving the previous 15 minutes' cache, and the
  // page and its chart would disagree in the same viewport.
  return unstable_cache(fn, ["chart", ...keyParts], {
    revalidate: CHART_CACHE_S,
    tags: ["chart-data", "platform-buckets"],
  })();
}
