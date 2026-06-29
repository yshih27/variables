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
  | "platform_ip";

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

/** One metric's full series, oldest → newest. The frontend chart read path. */
export async function readMetricSeries(
  entityType: MetricEntityType,
  entityKey: string,
  metric: string,
): Promise<SeriesPoint[]> {
  const { data, error } = await db()
    .from("metric_snapshots")
    .select("ts,value")
    .eq("entity_type", entityType)
    .eq("entity_key", entityKey)
    .eq("metric", metric)
    .order("ts", { ascending: true });
  if (error) {
    console.warn(`[metric_snapshots] read "${entityType}/${entityKey}/${metric}" failed: ${error.message}`);
    return [];
  }
  return (data ?? []).map((r) => ({ ts: r.ts as string, value: Number(r.value) }));
}

/** Midnight-UTC ISO for the day containing `ms`. The canonical bucket key. */
export function dayStartUtc(ms: number): string {
  const d = new Date(ms);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  ).toISOString();
}
