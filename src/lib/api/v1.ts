/**
 * /api/v1 response envelope (B9-3). Every v1 response is
 *   { ok: true, meta: { generatedAt, attribution, terms }, data }
 * or
 *   { ok: false, error }
 * The free tier is attribution-required, so the terms ride along in-band on
 * every payload — a consumer can't miss them.
 */
import type { ApiKeyResult } from "./auth";
import { SITE_ORIGIN } from "@/lib/site";

const SITE_URL = SITE_ORIGIN;

// Server-side per-key quota already gates access; let browser apps call it too.
// CORS headers must ride on EVERY response (including errors — a browser shows
// an opaque failure otherwise), and the Authorization header triggers a
// preflight, so each route also re-exports the OPTIONS handler below.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
} as const;

export function v1Ok(data: unknown, auth: Extract<ApiKeyResult, { ok: true }>): Response {
  return Response.json(
    {
      ok: true,
      meta: {
        generatedAt: new Date().toISOString(),
        attribution: `Data: Varible (${SITE_URL})`,
        terms: `Free tier — visible attribution with a link to ${SITE_URL} is required wherever this data is displayed.`,
      },
      data,
    },
    {
      headers: {
        ...CORS_HEADERS,
        "X-Quota-Limit": String(auth.limit),
        "X-Quota-Remaining": String(auth.remaining),
      },
    },
  );
}

export function v1Error(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status, headers: CORS_HEADERS });
}

/**
 * Internal (first-party, same-origin) success — same body shape as v1Ok, but
 * deliberately NO CORS headers and no per-key quota headers. Same-origin only is
 * the whole point: the /api/internal/chart/* endpoints are unauthed + IP-rate-
 * limited so the live chart doesn't burn the public per-key quota; leaving CORS
 * off keeps external browser apps from using them to dodge the keyed /api/v1 tier.
 * Lighter meta (no attribution/terms — those are the public free-tier's contract).
 */
export function v1OkInternal(data: unknown): Response {
  return Response.json({ ok: true, meta: { generatedAt: new Date().toISOString() }, data });
}

/** Preflight response — every v1 route re-exports this as its OPTIONS handler. */
export function v1Options(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Parse + validate a query param against a whitelist (case-sensitive). */
export function pickParam<T extends string>(
  url: URL,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T | null {
  const raw = url.searchParams.get(name);
  if (raw == null || raw === "") return fallback;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}
