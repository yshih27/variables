/**
 * Minimal Dune Analytics API client.
 *
 * Usage modes:
 *   - getLatestResults(queryId)  — read the query's last cached run without
 *     waiting for an execution. ⚠️ NOT free: Dune bills the EXPORT by result
 *     size, so re-reading a big result set on a schedule is exactly how this
 *     client quietly burned ~2.7M datapoints/day. The comment here used to say
 *     "no credits" — it was wrong, and the meter below exists because of it.
 *   - probeCachedResult(queryId) — how old is the cached result, for ≈0 cost
 *     (one row of datapoints; ~0.01 credits/day fleet-wide).
 *     Use this to decide staleness; never export rows just to read a timestamp.
 *   - runQuery(queryId)          — trigger a FRESH execution, poll until done,
 *     return rows. Costs execution (compute) credits + takes seconds–minutes.
 *   - duneUsage()                — authoritative account spend (free endpoint).
 *
 * Keep every scheduled query WINDOWED (e.g. `block_time > now() - interval '30'
 * day`). The spine persists daily history in Postgres and never re-derives it,
 * so an unbounded scan buys nothing and is billed on every single read.
 *
 * Auth: `DUNE_API_KEY` in .env.local (header `X-Dune-API-Key`).
 * Docs: https://docs.dune.com/api-reference/
 */
import { readFreshness } from "../db/freshness";

const BASE = "https://api.dune.com/api/v1";

class DuneError extends Error {
  constructor(public status: number, public body: string, public path: string) {
    super(`Dune ${status} on ${path}: ${body.slice(0, 200)}`);
  }
}

function apiKey(): string {
  const k = process.env.DUNE_API_KEY;
  if (!k) throw new Error("DUNE_API_KEY is not set");
  return k;
}

export type DuneRow = Record<string, unknown>;

/** What a result page cost. Dune self-reports both on every response:
 *  `datapoint_count` = billed cell count; `result_set_bytes` = exported bytes,
 *  which is what the current pricing actually bills ("credits per MB exported"). */
type DuneResultMetadata = {
  column_names: string[];
  column_types: string[];
  row_count: number;
  total_row_count: number;
  datapoint_count?: number;
  result_set_bytes?: number;
  total_result_set_bytes?: number;
};

type DuneResultResponse = {
  execution_id: string;
  query_id: number;
  is_execution_finished: boolean;
  state: string; // QUERY_STATE_COMPLETED | _EXECUTING | _PENDING | _FAILED ...
  execution_ended_at?: string; // ISO — when Dune last computed this cached result
  submitted_at?: string; // ISO fallback if execution_ended_at is absent
  result?: {
    rows: DuneRow[];
    metadata: DuneResultMetadata;
  };
  next_uri?: string | null;
  next_offset?: number | null;
};

// ─────────────────────────── Credit meter ───────────────────────────
// Every Dune response says what it cost; we add it up so a burner surfaces in
// check-freshness instead of on the invoice. This exists because an UNWINDOWED
// full-history query (Courtyard secondary) quietly billed ~2.7M datapoints/day
// for 18 days — silent meters are how that goes unnoticed.
//
// ⚠️ Unlike the Helius meter this WARNS instead of throwing: the spend has
// already happened by the time the response lands, so throwing would only
// discard data we just paid for. The real stop is bounding the query itself.
// Authoritative spend lives at POST /api/v1/usage (free) — see duneUsage().
const DATAPOINT_BUDGET = (() => {
  const raw = Number(process.env.DUNE_DATAPOINT_BUDGET);
  return Number.isFinite(raw) && raw > 0 ? raw : 200_000;
})();

let datapointsUsed = 0;
let bytesUsed = 0;
let callsMade = 0;
let budgetWarned = false;

export type DuneSpend = { datapoints: number; bytes: number; calls: number };

