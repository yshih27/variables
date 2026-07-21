/**
 * metric_snapshots — the long-term daily time-series spine.
 *
 * One row per (entity_type, entity_key, metric, ts). This is the history the
 * rolling `snapshots` blobs (which OVERWRITE each warm) can't provide — you
 * can't backfill what you never recorded, so this table starts recording now.
 * Written daily by scripts/warm-metric-snapshots.ts; read by the charts.
 *
 * Two metric families, both keyed to a UTC day-start `ts`:
 *   • flow  (volume_usd, trades, active_wallets) — a COMPLETE-calendar-day
 *     aggregate, backfilled from row-level history (CC 30d via Dune,
 *     Beezie/Courtyard 7d via the history snapshot).
 *   • stock (mcap_usd, holders, floor_usd) — a point-in-time reading taken at
 *     warm time; no backfill exists, so it only accumulates forward.
 *
 * PK (entity_type, entity_key, metric, ts) makes every write idempotent: a
 * re-run overwrites the same day rather than duplicating it, and late-indexed
 * sales self-correct on the next run.
 *
 * ── TWO-TIER WINDOWING RULE (read this before comparing numbers across surfaces) ──
 * The app shows the same metric over two different windows, by design:
 *   • LIVE tier — hero stats, tables, "24h" figures — read the ROLLING-24h `snapshots`
 *     blobs (core-volume / marketcap / holders / gacha-dune). "Last 24 hours from now."
 *   • CHART tier — every time-series chart — reads THIS spine, which is COMPLETE-
 *     CALENDAR-DAY (UTC midnight buckets). "Whole days, yesterday and back."
 * So a rolling-24h hero number and the latest calendar-day chart point legitimately
 * differ (they cover different spans) — that's not a bug. Everything in the spine,
 * including `gacha_volume_usd` (from the daily-bucketed Dune queries), is calendar-day;
 * never mix a rolling-24h value into a spine chart. Label the window in the UI ("24h"
 * vs "daily") so the two tiers never read as a contradiction.
 */
import { db } from "../db/client";

// "set"/"grade"/"platform_ip" carry a composite entity_key ("{ip}:{setName}",
// "{ip}:{gradeLabel}", "{platform}:{ip}") for the daily dominance series.
export type MetricEntityType =
  | "market"
  | "platform"
  | "ip"
  | "card"
  | "set"
  | "grade"
  | "platform_ip"
  | "benchmark";

export type MetricRow = {
  entity_type: MetricEntityType;
  entity_key: string;
  metric: string;
  value: number;
  ts: string; // UTC day-start ISO
};

/** Idempotent chunked upsert on the composite PK. Skips non-finite values. */
export async function writeMetricSnapshots(rows: MetricRow[]): Promise<number> {
  const clean = rows.filter((r) => Number.isFinite(r.value));
  const CHUNK = 500;
  for (let i = 0; i < clean.length; i += CHUNK) {
    const { error } = await db()
      .from("metric_snapshots")
      .upsert(clean.slice(i, i + CHUNK), {
        onConflict: "entity_type,entity_key,metric,ts",
      });
    if (error) throw new Error(`[metric_snapshots] upsert failed: ${error.message}`);
  }
  return clean.length;
}

export type SeriesPoint = { ts: string; value: number };

// PostgREST caps a response at 1000 rows by default. With `order(ts asc)` that
// silently drops the NEWEST rows once a series exceeds 1000 points (Courtyard's
// volume_usd is already ~950 days), which quietly truncates charts. Page past it.
const PAGE = 1000;

/** One metric's full series, oldest → newest. The frontend chart read path. */
export async function readMetricSeries(
  entityType: MetricEntityType,
  entityKey: string,
  metric: string,
): Promise<SeriesPoint[]> {
  const out: SeriesPoint[] = [];
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db()
        .from("metric_snapshots")
        .select("ts,value")
        .eq("entity_type", entityType)
        .eq("entity_key", entityKey)
        .eq("metric", metric)
        .order("ts", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        console.warn(`[metric_snapshots] read "${entityType}/${entityKey}/${metric}" failed: ${error.message}`);
        return out; // return whatever we have (empty on the first page)
      }
      const rows = data ?? [];
      for (const r of rows) out.push({ ts: r.ts as string, value: Number(r.value) });
      if (rows.length < PAGE) break; // last page — a <1000 series costs one round-trip
    }
  } catch (e) {
    // Never throw (e.g. a db() env-missing throw at build) — degrade to what we have.
    console.warn(`[metric_snapshots] read "${entityType}/${entityKey}/${metric}" threw: ${(e as Error).message}`);
  }
  return out;
}

