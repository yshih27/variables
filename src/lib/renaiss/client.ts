/**
 * Renaiss index API client — https://api.renaissos.com/v1 (spec at /v1/openapi.json).
 *
 * Auth: `X-Api-Key` (rk_…) + `X-Api-Secret` (rsk_…) from RENAISS_API_KEY +
 * RENAISS_API_SECRET. They are Actions secrets read by the two warmers and by
 * nothing else: no request path imports this module. Pages read the row stores
 * the warmers fill (`renaiss_sales`, `renaiss_pulls`, `cards`).
 *
 * ⚠️ NO KEY, NO RUN. The anonymous tier is 10 requests a day per IP, and one
 * warmer run would spend it. `renaissCredentials()` is null unless BOTH are set;
 * the warmers then exit 0 with one line (`noKeyExit`), so their step stays green
 * until the key lands, and `renaissGet` refuses to send a request without them.
 *
 * ⚠️ THE DAY'S BUDGET. A key is 10,000 requests a day. `RENAISS_MAX_CALLS`
 * (default 1,500) caps one process: the pager stops at it and says so, so no
 * backfill can spend the day. X-RateLimit-Remaining is logged after every page.
 *
 * 429: `Retry-After` is honoured ONCE — a wait of up to RETRY_AFTER_CAP_S, then
 * one retry. A longer wait means the day's budget is gone, and holding the core
 * batch until midnight is worse than stopping, so the run stops; a second 429
 * stops it too. What was fetched before the stop is kept.
 *
 * Paging: each response's `nextCursor` goes back as `after` until `hasMore` is
 * false. `from` (ISO 8601) starts at a time instead of the oldest row and is
 * ignored when `after` is sent, so the pager sends `from` on the first request
 * only and never both.
 */
import { RENAISS_API_BASE } from "../data/sources";

/** Rows per page — the server's maximum. */
export const RENAISS_PAGE_SIZE = 500;
/** Per-process request ceiling unless RENAISS_MAX_CALLS says otherwise. */
export const DEFAULT_MAX_CALLS = 1_500;
/** The longest Retry-After the client waits out (seconds). */
export const RETRY_AFTER_CAP_S = 120;
/** No per-minute limit is documented; a short gap keeps a run from bursting. */
const MIN_GAP_MS = 250;

export const NO_KEY_LINE =
  "renaiss: RENAISS_API_KEY and RENAISS_API_SECRET are not both set, so nothing ran " +
  "(the anonymous tier is 10 requests a day and one run would spend it).";

export type RenaissCredentials = { key: string; secret: string };
/** The environment the client reads (process.env, or a test's own). */
export type RenaissEnv = Record<string, string | undefined>;

export function renaissCredentials(env: RenaissEnv = process.env): RenaissCredentials | null {
  const key = env.RENAISS_API_KEY?.trim();
  const secret = env.RENAISS_API_SECRET?.trim();
  return key && secret ? { key, secret } : null;
}

/** The warmers' first line: true (after logging NO_KEY_LINE once) when there is no key pair. */
export function noKeyExit(env: RenaissEnv = process.env, log: (line: string) => void = console.log): boolean {
  if (renaissCredentials(env)) return false;
  log(NO_KEY_LINE);
  return true;
}

export function maxCallsFromEnv(env: RenaissEnv = process.env): number {
  const n = Number(env.RENAISS_MAX_CALLS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_CALLS;
}

export class RenaissError extends Error {
  constructor(public status: number, public body: string, public path: string) {
    super(`Renaiss ${status} on ${path}: ${body.slice(0, 200)}`);
  }
}

/** A deliberate stop — the call ceiling, or the rate limit. Pages fetched before it stand. */
export class RenaissStop extends Error {
  constructor(
    public reason: "ceiling" | "rate-limited",
    message: string,
    public retryAfterS: number | null = null,
  ) {
    super(message);
  }
}

export type RateInfo = { limit: number | null; remaining: number | null; reset: string | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Serialised pacer (the DYLI shape): each call chains onto the previous one's
// completion, so concurrent callers queue instead of bursting.
let chain: Promise<unknown> = Promise.resolve();
let lastStartedAt = 0;
let callCount = 0;
let honouredRetryAfter = false;
let lastRate: RateInfo = { limit: null, remaining: null, reset: null };
let fetchImpl: typeof fetch = (input, init) => fetch(input, init);
let sleepImpl: (ms: number) => Promise<unknown> = sleep;

/** How many requests this process has sent (retries included). */
export function renaissCallCount(): number {
  return callCount;
}

/** The rate-limit headers of the newest response. */
export function lastRateLimit(): RateInfo {
  return lastRate;
}

/** TEST SEAM: swap the transport and the clock, and zero the per-process counters. */
export function resetRenaissClient(opts: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<unknown> } = {}): void {
  chain = Promise.resolve();
  lastStartedAt = 0;
  callCount = 0;
  honouredRetryAfter = false;
  lastRate = { limit: null, remaining: null, reset: null };
  fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  sleepImpl = opts.sleep ?? sleep;
}

async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastStartedAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleepImpl(wait);
    lastStartedAt = Date.now();
    callCount += 1;
    return fn();
  });
  // Keep the chain alive when a call rejects, or one failure wedges every later request.
  chain = run.catch(() => undefined);
  return run;
}

