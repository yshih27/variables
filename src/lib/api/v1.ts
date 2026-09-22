/**
 * /api/v1 response envelope (B9-3). Every v1 response is
 *   { ok: true, meta: { generatedAt, attribution, terms }, data }
 * or
 *   { ok: false, error }
 * The free tier is attribution-required, so the terms ride along in-band on
 * every payload — a consumer can't miss them.
 */
import { rateLimitInMemory, type ApiKeyResult, type RateLimitResult } from "./auth";
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
export function v1OkInternal(data: unknown, headers?: Record<string, string>): Response {
  return Response.json(
    { ok: true, meta: { generatedAt: new Date().toISOString() }, data },
    headers ? { headers } : undefined,
  );
}

/** Preflight response — every v1 route re-exports this as its OPTIONS handler. */
export function v1Options(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// ── the PUBLIC tier (key-free, CDN-cached, CORS-open) ────────────────────────

/**
 * ⚠️ A THIRD TIER, AND WHY IT IS NOT ONE OF THE OTHER TWO. `/api/v1` is keyed
 * because a partner pulling series should be attributable and quota'd.
 * `/api/internal` is key-free but same-origin-only, so it cannot be used to dodge
 * that. The reference price is neither: a badge in a venue's listing page is
 * cross-origin by definition and cannot carry our key, and demanding one would
 * mean no venue ever embeds the price. So this tier is open — one card's public
 * price, cacheable at the edge, rate-limited per IP for abuse, and carrying its
 * attribution in the payload rather than in a contract nobody reads.
 *
 * It is deliberately NARROW: a single identity per request, no enumeration, no
 * bulk. Anything that wants the market needs a key.
 */
export const PUBLIC_RATE = { bucket: "public-price", limit: 240, windowSec: 60 } as const;

/**
 * 30 minutes at the edge — the same window the chart JSON uses, for the same
 * reason: the underlying figures move on the warmers' cadence, so a shared
 * cache serves nothing staler than the page would, and `stale-while-revalidate`
 * means the first visitor after expiry still gets an instant answer.
 */
export const PUBLIC_CDN_HEADERS: Record<string, string> = {
  "cache-control": "public, s-maxage=1800, stale-while-revalidate=3600",
  vary: "Accept-Encoding",
};

/**
 * The public guard — per-IP, per instance, and deliberately NOT the durable
 * limiter the chart endpoints fall back to for cross-origin callers.
 *
 * ⚠️ WHY THE IN-MEMORY BUCKET FOR EVERYONE HERE. `rateLimitByIp` is a
 * read-modify-write of a `snapshots` row per request. On the chart endpoints
 * that path is the rare one — those are same-origin by design, so the durable
 * limiter only ever sees strangers. This endpoint is CROSS-ORIGIN BY DESIGN: a
 * badge on a venue's listing page is the intended traffic, so the durable
 * limiter would be the COMMON path, and a few thousand badge loads a minute
 * would become a few thousand writes a minute against the same table the whole
 * site reads its snapshots from. An abuse control that converts traffic into
 * database writes is an amplifier, not a control.
 *
 * What actually carries the load is the 30-minute shared CDN cache above, and
 * what bounds the damage is the shape of the endpoint: one identity per request,
 * no enumeration, no bulk. Per-instance counting is weaker than a durable
 * counter — a scraper spread across instances gets more through — and that is
 * the accepted trade for not handing an outside caller a write.
 */
export async function guardPublicRequest(req: Request): Promise<RateLimitResult> {
  return rateLimitInMemory(req, PUBLIC_RATE);
}

/** Public success — CORS-open, CDN-cached, attribution in-band like v1Ok. */
export function publicOk(data: unknown, headers?: Record<string, string>): Response {
  return Response.json(
    {
      ok: true,
      meta: {
        generatedAt: new Date().toISOString(),
        attribution: `Data: Varible (${SITE_URL})`,
        terms: `Free — visible attribution with a link to ${SITE_URL} is required wherever this data is displayed.`,
      },
      data,
    },
    { headers: { ...CORS_HEADERS, ...PUBLIC_CDN_HEADERS, ...headers } },
  );
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