/**
 * Every entity's series for one (entity_type, metric), grouped by entity_key —
 * one query for a whole leaderboard's worth of history (vs N readMetricSeries).
 */
export async function readMetricSeriesBulk(
  entityType: MetricEntityType,
  metric: string,
): Promise<Map<string, SeriesPoint[]>> {
  const out = new Map<string, SeriesPoint[]>();
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db()
        .from("metric_snapshots")
        .select("entity_key,ts,value")
        .eq("entity_type", entityType)
        .eq("metric", metric)
        .order("ts", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        console.warn(`[metric_snapshots] bulk read "${entityType}/${metric}" failed: ${error.message}`);
        return out;
      }
      const rows = data ?? [];
      for (const r of rows) {
        const key = r.entity_key as string;
        const arr = out.get(key);
        const point = { ts: r.ts as string, value: Number(r.value) };
        if (arr) arr.push(point);
        else out.set(key, [point]);
      }
      if (rows.length < PAGE) break;
    }
  } catch (e) {
    console.warn(`[metric_snapshots] bulk read "${entityType}/${metric}" threw: ${(e as Error).message}`);
  }
  return out;
}

/**
 * Percent change of a daily series vs the point nearest `daysAgo` days back
 * (by ts, not index — tolerates gaps). Returns null when there isn't enough
 * history to reach that far, so we never fabricate a change from a short series.
 */
export function pctChange(series: SeriesPoint[], daysAgo: number): number | null {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  const now = last.value;
  if (!Number.isFinite(now)) return null;
  const targetMs = Date.parse(last.ts) - daysAgo * 86_400_000;
  let prev: SeriesPoint | null = null;
  for (const p of series) {
    if (Date.parse(p.ts) <= targetMs) prev = p;
    else break;
  }
  if (!prev || !Number.isFinite(prev.value) || prev.value === 0) return null;
  return ((now - prev.value) / prev.value) * 100;
}

/**
 * $ floor for a %-change DENOMINATOR. A tiny prior value otherwise prints an absurd
 * change (Courtyard's $31 → $3,036 day printed "+9,538.6%"). Same guard convention as
 * `pctChangeDays(…, MOMENTUM_MIN_BASE)` in category/rollup.ts — below the floor we
 * return null ("—"), because a percentage off near-zero is noise, not a signal.
 */
export const DELTA_MIN_BASE_USD = 1000;

/**
 * Σ of a daily series over the contiguous `days`-day window ending at the series'
 * LAST recorded day (anchored to the DATA, not wall-clock, so a lagging warmer
 * yields a real — if slightly stale — window rather than a short one).
 * Returns NaN when fewer than `days` distinct days exist in that window: a missing
 * number beats a 3-day sum masquerading as "7d".
 */
/**
 * Keep the points falling within the last `days` CALENDAR days, ending on the
 * series' newest point. Unlike `slice(-days)` (which takes N points regardless of
 * how many calendar days they span), this guarantees the returned span is ≤ days
 * — so a sparse series can't make a "14D" card's range label read 16 days while
 * the plot only draws 14.
 */
export function lastNDays(series: SeriesPoint[], days: number): SeriesPoint[] {
  if (!series.length || days < 1) return series;
  const dayIdx = (ts: string) => Math.floor(Date.parse(ts) / 86_400_000);
  const endDay = dayIdx(series[series.length - 1].ts);
  const cutoff = endDay - (days - 1);
  return series.filter((p) => dayIdx(p.ts) >= cutoff);
}

export function sumLastCompleteDays(series: SeriesPoint[], days: number): number {
  if (days < 1) return NaN;
  const sorted = series
    .filter((p) => Number.isFinite(Date.parse(p.ts)) && Number.isFinite(p.value))
    .sort((a, b) => a.ts.localeCompare(b.ts));
  if (!sorted.length) return NaN;
  const lastMs = Date.parse(sorted[sorted.length - 1].ts);
  const startMs = lastMs - (days - 1) * 86_400_000;
  const inWindow = sorted.filter((p) => Date.parse(p.ts) >= startMs);
  if (new Set(inWindow.map((p) => p.ts)).size < days) return NaN; // window not fully covered
  return inWindow.reduce((s, p) => s + p.value, 0);
}

/**
 * Day-over-day % change of a daily series — the latest recorded day vs the one
 * before it. `minBase` floors the denominator (see DELTA_MIN_BASE_USD); null when
 * there aren't two points or the base is too small to make a % meaningful.
 */
