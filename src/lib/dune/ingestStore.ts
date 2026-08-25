/**
 * Execution-keyed ingest store — the transport-level dedupe for Dune results.
 *
 * A Dune result is immutable for a given `execution_id`: the same execution
 * always yields the same rows. So once ANY warmer has downloaded an execution,
 * every other warmer that wants it should read Postgres, not Dune. Before this,
 * two consumers of the same query in the same daily job each paid full export
 * price for byte-identical data (the buyback query: ~1.75MB, ~17.5 cr, twice).
 *
 * ⚠️ This dedupes TRANSPORT ONLY. Staleness policy stays with each warmer via
 * its own `freshnessSource` / `maxAgeMs` — a warmer that decides the cache is too
 * old still triggers a fresh execution, and that new execution gets its own key.
 *
 * Storage is the existing `snapshots` table rather than a new `dune_ingests`
 * table, deliberately: there is no DDL path from the app env (PostgREST only) and
 * two migrations are already queued unapplied, so a new table would have blocked
 * this behind an ops step. Key shape `dune-ingest:{queryId}:{executionId}` gives
 * the same (query, execution) uniqueness a dedicated table would.
 *
 * Payloads are gzip-wrapped with the same `{ __gz__ }` convention as the listings
 * blob: a raw multi-MB jsonb upsert trips statement_timeout through PostgREST.
 */
import { gzipSync, gunzipSync } from "node:zlib";
import { db } from "../db/client";
import { readSnapshot, writeSnapshot } from "../db/snapshots";
import type { DuneRow } from "./client";

/** Keep this many executions per query; older ones are swept after each write. */
export const INGEST_RETAIN = 3;

const KEY_PREFIX = "dune-ingest:";
const keyFor = (queryId: number, executionId: string) => `${KEY_PREFIX}${queryId}:${executionId}`;

type GzWrapper = { __gz__: string };
type Payload = { rows: DuneRow[] };

function isGz(p: unknown): p is GzWrapper {
  return !!p && typeof p === "object" && typeof (p as { __gz__?: unknown }).__gz__ === "string";
}

/** Rows for an execution we have already ingested, or null. Never throws. */
export async function readIngest(queryId: number, executionId: string): Promise<DuneRow[] | null> {
  const raw = await readSnapshot<Payload | GzWrapper>(keyFor(queryId, executionId));
  if (!raw) return null;
  try {
    const payload = isGz(raw)
      ? (JSON.parse(gunzipSync(Buffer.from(raw.__gz__, "base64")).toString()) as Payload)
      : raw;
    return Array.isArray(payload.rows) ? payload.rows : null;
  } catch (e) {
    // A corrupt/half-written blob must not poison the caller — fall through to a
    // download rather than serving garbage or throwing.
    console.warn(`[dune-ingest] read ${queryId}/${executionId} unusable: ${(e as Error).message}`);
    return null;
  }
}

/** Store rows under their execution id, then sweep older executions. */
export async function writeIngest(
  queryId: number,
  executionId: string,
  rows: DuneRow[],
): Promise<{ bytes: number; swept: number }> {
  const gz = gzipSync(Buffer.from(JSON.stringify({ rows } satisfies Payload))).toString("base64");
  await writeSnapshot(keyFor(queryId, executionId), { __gz__: gz } satisfies GzWrapper);
  const swept = await sweepIngests(queryId).catch((e) => {
    console.warn(`[dune-ingest] sweep ${queryId} failed: ${(e as Error).message}`);
    return 0;
  });
  return { bytes: gz.length, swept };
}

/**
 * Drop all but the newest `retain` executions for a query. Retention is per
 * QUERY, not global: a rarely-run query keeps its last few, a busy one does not
 * evict a quiet one's only copy.
 */
export async function sweepIngests(queryId: number, retain = INGEST_RETAIN): Promise<number> {
  const { data, error } = await db()
    .from("snapshots")
    .select("key, generated_at")
    .like("key", `${KEY_PREFIX}${queryId}:%`)
    .order("generated_at", { ascending: false });
  if (error) throw new Error(`[dune-ingest] list failed: ${error.message}`);
  const keys = (data ?? []).map((r) => String(r.key));
  const stale = keys.slice(retain);
  if (!stale.length) return 0;
  const { error: delErr } = await db().from("snapshots").delete().in("key", stale);
  if (delErr) throw new Error(`[dune-ingest] delete failed: ${delErr.message}`);
  return stale.length;
}