/** What this process (≈ this warmer run) has pulled from Dune so far. */
export function duneSpend(): DuneSpend {
  return { datapoints: datapointsUsed, bytes: bytesUsed, calls: callsMade };
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

function meter(label: string, md: DuneResultMetadata | undefined, ms?: number): void {
  if (!md) return;
  const dp = Number(md.datapoint_count) || 0;
  const bytes = Number(md.result_set_bytes) || 0;
  datapointsUsed += dp;
  bytesUsed += bytes;
  callsMade += 1;
  // Probes now cost one row rather than zero, so they log too — deliberately.
  // Their LATENCY is the signal: probe time creeping up under Dune load is what
  // precedes the 504s that used to hang a warmer for minutes per query, and the
  // health-gate output is where that drift needs to be visible early.
  if (dp > 0) {
    console.log(
      `[dune] ${label} → ${dp.toLocaleString()} datapoints · ${fmtBytes(bytes)}` +
        (ms != null ? ` · ${ms}ms` : "") +
        ` (run total ${datapointsUsed.toLocaleString()} dp · ${fmtBytes(bytesUsed)})`,
    );
  }
  if (!budgetWarned && datapointsUsed > DATAPOINT_BUDGET) {
    budgetWarned = true;
    console.warn(
      `[dune] ⚠ credit budget exceeded this run: ${datapointsUsed.toLocaleString()} > ` +
        `${DATAPOINT_BUDGET.toLocaleString()} datapoints. A query is scanning too much — ` +
        `window it (see COURTYARD_SECONDARY_QUERY_ID) or raise DUNE_DATAPOINT_BUDGET.`,
    );
  }
}

type ExecuteResponse = { execution_id: string; state: string };
type StatusResponse = {
  execution_id: string;
  query_id: number;
  state: string;
  is_execution_finished?: boolean;
};

async function req<T>(
  path: string,
  init?: RequestInit & { absoluteUrl?: string; timeoutMs?: number },
): Promise<T> {
  const url = init?.absoluteUrl ?? `${BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    // Only set where a caller asks. The heavy reads and the execution poll must
    // keep their existing unbounded behaviour — a 250k-row export legitimately
    // takes minutes, and capping it here would turn a slow read into a failure.
    ...(init?.timeoutMs ? { signal: AbortSignal.timeout(init.timeoutMs) } : {}),
    headers: {
      "X-Dune-API-Key": apiKey(),
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new DuneError(res.status, await res.text(), path);
  return (await res.json()) as T;
}

/**
 * Build the query-param string Dune expects for parameterized queries.
 * Dune wants `params.<name>=<value>` query-string entries.
 */
function paramQuery(
  params?: Record<string, string | number>,
  extra?: Record<string, string | number>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) sp.set(`params.${k}`, String(v));
  for (const [k, v] of Object.entries(extra ?? {})) sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export type LatestResults = {
  rows: DuneRow[];
  /** When Dune last COMPUTED this cached result (null if the API omitted it). */
  executionEndedAt: string | null;
};

/**
 * Instant read of a saved query's most recent cached result, plus the timestamp
 * of when Dune computed it. Paginates through `next_uri` so large result sets
 * come back whole.
 */
export async function getLatestResultsMeta(
  queryId: number,
  opts: { params?: Record<string, string | number>; maxRows?: number } = {},
): Promise<LatestResults> {
  const maxRows = opts.maxRows ?? 100_000;
  const rows: DuneRow[] = [];
  let executionEndedAt: string | null = null;
  let path: string | null = `/query/${queryId}/results${paramQuery(opts.params)}`;
  let absoluteUrl: string | undefined;
  let first = true;

  while (path || absoluteUrl) {
    const page: DuneResultResponse = await req<DuneResultResponse>(path ?? "", {
      absoluteUrl,
    });
    meter(`query ${queryId} results`, page.result?.metadata);
    if (first) {
      executionEndedAt = page.execution_ended_at ?? page.submitted_at ?? null;
      first = false;
    }
    if (page.result?.rows) for (const row of page.result.rows) rows.push(row);
    if (rows.length >= maxRows) break;
    if (page.next_uri) {
      absoluteUrl = page.next_uri;
      path = null;
    } else {
      break;
    }
  }
  return { rows, executionEndedAt };
}

/** Rows-only convenience over getLatestResultsMeta — the common read path. */
export async function getLatestResults(
  queryId: number,
  opts: { params?: Record<string, string | number>; maxRows?: number } = {},
): Promise<DuneRow[]> {
  return (await getLatestResultsMeta(queryId, opts)).rows;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Trigger a fresh execution and poll until it finishes, then return rows.
 * Throws if the execution fails or exceeds `maxWaitMs`.
 */
export async function runQuery(
  queryId: number,
  opts: {
    params?: Record<string, string | number>;
    maxWaitMs?: number;
    pollMs?: number;
    maxRows?: number;
  } = {},
): Promise<DuneRow[]> {
  const maxWaitMs = opts.maxWaitMs ?? 180_000; // 3 min
  const pollMs = opts.pollMs ?? 3_000;

  const exec = await req<ExecuteResponse>(`/query/${queryId}/execute`, {
    method: "POST",
    body: JSON.stringify(opts.params ? { query_parameters: opts.params } : {}),
  });

  const deadline = Date.now() + maxWaitMs;
  // Loop bounded by deadline; we don't use Date.now() for randomness, only
  // for the timeout guard (acceptable — not part of any cached journal).
  for (;;) {
    const status = await req<StatusResponse>(`/execution/${exec.execution_id}/status`);
    if (status.state === "QUERY_STATE_COMPLETED") break;
    if (status.state === "QUERY_STATE_FAILED" || status.state === "QUERY_STATE_CANCELLED") {
      throw new Error(`Dune execution ${exec.execution_id} ${status.state}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`Dune execution ${exec.execution_id} timed out after ${maxWaitMs}ms`);
    }
    await sleep(pollMs);
  }

  // Fetch results (paginated).
  const maxRows = opts.maxRows ?? 100_000;
  const rows: DuneRow[] = [];
  let absoluteUrl: string | undefined;
  let path: string | null = `/execution/${exec.execution_id}/results`;
  while (path || absoluteUrl) {
    const page: DuneResultResponse = await req<DuneResultResponse>(path ?? "", { absoluteUrl });
    meter(`execution ${exec.execution_id} results`, page.result?.metadata);
    if (page.result?.rows) for (const row of page.result.rows) rows.push(row);
    if (rows.length >= maxRows) break;
    if (page.next_uri) {
      absoluteUrl = page.next_uri;
      path = null;
    } else break;
  }
  return rows;
}