export function dayOverDayPct(series: SeriesPoint[], minBase = 0): number | null {
  const sorted = series
    .filter((p) => Number.isFinite(Date.parse(p.ts)) && Number.isFinite(p.value))
    .sort((a, b) => a.ts.localeCompare(b.ts));
  if (sorted.length < 2) return null;
  const cur = sorted[sorted.length - 1].value;
  const prev = sorted[sorted.length - 2].value;
  if (!(prev > 0) || prev < minBase) return null;
  return ((cur - prev) / prev) * 100;
}

/**
 * SOURCE-COMPLETENESS for a per-source daily bulk (Map<source, dailySeries>). A merged
 * day is COMPLETE only when every source that wrote the IMMEDIATELY-PRIOR day also
 * wrote it. This catches Dune lag: the spine's newest day often carries only the fast
 * sources (Courtyard/Beezie gacha) while CC/Phygitals still end yesterday — merging
 * that partial day and comparing it to a full prior day prints a fake collapse
 * ("gacha −79.8%"), and stacking it draws a fake cliff. A source that permanently
 * stops self-heals after one transition day (the expected set adjusts down); a source
 * that returns (lag caught up) makes the day complete again.
 * Returns the sorted days, the Σ-merged value per day, and the set of complete days.
 */
export function sourceDayCompleteness(bulk: Map<string, SeriesPoint[]>): {
  days: string[];
  merged: Map<string, number>;
  complete: Set<string>;
} {
  const daySources = new Map<string, Set<string>>();
  const merged = new Map<string, number>();
  for (const [source, series] of bulk) {
    for (const p of series) {
      if (!Number.isFinite(Date.parse(p.ts)) || !Number.isFinite(p.value)) continue;
      merged.set(p.ts, (merged.get(p.ts) ?? 0) + p.value);
      let s = daySources.get(p.ts);
      if (!s) daySources.set(p.ts, (s = new Set<string>()));
      s.add(source);
    }
  }
  const days = [...merged.keys()].sort();
  const complete = new Set<string>();
  for (let i = 0; i < days.length; i++) {
    if (i === 0) { complete.add(days[i]); continue; } // no prior day → complete
    const cur = daySources.get(days[i])!;
    const prev = daySources.get(days[i - 1])!;
    let ok = true;
    for (const s of prev) if (!cur.has(s)) { ok = false; break; }
    if (ok) complete.add(days[i]);
  }
  return { days, merged, complete };
}

/** The newest SOURCE-COMPLETE day (see sourceDayCompleteness) — the trailing day a
 *  composition chart should end on, so a Dune-lagged partial day never draws a cliff.
 *  null when the bulk is empty. */
export function latestCompleteDay(bulk: Map<string, SeriesPoint[]>): string | null {
  const { days, complete } = sourceDayCompleteness(bulk);
  for (let i = days.length - 1; i >= 0; i--) if (complete.has(days[i])) return days[i];
  return null;
}

/** Truncate a merged daily series to END on the latest SOURCE-COMPLETE day, so a
 *  composition/bar chart never draws a cliff on a Dune-lagged partial trailing day.
 *  Pass the same per-source bulk the merged series was summed from. */
export function dropIncompleteTail(merged: SeriesPoint[], bulk: Map<string, SeriesPoint[]>): SeriesPoint[] {
  const last = latestCompleteDay(bulk);
  return last ? merged.filter((p) => p.ts <= last) : merged;
}

/**
 * Completeness-aware Σ day-over-day % — the last two SOURCE-COMPLETE merged days, so a
 * partial newest day (Dune lag) is skipped and the comparison is like-for-like. Floors
 * the denominator with `minBase` (M4). null when <2 complete days or base too small.
 */
export function bulkDayOverDayPctComplete(bulk: Map<string, SeriesPoint[]>, minBase = 0): number | null {
  const { days, merged, complete } = sourceDayCompleteness(bulk);
  const completeDays = days.filter((d) => complete.has(d));
  if (completeDays.length < 2) return null;
  const cur = merged.get(completeDays[completeDays.length - 1])!;
  const prev = merged.get(completeDays[completeDays.length - 2])!;
  if (!(prev > 0) || prev < minBase) return null;
  return ((cur - prev) / prev) * 100;
}

/** Midnight-UTC ISO for the day containing `ms`. The canonical bucket key. */
export function dayStartUtc(ms: number): string {
  const d = new Date(ms);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  ).toISOString();
}
