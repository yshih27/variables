/**
 * DYLI public API client — https://www.dyli.io/api/public/v1
 *
 * Auth: `x-api-key: DYLI_API_KEY` (server-only). Plain node fetch is enough —
 * unlike Beezie there is no WAF to satisfy, the key IS the access.
 *
 * ⚠️ RATE LIMIT 30 req/min. Every call goes through this module's shared pacer,
 * which is SEQUENTIAL and enforces a ≥2.2s gap process-wide. Never call the API
 * outside it and never parallelise: a burst spends the whole minute's budget in
 * a second and the backfill then fails halfway through, which at ~2,000 pages
 * is an expensive thing to restart.
 *
 * `GET /overview` is the route index — it lists every endpoint, the auth shape,
 * the contract map, and the field reference. Start there when extending this.
 */
const BASE = "https://www.dyli.io/api/public/v1";

/** 30 req/min = 2.0s; 2.2s leaves headroom for clock skew and retries. */
const MIN_GAP_MS = 2_200;

export class DyliError extends Error {
  constructor(public status: number, public body: string, public path: string) {
    super(`DYLI ${status} on ${path}: ${body.slice(0, 200)}`);
  }
}

function apiKey(): string {
  const k = process.env.DYLI_API_KEY;
  if (!k) throw new Error("DYLI_API_KEY is not set");
  return k;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Serialised pacer: each call chains onto the previous one's completion, so
// concurrent callers queue instead of bursting.
let chain: Promise<unknown> = Promise.resolve();
let lastStartedAt = 0;
let callCount = 0;

/** How many DYLI requests this process has made (provenance for the warmer). */
export function dyliCallCount(): number {
  return callCount;
}

async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastStartedAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastStartedAt = Date.now();
    callCount += 1;
    return fn();
  });
  // Keep the chain alive even when a call rejects, or one failure would wedge
  // every later request behind a permanently rejected promise.
  chain = run.catch(() => undefined);
  return run;
}

/**
 * GET a DYLI route. `path` is relative to the API base ("/sales").
 * Retries once on 429/5xx after a full rate-limit window — a mid-backfill blip
 * should cost a minute, not the whole run.
 */
export async function dyliGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
  const url = `${BASE}${path}${qs.toString() ? `?${qs}` : ""}`;

  for (let attempt = 0; ; attempt++) {
    const res = await paced(() =>
      fetch(url, { headers: { "x-api-key": apiKey(), accept: "application/json" }, cache: "no-store" }),
    );
    if (res.ok) return (await res.json()) as T;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 1) throw new DyliError(res.status, await res.text(), path);
    await sleep(60_000);
  }
}
