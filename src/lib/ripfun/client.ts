/**
 * CardOS client — rip.fun's Card Data API (https://api-docs.rip.fun/docs).
 *
 * Base `https://api.getcardos.com/api/v1` (alias `https://service.rip.fun`),
 * sandbox `https://staging-service.rip.fun/api/v1`. Auth is an `X-API-Key`
 * header; collection responses come wrapped in
 * `{ success, data, page, page_size, total_count, language }`.
 *
 * ⚠️ THE BINDING CONSTRAINT HERE IS CREDITS, NOT THROUGHPUT — the opposite of
 * DYLI. CardOS allows 300 req/min (a 200ms gap), but every catalog call spends
 * **1 credit flat** and the free tier is **500 credits/month**. A loop that
 * would merely be slow against DYLI's 30 req/min ceiling silently eats a month's
 * budget here in under three minutes. So the pacer below is a formality and the
 * CREDIT METER is the real guard: it charges every request, throws past a
 * per-run budget, and surfaces the account's own `X-Credits-Remaining` so a
 * warmer log states spend rather than implying it.
 *
 * WAF lesson (rip.fun, 6/29): node fetch, never curl. That block was on
 * rip.fun's own site endpoints; api.getcardos.com is the documented server-side
 * API and expects exactly this shape.
 */

/** Production origin. `https://service.rip.fun` is an alias serving the same API. */
export const RIPFUN_API_BASE = "https://api.getcardos.com/api/v1";
/** Sandbox (Base Sepolia behind it). Set RIP_API_BASE to point at it. */
export const RIPFUN_STAGING_API_BASE = "https://staging-service.rip.fun/api/v1";

/**
 * 300 req/min = 200ms. 250ms leaves headroom for clock skew, and at this credit
 * budget we are never anywhere near the ceiling anyway.
 */
const MIN_GAP_MS = 250;

/**
 * Per-RUN credit budget. 500 credits/month is the whole free allowance, so the
 * cadence arithmetic is the design: a daily warmer gets ~16 credits/run to stay
 * inside it, a 6h one ~4. The default is deliberately a few multiples of that —
 * generous against a legitimate incremental pass, nowhere near a full catalog
 * sync (474 credits, see docs/roadmap/ripfun-phase1-findings.md) — so a crawl
 * that forgets its cursor THROWS here instead of on the invoice. Override with
 * RIP_CREDIT_BUDGET (a backfill states its own number; a small value stress-tests).
 */
const CREDIT_BUDGET = (() => {
  const raw = Number(process.env.RIP_CREDIT_BUDGET);
  return Number.isFinite(raw) && raw > 0 ? raw : 50;
})();

/** Every metered catalog endpoint costs 1 credit per call, whatever the page size. */
const CREDIT_PER_CALL = 1;

export class RipFunError extends Error {
  constructor(
    public status: number,
    public body: string,
    public path: string,
    /** CardOS machine-readable code from `{ success:false, error }`, when present. */
    public code?: string,
  ) {
    super(`CardOS ${status} on ${path}${code ? ` (${code})` : ""}: ${body.slice(0, 200)}`);
  }
}

function apiKey(): string {
  const k = process.env.RIP_API_KEY;
  if (!k) throw new Error("RIP_API_KEY is not set");
  return k;
}

function apiBase(): string {
  return process.env.RIP_API_BASE || RIPFUN_API_BASE;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────── Credit meter ───────────────────────────

let creditsUsed = 0;
let callCount = 0;
/** Newest `X-Credits-Remaining` the API reported — the authoritative balance. */
let creditsRemaining: number | null = null;

export type RipFunSpend = {
  /** Credits this process charged itself (1 per metered call). */
  credits: number;
  /** Requests actually issued, including ones a 429 made us retry. */
  calls: number;
  /**
   * Account balance from the newest response header, or null when nothing has
   * come back yet. Prefer this over `credits` when reporting what is LEFT: it
   * is the account's own number and it accounts for every other key sharing it.
   */
  remaining: number | null;
  /** The per-run ceiling this process will throw at. */
  budget: number;
};

/** What this process (≈ this warmer run) has spent against CardOS. */
export function ripFunSpend(): RipFunSpend {
  return { credits: creditsUsed, calls: callCount, remaining: creditsRemaining, budget: CREDIT_BUDGET };
}

/**
 * Charge BEFORE the request goes out. Charging after would let the call that
 * breaks the budget land first, which for a metered API means the credit is
 * already gone by the time we complain about it.
 */
function charge(path: string): void {
  creditsUsed += CREDIT_PER_CALL;
  if (creditsUsed > CREDIT_BUDGET) {
    throw new Error(
      `CardOS credit budget exceeded this run: ${creditsUsed} > ${CREDIT_BUDGET} credits (next call: ${path}). ` +
        `The free tier is 500 credits/MONTH — bound the walk (expansion filter / id cursor / since-cursor) ` +
        `or raise RIP_CREDIT_BUDGET deliberately for a stated backfill.`,
    );
  }
}

// Serialised pacer: each call chains onto the previous one's completion so
// concurrent callers queue rather than burst. Same shape as the DYLI pacer.
let chain: Promise<unknown> = Promise.resolve();
let lastStartedAt = 0;

async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastStartedAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastStartedAt = Date.now();
    return fn();
  });
  // Keep the chain alive when a call rejects, or one failure wedges every later
  // request behind a permanently rejected promise.
  chain = run.catch(() => undefined);
  return run;
}

