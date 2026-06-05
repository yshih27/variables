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

/**
 * Instant read of a saved query's most recent cached result. Paginates
 * through `next_uri` so large result sets come back whole.
 */
export async function getLatestResults(
  queryId: number,
  opts: { params?: Record<string, string | number>; maxRows?: number } = {},
): Promise<DuneRow[]> {
  const maxRows = opts.maxRows ?? 100_000;
  const rows: DuneRow[] = [];
  let path: string | null = `/query/${queryId}/results${paramQuery(opts.params)}`;
  let absoluteUrl: string | undefined;

  while (path || absoluteUrl) {
    const page: DuneResultResponse = await req<DuneResultResponse>(path ?? "", {
      absoluteUrl,
    });
    if (page.result?.rows) rows.push(...page.result.rows);
    if (rows.length >= maxRows) break;
    if (page.next_uri) {
      absoluteUrl = page.next_uri;
      path = null;
    } else {
      break;
    }
  }
  return rows;
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
    if (page.result?.rows) rows.push(...page.result.rows);
    if (rows.length >= maxRows) break;
    if (page.next_uri) {
      absoluteUrl = page.next_uri;
      path = null;
    } else break;
  }
  return rows;
}

export { DuneError };
