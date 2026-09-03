/**
 * Shared API auth + throttling (B9-3).
 *
 *   • cronAuthorized — the CRON_SECRET bearer check every /api/cron/* route
 *     shares (extracted from the previously per-route inline copies).
 *   • requireApiKey  — /api/v1/* key check + per-key daily quota, for the
 *     attribution-required free tier.
 *   • rateLimitByIp  — coarse per-IP fixed-window throttle (same snapshots-KV
 *     fail-open mechanism as the quota), for unauthenticated write endpoints
 *     like /api/subscribe.
 *
 * API keys live in the API_V1_KEYS env var as comma-separated `label:secret`
 * pairs — e.g. `acme:vk_9f2…,press:vk_a41…`. The label is the key's identity
 * (quota bucket + attribution); the secret is what callers send. No DB table:
 * keys are hand-issued for now, and rotating one is an env edit + redeploy.
 *
 * Quota: one `snapshots` KV row per key × UTC day (`api-usage:{label}:{day}`,
 * payload `{ count }`), capped at API_V1_DAILY_QUOTA (default 1000/day).
 * The increment is read-modify-write, NOT atomic — two concurrent requests can
 * each read n−1 and undercount by one. That's acceptable for a coarse free-tier
 * cap; move to a Postgres RPC counter if the API ever sees real traffic.
 * Quota bookkeeping FAILS OPEN: a broken counter must degrade to "allowed",
 * never take the whole API down.
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";

/** Bearer-token check for the /api/cron/* routes (scheduler-only endpoints). */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export type ApiKeyResult =
  | { ok: true; label: string; limit: number; remaining: number }
  | { ok: false; status: number; error: string };

const DEFAULT_DAILY_QUOTA = 1000;

/** API_V1_KEYS="label:secret,label2:secret2" → secret → label. */
function parseApiKeys(): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of (process.env.API_V1_KEYS ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const i = trimmed.indexOf(":");
    // A bare secret (no label) identifies as its own first 6 chars.
    if (i < 0) out.set(trimmed, trimmed.slice(0, 6));
    else out.set(trimmed.slice(i + 1), trimmed.slice(0, i));
  }
  return out;
}

function extractKey(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length).trim() || null;
  return new URL(req.url).searchParams.get("api_key");
}

/**
 * Validate the caller's API key and spend one unit of its daily quota.
 * Routes should surface `limit`/`remaining` as X-Quota-* headers.
 */
export async function requireApiKey(req: Request): Promise<ApiKeyResult> {
  const keys = parseApiKeys();
  if (keys.size === 0) {
    return { ok: false, status: 503, error: "API not configured (no API_V1_KEYS set)" };
  }
  const secret = extractKey(req);
  if (!secret) {
    return {
      ok: false,
      status: 401,
      error: "missing API key — send `Authorization: Bearer <key>` (or ?api_key=)",
    };
  }
  const label = keys.get(secret);
  if (!label) return { ok: false, status: 403, error: "unknown API key" };

  const limit = Number(process.env.API_V1_DAILY_QUOTA) || DEFAULT_DAILY_QUOTA;
  const day = new Date().toISOString().slice(0, 10);
  const kvKey = `api-usage:${label}:${day}`;
  let used = 0;
  try {
    used = (await readSnapshot<{ count: number }>(kvKey))?.count ?? 0;
    if (used >= limit) {
      return {
        ok: false,
        status: 429,
        error: `daily quota exceeded (${limit}/day, resets 00:00 UTC)`,
      };
    }
    await writeSnapshot(kvKey, { count: used + 1 });
    used += 1;
  } catch (e) {
    // Fail open — see file header.
    console.warn(`[api-v1] quota bookkeeping failed for "${label}": ${(e as Error).message}`);
  }
  return { ok: true, label, limit, remaining: Math.max(0, limit - used) };
}

/** Best-effort client IP for rate limiting — first x-forwarded-for hop (Vercel sets it). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export type RateLimitResult = { ok: true; remaining: number } | { ok: false; error: string };

/**
 * Coarse per-IP rate limit, same mechanism as the API-v1 daily quota: one
 * `snapshots` KV row per (bucket, ip, fixed-window), read-modify-write, FAILS OPEN.
 * Not atomic (a burst can slip one or two through) — fine for abuse-throttling a
 * write endpoint, not a security control. Windows are fixed (floor(now/window)),
 * so old counter rows just go stale.
 */