/** Read a header as a finite number, or null. */
function headerNum(res: Response, name: string): number | null {
  const raw = res.headers.get(name);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** CardOS's error envelope: `{ success:false, message, error, details }`. */
function errorCode(body: string): string | undefined {
  try {
    const j = JSON.parse(body) as { error?: unknown };
    return typeof j.error === "string" ? j.error : undefined;
  } catch {
    return undefined;
  }
}

/** How long to wait before retrying a 429, honouring the server's own number first. */
function retryAfterMs(res: Response, attempt: number): number {
  const hinted = headerNum(res, "retry-after");
  if (hinted != null && hinted > 0) return hinted * 1000;
  return Math.min(2 ** attempt, 30) * 1000;
}

const MAX_RETRIES = 3;

/**
 * GET a CardOS route. `path` is relative to the API base ("/pokemon/cards").
 *
 * Retry policy follows the docs' own guidance and its billing rules:
 *   • 429 — throttling runs BEFORE metering, so a throttled request is never
 *     billed. Retryable, backing off on `Retry-After`.
 *   • 5xx — retryable with the same backoff.
 *   • 402 — the credit balance is empty. NOT retryable: every attempt returns
 *     402 until someone tops up, and hammering it just delays the honest error.
 *   • 4xx — a request bug (bad query grammar, unknown id, missing scope). Never
 *     retried; the same call would fail the same way and would be billed again.
 */
export async function ripFunGet<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
  const url = `${apiBase()}${path}${qs.toString() ? `?${qs}` : ""}`;

  // One charge per logical call. A 429 retry is explicitly unbilled upstream, so
  // re-charging it here would make our meter drift pessimistic against the real
  // balance the `X-Credits-Remaining` header reports.
  charge(path);

  for (let attempt = 0; ; attempt++) {
    const res = await paced(() => {
      callCount += 1;
      return fetch(url, {
        headers: { "X-API-Key": apiKey(), accept: "application/json" },
        cache: "no-store",
      });
    });

    const remaining = headerNum(res, "x-credits-remaining");
    if (remaining != null) creditsRemaining = remaining;

    if (res.ok) return (await res.json()) as T;

    const body = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) {
      throw new RipFunError(res.status, body, path, errorCode(body));
    }
    await sleep(retryAfterMs(res, attempt));
  }
}

// ── Response envelopes ────────────────────────────────────────────────────

/** Collection envelope: `{ success, data, page, page_size, total_count, language }`. */
export type RipFunPage<T> = {
  success: boolean;
  data: T[];
  page: number;
  page_size: number;
  total_count: number;
  language?: string;
};

/** Single-object envelope: the object sits in `data`. */
export type RipFunObject<T> = { success: boolean; data: T };

/**
 * Server page cap. The docs are explicit: "A page holds 100 results and costs
 * one credit" — so 100 is both the maximum and the only sensible request size,
 * since a smaller page costs exactly the same credit.
 */
export const RIPFUN_PAGE_SIZE = 100;

/**
 * `page × page_size` is capped at 10,000 server-side. Past that the docs say to
 * narrow the query (filter by expansion) or use the last id as a cursor —
 * exported so a walker can assert its own bound instead of discovering the wall
 * mid-crawl, having already spent 100 credits getting there.
 */
export const RIPFUN_MAX_OFFSET = 10_000;
