/**
 * Shared API auth (B9-3).
 *
 *   • cronAuthorized — the CRON_SECRET bearer check every /api/cron/* route
 *     shares (extracted from the previously per-route inline copies).
 *   • requireApiKey  — /api/v1/* key check + per-key daily quota, for the
 *     attribution-required free tier.
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