/**
 * Is this request same-origin — i.e. our own page's `fetch`, not a stranger?
 *
 * ⚠️ WHY THIS EXISTS. `rateLimitByIp` is a PUBLIC-API abuse control, and it pays
 * for that with two PostgREST round trips (read-modify-write of a `snapshots` KV
 * row) BEFORE any chart work happens. The Index Studio was firing ~30 same-origin
 * requests at mount, eight concurrently, all contending on that one table — half a
 * second of pure bookkeeping per call, on our own page's behalf, to defend against
 * ourselves. That was a measurable share of a ~30s first paint.
 *
 * DETECTION, in order of trustworthiness:
 *   1. `Sec-Fetch-Site: same-origin` — set by the BROWSER, not by page script, and
 *      unforgeable from JS (it is a forbidden header name). This is the real signal.
 *   2. `Origin` / `Referer` host === the request host — the fallback for clients
 *      that do not send Fetch Metadata.
 *
 * ⚠️ AND WHY IT IS SAFE HERE AND NOWHERE ELSE. Neither signal is a security
 * boundary: a non-browser client can send whatever headers it likes, so this must
 * only ever gate a PERFORMANCE concern. It is applied to the internal chart
 * endpoints, which are unauthed read-only public market data already served to
 * every visitor and already CDN-cached. It must NOT be used to exempt anything
 * that writes, costs money per call, or guards a quota — /api/subscribe keeps its
 * full DB limiter, and so does the keyed /api/v1 tier.
 */
export function isSameOrigin(req: Request): boolean {
  const h = req.headers;
  const fetchSite = h.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin";

  const host = h.get("host");
  if (!host) return false;
  const hostOf = (v: string | null): string | null => {
    if (!v) return null;
    try {
      return new URL(v).host;
    } catch {
      return null;
    }
  };
  const origin = hostOf(h.get("origin"));
  if (origin) return origin === host;
  const referer = hostOf(h.get("referer"));
  return referer != null && referer === host;
}

/**
 * A per-INSTANCE, in-memory token bucket. No I/O, so it costs nothing per call.
 *
 * This is what the internal chart routes use instead of the Postgres limiter: it
 * cannot see other instances (so it is a much looser guarantee), but the thing it
 * has to stop is one client hammering one instance, and for that a local counter
 * is enough. The old bookkeeping bought a globally-consistent count of requests to
 * a cache-fronted read-only endpoint, and paid two DB round trips per request for it.
 */
const memBuckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimitInMemory(
  req: Request,
  opts: { bucket: string; limit: number; windowSec: number },
): RateLimitResult {
  const key = `${opts.bucket}:${clientIp(req)}`;
  const now = Date.now();
  const cur = memBuckets.get(key);
  if (!cur || now >= cur.resetAt) {
    // Bound the map so a long-lived instance seeing many IPs cannot grow forever.
    if (memBuckets.size > 5_000) memBuckets.clear();
    memBuckets.set(key, { count: 1, resetAt: now + opts.windowSec * 1000 });
    return { ok: true, remaining: opts.limit - 1 };
  }
  if (cur.count >= opts.limit) {
    return { ok: false, error: "Too many requests — please try again in a few minutes." };
  }
  cur.count += 1;
  return { ok: true, remaining: Math.max(0, opts.limit - cur.count) };
}

export async function rateLimitByIp(
  req: Request,
  opts: { bucket: string; limit: number; windowSec: number },
): Promise<RateLimitResult> {
  const ip = clientIp(req);
  const windowId = Math.floor(Date.now() / (opts.windowSec * 1000));
  const kvKey = `ratelimit:${opts.bucket}:${ip}:${windowId}`;
  try {
    const used = (await readSnapshot<{ count: number }>(kvKey))?.count ?? 0;
    if (used >= opts.limit) {
      return { ok: false, error: "Too many requests — please try again in a few minutes." };
    }
    await writeSnapshot(kvKey, { count: used + 1 });
    return { ok: true, remaining: Math.max(0, opts.limit - used - 1) };
  } catch (e) {
    console.warn(`[ratelimit] bookkeeping failed for "${opts.bucket}/${ip}": ${(e as Error).message}`);
    return { ok: true, remaining: opts.limit }; // fail open
  }
}