function intHeader(h: Headers, name: string): number | null {
  const v = h.get(name);
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}

function readRate(h: Headers): RateInfo {
  return {
    limit: intHeader(h, "x-ratelimit-limit"),
    remaining: intHeader(h, "x-ratelimit-remaining"),
    reset: h.get("x-ratelimit-reset"),
  };
}

/** Retry-After as seconds: delta-seconds, or an HTTP date. Null when absent or unreadable. */
export function retryAfterSeconds(v: string | null, now: number = Date.now()): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, Math.ceil(n));
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : null;
}

/**
 * GET a Renaiss route. `path` is relative to the API base ("/renaiss/sales").
 * Throws RenaissStop at the ceiling or on a rate limit it will not wait out,
 * RenaissError on any other non-2xx (after one retry on a 5xx).
 */
export async function renaissGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  opts: { env?: RenaissEnv } = {},
): Promise<{ body: T; rate: RateInfo }> {
  const env = opts.env ?? process.env;
  const creds = renaissCredentials(env);
  if (!creds) throw new Error(NO_KEY_LINE);
  const ceiling = maxCallsFromEnv(env);

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
  const url = `${RENAISS_API_BASE}${path}${qs.toString() ? `?${qs}` : ""}`;

  for (let attempt = 0; ; attempt++) {
    if (callCount >= ceiling) {
      throw new RenaissStop(
        "ceiling",
        `stopped at the per-run ceiling of ${ceiling.toLocaleString()} requests (RENAISS_MAX_CALLS)`,
      );
    }
    const res = await paced(() =>
      fetchImpl(url, {
        headers: { "X-Api-Key": creds.key, "X-Api-Secret": creds.secret, accept: "application/json" },
        cache: "no-store",
      }),
    );
    lastRate = readRate(res.headers);
    if (res.ok) return { body: (await res.json()) as T, rate: lastRate };

    if (res.status === 429) {
      const after = retryAfterSeconds(res.headers.get("retry-after"));
      if (honouredRetryAfter || after == null || after > RETRY_AFTER_CAP_S) {
        throw new RenaissStop(
          "rate-limited",
          `rate-limited (429${after != null ? `, Retry-After ${after}s` : ", no Retry-After"}` +
            `${honouredRetryAfter ? ", after one honoured wait" : ""}); remaining ${lastRate.remaining ?? "?"}`,
          after,
        );
      }
      honouredRetryAfter = true;
      await sleepImpl(after * 1000);
      continue;
    }
    if (res.status >= 500 && attempt < 1) {
      await sleepImpl(5_000);
      continue;
    }
    throw new RenaissError(res.status, await res.text(), path);
  }
}

// ── Cursor paging ───────────────────────────────────────────────────────────

export type FeedPage<T> = { rows: T[]; nextCursor: string | null; hasMore: boolean; rate: RateInfo | null };
export type FeedQuery = { after?: string; from?: string; limit: number };
export type StopReason = "caught-up" | "page-limit" | "ceiling" | "rate-limited";
export type PageInfo = { page: number; rows: number; nextCursor: string | null; hasMore: boolean; rate: RateInfo | null };
export type PagedRun = {
  pages: number;
  rows: number;
  /** The newest cursor seen — where a poll would continue. */
  lastCursor: string | null;
  stoppedBy: StopReason;
  /** The stop's own message, for ceiling and rate-limit stops. */
  detail: string | null;
};

/**
 * Page a feed from `from` (or the oldest row) until it is caught up, the page
 * limit, the ceiling, or a rate limit. `onPage` runs after each page, before
 * the next request — a warmer writes there, so a stop keeps every page it got.
 */
export async function pageFeed<T>(opts: {
  fetchPage: (q: FeedQuery) => Promise<FeedPage<T>>;
  from?: string | null;
  after?: string | null;
  limit?: number;
  maxPages?: number;
  onPage: (rows: T[], info: PageInfo) => Promise<void> | void;
}): Promise<PagedRun> {
  const limit = opts.limit ?? RENAISS_PAGE_SIZE;
  const maxPages = opts.maxPages ?? Infinity;
  let after = opts.after ?? null;
  let pages = 0;
  let rows = 0;
  const done = (stoppedBy: StopReason, detail: string | null = null): PagedRun => ({
    pages,
    rows,
    lastCursor: after,
    stoppedBy,
    detail,
  });

  for (;;) {
    if (pages >= maxPages) return done("page-limit");
    let page: FeedPage<T>;
    try {
      page = await opts.fetchPage(after ? { after, limit } : { ...(opts.from ? { from: opts.from } : {}), limit });
    } catch (e) {
      if (e instanceof RenaissStop) return done(e.reason, e.message);
      throw e;
    }
    pages += 1;
    rows += page.rows.length;
    await opts.onPage(page.rows, { page: pages, rows: page.rows.length, nextCursor: page.nextCursor, hasMore: page.hasMore, rate: page.rate });
    if (page.nextCursor) after = page.nextCursor;
    if (!page.hasMore) return done("caught-up");
    if (!page.nextCursor) throw new Error("Renaiss feed said hasMore with no nextCursor");
  }
}
