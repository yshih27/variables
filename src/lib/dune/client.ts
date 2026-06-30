/**
 * Minimal Dune Analytics API client.
 *
 * Two usage modes:
 *   - getLatestResults(queryId) — instant read of the query's last cached run
 *     (no credits, no waiting). Best for serving when a scheduled refresh
 *     already keeps the query warm.
 *   - runQuery(queryId)         — trigger a FRESH execution, poll until done,
 *     return rows. Costs credits + takes seconds–minutes. Use in the warmer.
 *
 * Auth: `DUNE_API_KEY` in .env.local (header `X-Dune-API-Key`).
 * Docs: https://docs.dune.com/api-reference/
 */
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

type DuneResultResponse = {
  execution_id: string;
  query_id: number;
  is_execution_finished: boolean;
  state: string; // QUERY_STATE_COMPLETED | _EXECUTING | _PENDING | _FAILED ...
  execution_ended_at?: string; // ISO — when Dune last computed this cached result
  submitted_at?: string; // ISO fallback if execution_ended_at is absent
  result?: {
    rows: DuneRow[];
    metadata: {
      column_names: string[];
      column_types: string[];
      row_count: number;
      total_row_count: number;
    };
  };
  next_uri?: string | null;
  next_offset?: number | null;
};

type ExecuteResponse = { execution_id: string; state: string };
type StatusResponse = {
  execution_id: string;
  query_id: number;
  state: string;
  is_execution_finished?: boolean;
};

async function req<T>(
  path: string,
  init?: RequestInit & { absoluteUrl?: string },
): Promise<T> {
  const url = init?.absoluteUrl ?? `${BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
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
function paramQuery(params?: Record<string, string | number>): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) sp.set(`params.${k}`, String(v));
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
  rows: DuneRow[];
  /** True if the cache was stale and we ran a fresh execution instead. */
  refreshed: boolean;
  /** Age of the cached result we found, in ms (null if Dune omitted the time). */
  cachedAgeMs: number | null;
};

/**
 * Self-healing read — the durable fix for "the scheduled fresh run silently
 * stopped and the cached result rotted for days" (how CC secondary went to $0).
 *
 * Serve the cached result, but if Dune last computed it more than `maxAgeMs`
 * ago — or there are no rows — trigger a FRESH execution and return that. Every
 * cached read now repairs itself the moment the data crosses the staleness line,
 * so a missed scheduled refresh can no longer rot the data: the next warm heals it.
 *
 * Safe degradation: if Dune doesn't report an execution timestamp, we trust a
 * non-empty cache rather than re-running on every call (which would burn credits).
 */
export async function getResultsAutoRefresh(
  queryId: number,
  opts: {
    maxAgeMs: number;
    params?: Record<string, string | number>;
    runOpts?: { maxWaitMs?: number; pollMs?: number; maxRows?: number };
    maxRows?: number;
  },
): Promise<AutoRefreshResult> {
  const { rows, executionEndedAt } = await getLatestResultsMeta(queryId, {
    params: opts.params,
    maxRows: opts.maxRows,
  });
  const parsed = executionEndedAt ? Date.parse(executionEndedAt) : NaN;
  const cachedAgeMs = Number.isFinite(parsed) ? Date.now() - parsed : null;
  const stale = rows.length === 0 || (cachedAgeMs !== null && cachedAgeMs > opts.maxAgeMs);
  if (!stale) return { rows, refreshed: false, cachedAgeMs };
  const fresh = await runQuery(queryId, { params: opts.params, ...opts.runOpts });
  return { rows: fresh, refreshed: true, cachedAgeMs };
}

export { DuneError };