export type AutoRefreshResult = {
  /**
   * Rows from Dune — NULL only when `reuseIfUnchanged` was set and the cached
   * result is one we have already ingested (see `unchanged`). Nullable on
   * purpose: it makes every caller decide what to do with "nothing new", instead
   * of an empty array quietly rebuilding a snapshot out of no data.
   */
  rows: DuneRow[] | null;
  /** True if the cache was stale and we ran a fresh execution instead. */
  refreshed: boolean;
  /** Age of the cached result we found, in ms (null if Dune omitted the time). */
  cachedAgeMs: number | null;
  /**
   * True when the download was SKIPPED because Dune's cached result predates our
   * own last successful ingest of this source — i.e. we already have exactly
   * these rows. The caller must reuse what it persisted last run.
   */
  unchanged?: boolean;
};

/** Probe request budget. Dune under load has answered the results endpoint in
 *  minutes rather than seconds; a probe that hangs is worse than a probe that
 *  fails, because the caller can recover from a failure and cannot recover from
 *  a five-minute stall. One retry covers a transient blip without turning a
 *  sustained outage into a long wait. */
const PROBE_TIMEOUT_MS = 20_000;
const PROBE_ATTEMPTS = 2;

export type CachedResultProbe = {
  /** When Dune last COMPUTED the cached result (null if the API omitted it). */
  executionEndedAt: string | null;
  /** Rows the cached result holds — 0 means there is nothing to serve. */
  totalRowCount: number;
};

/**
 * Near-free staleness check: how old is this query's cached result, and does it
 * hold any rows? Reads ONE row instead of exporting the entire result set just
 * to take a timestamp off it — ≈0 cost (a single row of datapoints, ~0.01
 * credits/day across the whole fleet).
 *
 * ⚠️ This used to ask for an out-of-range `offset` to get a genuinely
 * zero-datapoint empty page. That shape was abandoned: under Dune load the giant
 * offset took MINUTES and then 504'd — four probes hanging 5 minutes each is what
 * failed a core job after 44 minutes. `limit=1` returns the same
 * `execution_ended_at` and the same `metadata.total_row_count`, measured 3.4×
 * faster, and does not depend on undocumented behaviour for out-of-range offsets.
 * The one row of datapoints it costs is the price of not hanging.
 *
 * ⚠️ Still do NOT reach for `limit=0`: Dune IGNORES it and returns the whole
 * result set at full cost (measured: all 141 rows / 846 datapoints on 7845248).
 *
 * Throws on failure — `getResultsAutoRefresh` owns the fallback, so a probe
 * outage degrades to our own freshness rather than to an execution storm.
 */
