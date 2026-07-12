/**
 * POST /api/subscribe — capture a weekly-report email opt-in (pre-launch).
 * Collection only; no sending is wired yet.
 *
 * Body: { email: string, source?: string, website?: string }
 *   • email    — validated server-side; stored lowercased + trimmed.
 *   • source   — where the signup came from ("report-page" | "footer" | …).
 *   • website  — HONEYPOT. A real form keeps this hidden + empty; a bot fills it.
 *                Non-empty → we return generic success WITHOUT writing.
 *
 * Privacy: the response is ALWAYS the same generic success for any valid email —
 * new or already-subscribed — so it never reveals whether an address is on the
 * list. Only a bad email FORMAT (which leaks nothing) or a server error differs.
 *
 * Throttling: coarse per-IP rate limit (shared limiter) so the endpoint can't be
 * hammered. Same-origin form POST, so no CORS is exposed.
 */
import { rateLimitByIp } from "@/lib/api/auth";
import { upsertSubscriber } from "@/lib/subscribe/subscribers";

export const dynamic = "force-dynamic";

// Deliberately simple — catches obvious garbage without the false-negatives of a
// full RFC-5322 regex. Real deliverability is a post-launch concern (double opt-in).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_SUCCESS = { ok: true, message: "Thanks — you're on the list." };

export async function POST(req: Request) {
  // Throttle first (cheap; shields the DB from a flood).
  const rl = await rateLimitByIp(req, { bucket: "subscribe", limit: 5, windowSec: 600 });
  if (!rl.ok) return Response.json({ ok: false, error: rl.error }, { status: 429 });

  let body: { email?: unknown; source?: unknown; website?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  // Honeypot — silently succeed, write nothing. A bot shouldn't learn it was caught.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return Response.json(GENERIC_SUCCESS);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    // Format errors leak nothing about who's subscribed, so a real 400 is fine.
    return Response.json({ ok: false, error: "Please enter a valid email address." }, { status: 400 });
  }
  const source =
    typeof body.source === "string" && body.source.trim() ? body.source.trim().slice(0, 64) : "unknown";

  try {
    await upsertSubscriber({ email, source });
  } catch (e) {
    // A genuine write failure must surface (else signups vanish) — but never leak details.
    console.warn(`[subscribe] failed: ${(e as Error).message}`);
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }

  // Same response whether this was a new signup or an already-subscribed address.
  return Response.json(GENERIC_SUCCESS);
}