export async function probeCachedResult(
  queryId: number,
  opts: { params?: Record<string, string | number> } = {},
): Promise<CachedResultProbe> {
  const path = `/query/${queryId}/results${paramQuery(opts.params, { limit: 1 })}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt++) {
    const t0 = Date.now();
    try {
      const page = await req<DuneResultResponse>(path, { timeoutMs: PROBE_TIMEOUT_MS });
      meter(`query ${queryId} probe`, page.result?.metadata, Date.now() - t0);
      return {
        executionEndedAt: page.execution_ended_at ?? page.submitted_at ?? null,
        totalRowCount: Number(page.result?.metadata?.total_row_count) || 0,
      };
    } catch (e) {
      lastErr = e;
      console.warn(
        `[dune] query ${queryId} probe attempt ${attempt}/${PROBE_ATTEMPTS} failed after ${Date.now() - t0}ms: ${(e as Error).message.slice(0, 120)}`,
      );
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Age of OUR OWN last successful warm for a source — the fallback when Dune's
 * probe is unavailable. Only a status of "ok" counts: an "error" row means the
 * warmer ran and failed, which is no evidence that the data behind it is fresh.
 * Null when we have no usable row, which the caller treats as "unknown", not
 * "fresh".
 */
/** Wall-clock ms of our last SUCCESSFUL warm for a source, or null. */
async function lastIngestMs(source: string): Promise<number | null> {
  try {
    const rows = await readFreshness([source]);
    const row = rows.find((r) => r.source === source);
    if (!row || row.status !== "ok") return null;
    const t = Date.parse(row.generated_at);
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

async function snapshotAgeMs(source: string): Promise<number | null> {
  try {
    const rows = await readFreshness([source]);
    const row = rows.find((r) => r.source === source);
    if (!row || row.status !== "ok") return null;
    const t = Date.parse(row.generated_at);
    return Number.isFinite(t) ? Date.now() - t : null;
  } catch {
    return null;
  }
}

/**
 * Self-healing read — the durable fix for "the scheduled fresh run silently
 * stopped and the cached result rotted for days" (how CC secondary went to $0).
 *
 * Serve the cached result, but if Dune last computed it more than `maxAgeMs`
 * ago — or there are no rows — trigger a FRESH execution and return that. Every
 * cached read now repairs itself the moment the data crosses the staleness line,
 * so a missed scheduled refresh can no longer rot the data: the next warm heals it.
 *
 * Staleness is decided from a 0-datapoint PROBE, not from the full result set.
 * The old order exported every row first and then, if the cache turned out to be
 * stale, threw all of them away and executed anyway — paying full export price
 * for data it never used. Rows are now fetched only down the branch that needs
 * them.
 *
 * Safe degradation, two kinds:
 *   • Dune reports no execution timestamp → trust a non-empty cache rather than
 *     re-running on every call (which would burn credits).
 *   • The PROBE ITSELF fails (timeout, 504, outage) → fall back to how fresh OUR
 *     OWN last successful warm is, via `freshnessSource`. If our snapshot is
 *     younger than `maxAgeMs` the data is fine and we serve cached; only a
 *     genuinely stale snapshot justifies paying for an execution. Without this a
 *     Dune wobble either hangs the warmer or stampedes it into executing every
 *     query at once — the run that failed after 44 minutes did the former.
 */
export async function getResultsAutoRefresh(
  queryId: number,
  opts: {
    maxAgeMs: number;
    params?: Record<string, string | number>;
    runOpts?: { maxWaitMs?: number; pollMs?: number; maxRows?: number };
    maxRows?: number;
    /**
     * Skip the row download when Dune's cached result is older than our own last
     * successful warm of `freshnessSource` — a result we have already ingested is
     * never worth re-exporting. Requires `freshnessSource`. Returns
     * `rows: null, unchanged: true`; the caller reuses what it persisted.
     *
     * This is the difference between paying for a query once per EXECUTION and
     * once per READ. The 6h batches re-read results that only change on the daily
     * execution, so three of every four downloads were re-buying identical bytes.
     */
    reuseIfUnchanged?: boolean;
    /** The caller's `source_freshness` key (the name it passes to runWarmer).
     *  Used ONLY when the probe fails, to decide whether our own data is still
     *  fresh enough to serve cached. Omit and a probe failure falls through to an
     *  execution, which is correct but expensive — so callers should pass it. */
    freshnessSource?: string;
  },
): Promise<AutoRefreshResult> {
  let probe: CachedResultProbe;
  try {
    probe = await probeCachedResult(queryId, { params: opts.params });
  } catch (e) {
    // 404 = no result exists — a definitive answer, not an outage; the fallback
    // is only for 5xx/timeouts. Treat it exactly like the totalRowCount === 0
    // staleness branch and execute, or the freshness fallback would "serve
    // cached" from a query that has no cached result and throw on the read.
    if (e instanceof DuneError && e.status === 404) {
      console.warn(`[dune] query ${queryId} has no cached result (404) — executing fresh`);
      const rows = await runQuery(queryId, { params: opts.params, ...opts.runOpts });
      return { rows, refreshed: true, cachedAgeMs: null };
    }
    const ageMs = opts.freshnessSource ? await snapshotAgeMs(opts.freshnessSource) : null;
    const fresh = ageMs !== null && ageMs <= opts.maxAgeMs;
    if (fresh) {
      console.warn(
        `[dune] query ${queryId} probe unavailable — snapshot fresh (${(ageMs / 3.6e6).toFixed(1)}h), serving cached: ${(e as Error).message.slice(0, 100)}`,
      );
      const { rows } = await getLatestResultsMeta(queryId, {
        params: opts.params,
        maxRows: opts.maxRows,
      });
      return { rows, refreshed: false, cachedAgeMs: null };
    }
    console.warn(
      `[dune] query ${queryId} probe unavailable — snapshot ${ageMs === null ? "age unknown" : `stale (${(ageMs / 3.6e6).toFixed(1)}h)`}, executing fresh: ${(e as Error).message.slice(0, 100)}`,
    );
    const rows = await runQuery(queryId, { params: opts.params, ...opts.runOpts });
    return { rows, refreshed: true, cachedAgeMs: null };
  }

  const parsed = probe.executionEndedAt ? Date.parse(probe.executionEndedAt) : NaN;
  const cachedAgeMs = Number.isFinite(parsed) ? Date.now() - parsed : null;
  const stale =
    probe.totalRowCount === 0 || (cachedAgeMs !== null && cachedAgeMs > opts.maxAgeMs);

  // Already-ingested short circuit. Only when NOT stale: a stale result still
  // needs re-executing even if we ingested this (old) version of it.
  if (!stale && opts.reuseIfUnchanged && opts.freshnessSource && probe.executionEndedAt) {
    const ingestedAtMs = await lastIngestMs(opts.freshnessSource);
    const executedAtMs = Date.parse(probe.executionEndedAt);
    if (
      ingestedAtMs !== null &&
      Number.isFinite(executedAtMs) &&
      executedAtMs <= ingestedAtMs
    ) {
      console.log(
        `[dune] query ${queryId} unchanged since our last ${opts.freshnessSource} write ` +
          `(executed ${new Date(executedAtMs).toISOString().slice(0, 16)}, ingested ` +
          `${new Date(ingestedAtMs).toISOString().slice(0, 16)}) — skipping download`,
      );
      return { rows: null, refreshed: false, cachedAgeMs, unchanged: true };
    }
  }

  if (stale) {
    const fresh = await runQuery(queryId, { params: opts.params, ...opts.runOpts });
    return { rows: fresh, refreshed: true, cachedAgeMs };
  }
  const { rows } = await getLatestResultsMeta(queryId, {
    params: opts.params,
    maxRows: opts.maxRows,
  });
  return { rows, refreshed: false, cachedAgeMs };
}

export type DuneUsage = {
  creditsUsed: number;
  creditsIncluded: number;
  periodStart: string | null;
  periodEnd: string | null;
};

/**
 * Authoritative account spend for the current billing period. This endpoint is
 * metadata — free, and it does not consume credits — so it's the honest number
 * to report next to our own per-run meter (which only ever sees export cost, not
 * the compute charged for each execution).
 */
export async function duneUsage(): Promise<DuneUsage | null> {
  type UsageResponse = {
    billing_periods?: {
      start_date?: string;
      end_date?: string;
      credits_used?: number;
      credits_included?: number;
    }[];
  };
  const res = await req<UsageResponse>("/usage", { method: "POST", body: "{}" });
  const p = res.billing_periods?.[0];
  if (!p) return null;
  return {
    creditsUsed: Number(p.credits_used) || 0,
    creditsIncluded: Number(p.credits_included) || 0,
    periodStart: p.start_date ?? null,
    periodEnd: p.end_date ?? null,
  };
}

/**
 * Is this saved query archived on Dune's side? An archived query 403s every
 * execution, which is how the Aug '26 plan downgrade silently killed the spine
 * writer for a week. Pure metadata read — zero datapoints billed.
 */
export async function queryArchivedStatus(queryId: number): Promise<boolean> {
  const res = await req<{ is_archived?: boolean }>(`/query/${queryId}`);
  return Boolean(res.is_archived);
}

export { DuneError };
